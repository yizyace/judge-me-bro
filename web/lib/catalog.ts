import * as fs from "node:fs";
import * as path from "node:path";
import matter from "gray-matter";

import { REPO_ROOT } from "./repo";

/**
 * Read-only catalog of ideas and judge personas, sourced directly from the
 * repo's markdown frontmatter.
 *
 * These helpers feed the SetupForm. They deliberately read `ideas/*.md` and
 * `personas/{judges,founders}/*.md` with `node:fs` + `gray-matter` rather than
 * going through the harness `store.ts` — the store pulls in native
 * `better-sqlite3`, which we don't want in the Next.js request path. Frontmatter
 * here mirrors `harness/schemas.ts` (`IdeaFrontmatter` / `PersonaFrontmatter`)
 * but is parsed leniently: anything missing/misshapen is skipped or coerced so a
 * single malformed file can't take down the catalog endpoints.
 */

/** One idea as exposed to the SetupForm. */
export type IdeaSummary = {
  id: string;
  title: string;
  one_liner: string;
  team: string[];
};

/** One judge persona as exposed to the SetupForm. */
export type JudgeSummary = {
  judge_id: string;
  judge_version: number;
  kind: string;
  name: string;
  domains: string[];
  values: string[];
  voice: string;
  rubric_weights: Record<string, number>;
};

/** Title-case a slug id (e.g. `drew-mailen` -> `Drew Mailen`). */
function titleCase(id: string): string {
  return id
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Coerce an unknown value into a string[] (drops non-strings). */
function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

/** Coerce an unknown value into a string, falling back to "". */
function toStr(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Coerce rubric_weights into a numeric record (drops non-number entries). */
function toWeights(value: unknown): Record<string, number> {
  if (value === null || typeof value !== "object") return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
  }
  return out;
}

/** List markdown files in `dir` (absolute paths); returns [] if dir is absent. */
function listMarkdown(dir: string): string[] {
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return entries
    .filter((f) => f.endsWith(".md"))
    .map((f) => path.join(dir, f));
}

/** Parse the frontmatter of a markdown file, or null if unreadable. */
function readFrontmatter(file: string): Record<string, unknown> | null {
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
  try {
    return matter(raw).data as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * All ideas from `REPO_ROOT/ideas/*.md`, sorted by id. Each entry needs at least
 * an `id`; missing optional fields fall back to empty values.
 */
export function listIdeas(): IdeaSummary[] {
  const dir = path.join(REPO_ROOT, "ideas");
  const ideas: IdeaSummary[] = [];
  for (const file of listMarkdown(dir)) {
    const fm = readFrontmatter(file);
    if (!fm) continue;
    const id = toStr(fm.id);
    if (!id) continue;
    ideas.push({
      id,
      title: toStr(fm.title),
      one_liner: toStr(fm.one_liner),
      team: toStringArray(fm.team),
    });
  }
  ideas.sort((a, b) => a.id.localeCompare(b.id));
  return ideas;
}

/**
 * All judge personas from `REPO_ROOT/personas/{judges,founders}/*.md`, sorted by
 * id. `name` falls back to a title-cased id. When the same id appears at
 * multiple versions, only the highest version is kept.
 */
export function listJudges(): JudgeSummary[] {
  const dirs = [
    path.join(REPO_ROOT, "personas", "judges"),
    path.join(REPO_ROOT, "personas", "founders"),
  ];
  const byId = new Map<string, JudgeSummary>();
  for (const dir of dirs) {
    for (const file of listMarkdown(dir)) {
      const fm = readFrontmatter(file);
      if (!fm) continue;
      const id = toStr(fm.id);
      if (!id) continue;
      const version =
        typeof fm.version === "number" && Number.isFinite(fm.version) ? fm.version : 0;
      const existing = byId.get(id);
      if (existing && existing.judge_version >= version) continue;
      byId.set(id, {
        judge_id: id,
        judge_version: version,
        kind: toStr(fm.kind),
        name: toStr(fm.name) || titleCase(id),
        domains: toStringArray(fm.domains),
        values: toStringArray(fm.values),
        voice: toStr(fm.voice),
        rubric_weights: toWeights(fm.rubric_weights),
      });
    }
  }
  return [...byId.values()].sort((a, b) => a.judge_id.localeCompare(b.judge_id));
}
