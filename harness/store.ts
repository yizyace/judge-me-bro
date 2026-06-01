import Database from "better-sqlite3";
import matter from "gray-matter";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  PersonaFrontmatter,
  IdeaFrontmatter,
  IdeaEvaluation,
  MetaEvaluation,
  ReputationRow,
  type Kind,
} from "./schemas.js";

/**
 * The storage abstraction (root.md §10) — the ONLY module that touches the
 * filesystem and the SQLite ledger. Everything else goes through this surface,
 * so a hosted backend (object storage + Postgres) can swap in without rewrites.
 *
 * Personas, ideas, and run artifacts are files; the reputation ledger is
 * SQLite (data/jmb.sqlite). The ledger is append-only: a new run never mutates
 * old reputation rows.
 */

const KIND_DIR: Record<Kind, string> = { judge: "judges", founder: "founders" };
const nowIso = (): string => new Date().toISOString();

export interface StoreOptions {
  /** Repo root that holds personas/, ideas/, runs/, data/. Defaults to cwd. */
  root?: string;
  /** SQLite path. Defaults to <root>/data/jmb.sqlite. Use ":memory:" in tests. */
  dbPath?: string;
}

export interface PersonaFile {
  frontmatter: PersonaFrontmatter;
  body: string;
  path: string; // repo-relative
}
export interface IdeaFile {
  frontmatter: IdeaFrontmatter;
  body: string;
  path: string; // repo-relative
}

export class Store {
  readonly root: string;
  readonly db: Database.Database;

  constructor(opts: StoreOptions = {}) {
    this.root = opts.root ?? process.cwd();
    const dbPath = opts.dbPath ?? path.join(this.root, "data", "jmb.sqlite");
    if (dbPath !== ":memory:") fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    if (dbPath !== ":memory:") this.db.pragma("journal_mode = WAL");
    this.migrate();
  }

