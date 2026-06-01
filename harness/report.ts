import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ReputationComponents,
  ReputationReport,
  DEFAULT_EVALUATOR_VERSION,
  type JudgeRef,
  type Kind,
  type ReputationRow,
  type ReputationSnapshot,
} from "./schemas.js";
import type { Store } from "./store.js";

/**
 * Reputation report — view assembly + rendering (reputation.md §3.2, §5).
 *
 * Reads the run's reputation rows from the ledger (written by `aggregateRun`)
 * and turns them into the `ReputationReport` the leaderboard consumes:
 * per-version `ReputationSnapshot`s with a display `name`, parsed component
 * means, and an optional `prev_rep_score` (the same-evaluator predecessor, §5)
 * for the version-delta badge. Rendering targets the tracked HTML template
 * `report/leaderboard.html` (DATA injection) plus a compact markdown leaderboard;
 * both are written to `runs/<run_id>/` via the Store. No LLM, no math beyond the
 * predecessor lookup — the rows were computed upstream.
 */

/** Markers that fence the injectable `const DATA = …;` block in the template. */
const DATA_START = "/* DATA:START */";
const DATA_END = "/* DATA:END */";

/**
 * Default location of the tracked leaderboard template. Resolved relative to
 * this module (repo `report/leaderboard.html`) so it works regardless of cwd;
 * callers may override with an explicit `templatePath`.
 */
const DEFAULT_TEMPLATE_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "report",
  "leaderboard.html",
);

/**
 * Title-case a kebab-case slug for display: `paul-graham` → `Paul Graham`
 * (reputation.md §3.2, persona-schema §2 name fallback). Empty segments are
 * skipped so a stray double-dash still renders cleanly.
 */
export function titleCase(slug: string): string {
  return slug
    .split("-")
    .filter((w) => w.length > 0)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Resolve a scored judge's `kind`: prefer the persona file (`getPersona`), else
 * the `judge_version` ledger table, else default to `"judge"`. Used to build the
 * `JudgeRef` carried by each snapshot when the report can't see the persona.
 */
function resolveKind(store: Store, judgeId: string, judgeVersion: number): Kind {
  const persona = store.getPersona(judgeId, judgeVersion);
  if (persona) return persona.frontmatter.kind;
  const row = store.db
    .prepare(`SELECT kind FROM judge_version WHERE judge_id = ? AND version = ?`)
    .get(judgeId, judgeVersion) as { kind: Kind } | undefined;
  return row?.kind ?? "judge";
}

/** Build one snapshot from a reputation row (reputation.md §3.2). */
function snapshotFromRow(store: Store, row: ReputationRow): ReputationSnapshot {
  const persona = store.getPersona(row.judge_id, row.judge_version);
  const name = persona?.frontmatter.name ?? titleCase(row.judge_id);
  const kind: Kind = persona?.frontmatter.kind ?? resolveKind(store, row.judge_id, row.judge_version);
  const judge: JudgeRef = { judge_id: row.judge_id, judge_version: row.judge_version, kind };
  const components = ReputationComponents.parse(JSON.parse(row.components_json));
  const prev = store.previousRepScore(row.judge_id, row.judge_version, row.evaluator_version);

  const snapshot: ReputationSnapshot = {
    name,
    judge,
    rep_score: row.rep_score,
    n_meta: row.n_meta,
    components,
  };
  // Optional: omit entirely when this is the judge's first version (§5).
  if (prev !== null) snapshot.prev_rep_score = prev;
  return snapshot;
}

/**
 * Build the `ReputationReport` for a run from its ledger rows (reputation.md
 * §3.2). Reads every `reputation` row tagged with this `runId` + `evaluatorVersion`,
 * turns each into a `ReputationSnapshot` (name fallback, parsed components,
 * same-evaluator `prev_rep_score`), and validates the bundle. Snapshots are
 * returned in the ledger's append order; the HTML/markdown renderers sort by
 * `rep_score` for display.
 */
export function buildReport(
  store: Store,
  runId: string,
  evaluatorVersion: string = DEFAULT_EVALUATOR_VERSION,
): ReputationReport {
  const rows = store.queryReputation({ run_id: runId, evaluator_version: evaluatorVersion });
  const snapshots = rows.map((row) => snapshotFromRow(store, row));
  return ReputationReport.parse({ run_id: runId, evaluator_version: evaluatorVersion, snapshots });
}

/**
 * Populate the tracked leaderboard template with a run's report. Reads
 * `templatePath` (default `report/leaderboard.html`), replaces everything between
 * the `/* DATA:START *​/` and `/* DATA:END *​/` markers with a freshly serialized
 * `const DATA = <report>;`, and returns the populated HTML string. The in-file
 * sample data stays the standalone default; only the marker span is swapped.
 * Throws if either marker is missing (the template can't be injected safely).
 */
export function renderLeaderboardHtml(report: ReputationReport, templatePath?: string): string {
  const tpl = templatePath ?? DEFAULT_TEMPLATE_PATH;
  const html = fs.readFileSync(tpl, "utf8");

  const startIdx = html.indexOf(DATA_START);
  const endIdx = html.indexOf(DATA_END);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    throw new Error(
      `leaderboard template ${tpl} is missing the ${DATA_START} … ${DATA_END} markers`,
    );
  }

  const before = html.slice(0, startIdx + DATA_START.length);
  const after = html.slice(endIdx);
  const block = `\nconst DATA = ${JSON.stringify(report, null, 2)};\n`;
  return before + block + after;
}