  close(): void {
    this.db.close();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS judge_version (
        judge_id     TEXT,
        version      INTEGER,
        kind         TEXT,
        persona_path TEXT,
        created_at   TEXT,
        PRIMARY KEY (judge_id, version)
      );
      CREATE TABLE IF NOT EXISTS evaluator (
        evaluator_version TEXT PRIMARY KEY,
        rubric_json       TEXT,
        notes             TEXT,
        created_at        TEXT
      );
      CREATE TABLE IF NOT EXISTS reputation (
        judge_id          TEXT,
        judge_version     INTEGER,
        evaluator_version TEXT,
        run_id            TEXT,
        rep_score         REAL,
        n_meta            INTEGER,
        components_json   TEXT,
        created_at        TEXT
      );
    `);
  }

  private abs(...segs: string[]): string {
    return path.join(this.root, ...segs);
  }

  private ensureDir(relDir: string): void {
    fs.mkdirSync(this.abs(relDir), { recursive: true });
  }

  /* ── Personas (files + judge_version registration) ───────────────────── */

  personaRelPath(kind: Kind, id: string, version: number): string {
    return path.join("personas", KIND_DIR[kind], `${id}@${version}.md`);
  }

  /** Validate frontmatter, write the persona file, and register the version. */
  putPersona(markdown: string): PersonaFile {
    const parsed = matter(markdown);
    const fm = PersonaFrontmatter.parse(parsed.data);
    const rel = this.personaRelPath(fm.kind, fm.id, fm.version);
    this.ensureDir(path.dirname(rel));
    fs.writeFileSync(this.abs(rel), markdown.endsWith("\n") ? markdown : markdown + "\n");
    this.registerJudgeVersion(fm, rel);
    return { frontmatter: fm, body: parsed.content, path: rel };
  }

  getPersona(id: string, version: number): PersonaFile | null {
    for (const kind of ["judge", "founder"] as Kind[]) {
      const rel = this.personaRelPath(kind, id, version);
      if (fs.existsSync(this.abs(rel))) return this.readPersonaFile(rel);
    }
    return null;
  }

  private readPersonaFile(rel: string): PersonaFile {
    const parsed = matter(fs.readFileSync(this.abs(rel), "utf8"));
    return { frontmatter: PersonaFrontmatter.parse(parsed.data), body: parsed.content, path: rel };
  }

  listPersonas(): PersonaFile[] {
    const out: PersonaFile[] = [];
    for (const dir of ["judges", "founders"]) {
      const absDir = this.abs("personas", dir);
      if (!fs.existsSync(absDir)) continue;
      for (const f of fs.readdirSync(absDir)) {
        if (f.endsWith(".md")) out.push(this.readPersonaFile(path.join("personas", dir, f)));
      }
    }
    return out;
  }

  /** Highest version per judge_id — the active panel for a run. */
  activeJudges(): PersonaFile[] {
    const best = new Map<string, PersonaFile>();
    for (const p of this.listPersonas()) {
      const cur = best.get(p.frontmatter.id);
      if (!cur || p.frontmatter.version > cur.frontmatter.version) best.set(p.frontmatter.id, p);
    }
    return [...best.values()];
  }

  /* ── Ideas (files) ───────────────────────────────────────────────────── */

  listIdeas(): IdeaFile[] {
    const absDir = this.abs("ideas");
    if (!fs.existsSync(absDir)) return [];
    const out: IdeaFile[] = [];
    for (const f of fs.readdirSync(absDir)) {
      if (!f.endsWith(".md")) continue;
      const parsed = matter(fs.readFileSync(path.join(absDir, f), "utf8"));
      out.push({
        frontmatter: IdeaFrontmatter.parse(parsed.data),
        body: parsed.content,
        path: path.join("ideas", f),
      });
    }
    return out;
  }

  getIdea(id: string): IdeaFile | null {
    return this.listIdeas().find((i) => i.frontmatter.id === id) ?? null;
  }

  /* ── Run artifacts (files, immutable per run) ────────────────────────── */

  runRel(runId: string, ...segs: string[]): string {
    return path.join("runs", runId, ...segs);
  }

  writeEvaluation(ev: IdeaEvaluation): string {
    const rel = this.runRel(
      ev.run_id,
      "evaluations",
      `${ev.judge.judge_id}@${ev.judge.judge_version}--${ev.idea_id}.json`,
    );
    this.ensureDir(path.dirname(rel));
    fs.writeFileSync(this.abs(rel), JSON.stringify(ev, null, 2) + "\n");
    return rel;
  }

  readEvaluations(runId: string): IdeaEvaluation[] {
    return this.readJsonDir(this.runRel(runId, "evaluations"), IdeaEvaluation);
  }

  writeMeta(m: MetaEvaluation): string {
    const rel = this.runRel(
      m.run_id,
      "meta",
      `${m.rater.judge_id}--on--${m.target.judge_id}--${m.idea_id}.json`,
    );
    this.ensureDir(path.dirname(rel));
    fs.writeFileSync(this.abs(rel), JSON.stringify(m, null, 2) + "\n");
    return rel;
  }

  readMetas(runId: string): MetaEvaluation[] {
    return this.readJsonDir(this.runRel(runId, "meta"), MetaEvaluation);
  }

  writeRunFile(runId: string, filename: string, content: string): string {
    const rel = this.runRel(runId, filename);
    this.ensureDir(path.join("runs", runId));
    fs.writeFileSync(this.abs(rel), content);
    return rel;
  }

  private readJsonDir<T>(relDir: string, schema: { parse: (v: unknown) => T }): T[] {
    const absDir = this.abs(relDir);
    if (!fs.existsSync(absDir)) return [];
    return fs
      .readdirSync(absDir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => schema.parse(JSON.parse(fs.readFileSync(path.join(absDir, f), "utf8"))));
  }

  /* ── Reputation ledger (SQLite, append-only) ─────────────────────────── */

  registerJudgeVersion(fm: PersonaFrontmatter, personaPath: string): void {
    this.db
      .prepare(
        `INSERT INTO judge_version (judge_id, version, kind, persona_path, created_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(judge_id, version)
         DO UPDATE SET kind = excluded.kind, persona_path = excluded.persona_path`,
      )
      .run(fm.id, fm.version, fm.kind, personaPath, nowIso());
  }

  upsertEvaluator(evaluatorVersion: string, rubricJson: string, notes: string): void {
    this.db
      .prepare(
        `INSERT INTO evaluator (evaluator_version, rubric_json, notes, created_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(evaluator_version) DO NOTHING`,
      )
      .run(evaluatorVersion, rubricJson, notes, nowIso());
  }

  /** Append a reputation snapshot. Never mutates existing rows. */
  appendReputation(row: Omit<ReputationRow, "created_at"> & { created_at?: string }): ReputationRow {
    const full: ReputationRow = ReputationRow.parse({ ...row, created_at: row.created_at ?? nowIso() });
    this.db
      .prepare(
        `INSERT INTO reputation
           (judge_id, judge_version, evaluator_version, run_id, rep_score, n_meta, components_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        full.judge_id,
        full.judge_version,
        full.evaluator_version,
        full.run_id,
        full.rep_score,
        full.n_meta,
        full.components_json,
        full.created_at,
      );
    return full;
  }

  queryReputation(
    filter: Partial<Pick<ReputationRow, "judge_id" | "judge_version" | "evaluator_version" | "run_id">> = {},
  ): ReputationRow[] {
    const where: string[] = [];
    const params: Record<string, string | number> = {};
    for (const key of ["judge_id", "judge_version", "evaluator_version", "run_id"] as const) {
      const v = filter[key];
      if (v !== undefined) {
        where.push(`${key} = @${key}`);
        params[key] = v;
      }
    }
    const sql = `SELECT * FROM reputation ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY created_at ASC`;
    const stmt = this.db.prepare(sql);
    return (where.length ? stmt.all(params) : stmt.all()) as ReputationRow[];
  }

  /** Most recent rep_score for the highest prior version of a judge, same evaluator. */
  previousRepScore(judgeId: string, judgeVersion: number, evaluatorVersion: string): number | null {
    const row = this.db
      .prepare(
        `SELECT rep_score FROM reputation
         WHERE judge_id = ? AND evaluator_version = ? AND judge_version < ?
         ORDER BY judge_version DESC, created_at DESC
         LIMIT 1`,
      )
      .get(judgeId, evaluatorVersion, judgeVersion) as { rep_score: number } | undefined;
    return row ? row.rep_score : null;
  }
}