/** A medal for the top three ranks, else the 1-based rank number. */
function rankCell(i: number): string {
  return ["🥇", "🥈", "🥉"][i] ?? String(i + 1);
}

/** The version-delta cell vs the same-evaluator predecessor (reputation.md §5). */
function deltaCell(s: ReputationSnapshot): string {
  if (s.prev_rep_score == null) return "—";
  const d = Math.round((s.rep_score - s.prev_rep_score) * 10) / 10;
  if (d > 0) return `▲ +${d.toFixed(1)}`;
  if (d < 0) return `▼ ${d.toFixed(1)}`;
  return "– 0.0";
}

/**
 * A compact markdown leaderboard for `runs/<run_id>/report.md`: a header line
 * (run + evaluator) and a table sorted by `rep_score` desc with rank, name,
 * kind, version, rep_score, n_meta, and the version delta (reputation.md §3.2,
 * §5). Rendering only — the numbers come straight from the report.
 */
export function renderReportMarkdown(report: ReputationReport): string {
  const ranked = [...report.snapshots].sort((a, b) => b.rep_score - a.rep_score);
  const lines: string[] = [];
  lines.push("# Judge Me Bro — Reputation Leaderboard");
  lines.push("");
  lines.push(`- **Run:** \`${report.run_id}\``);
  lines.push(`- **Evaluator:** \`${report.evaluator_version}\``);
  lines.push(`- **Judges:** ${ranked.length}`);
  lines.push("");
  lines.push("| Rank | Name | Kind | Ver | Rep | n_meta | Δ vs prev |");
  lines.push("| ---- | ---- | ---- | --- | --- | ------ | -------- |");
  ranked.forEach((s, i) => {
    lines.push(
      `| ${rankCell(i)} | ${s.name} | ${s.judge.kind} | v${s.judge.judge_version} | ${s.rep_score.toFixed(
        2,
      )} | ${s.n_meta} | ${deltaCell(s)} |`,
    );
  });
  lines.push("");
  lines.push(
    "_Reputation = mean `meta_score` across the critiques each judge received (reputation.md §3). " +
      "`bias` is a penalty (lower is better); the Δ column is the change vs the judge's previous " +
      "version under the same evaluator._",
  );
  lines.push("");
  return lines.join("\n");
}

/**
 * Render and persist both report artifacts for a run via the Store: the
 * populated `runs/<run_id>/leaderboard.html` (template DATA injected) and the
 * compact `runs/<run_id>/report.md`. Returns both repo-relative paths. The Store
 * is the only module that touches disk.
 */
export function writeReport(
  store: Store,
  report: ReputationReport,
  templatePath?: string,
): { htmlPath: string; mdPath: string } {
  const html = renderLeaderboardHtml(report, templatePath);
  const md = renderReportMarkdown(report);
  const htmlPath = store.writeRunFile(report.run_id, "leaderboard.html", html);
  const mdPath = store.writeRunFile(report.run_id, "report.md", md);
  return { htmlPath, mdPath };
}
