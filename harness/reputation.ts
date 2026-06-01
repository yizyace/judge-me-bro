import {
  ReputationRow,
  ReputationComponents,
  META_DIMENSIONS,
  DEFAULT_EVALUATOR_VERSION,
  type JudgeRef,
  type MetaEvaluation,
} from "./schemas.js";
import { round2 } from "./util.js";
import type { Store } from "./store.js";

/**
 * Reputation aggregation (reputation.md §3, §6) — deterministic, no LLM.
 *
 * Reads the run's Phase-2 `MetaEvaluation` records via the Store, groups them by
 * the **target** judge version `(judge_id, judge_version)`, and rolls each group
 * up into a `rep_score` (the arithmetic mean of the per-critique `meta_score`s,
 * §3) plus the **component means** of the four meta-dimensions (§3.1). One
 * append-only `reputation` row is written per target version; the binding
 * evaluator row is upserted first. All derived numbers are computed here, never
 * by a model, and rounded to 2 decimals (the harness convention).
 */

/** Stable key for a `(judge_id, judge_version)` target group. */
function targetKey(t: JudgeRef): string {
  return `${t.judge_id}@${t.judge_version}`;
}

/**
 * Mean of `meta_score` over a non-empty group of critiques, rounded to 2dp
 * (reputation.md §3). Each `meta_score` is already clamped to `[1,10]`, so the
 * mean is too.
 */
function meanMetaScore(group: MetaEvaluation[]): number {
  const sum = group.reduce((s, m) => s + m.meta_score, 0);
  return round2(sum / group.length);
}

/**
 * Per-dimension means across a group's critiques (reputation.md §3.1), one entry
 * per `META_DIMENSIONS`, each rounded to 2dp. `bias` is the **raw** mean (penalty
 * axis, lower = less biased) — it is not inverted in storage.
 */
function componentMeans(group: MetaEvaluation[]): ReputationComponents {
  const out = {} as Record<(typeof META_DIMENSIONS)[number], number>;
  for (const dim of META_DIMENSIONS) {
    const sum = group.reduce((s, m) => s + m.output.dimensions[dim], 0);
    out[dim] = round2(sum / group.length);
  }
  return ReputationComponents.parse(out);
}

/**
 * Aggregate one run's meta-evaluations into reputation rows (reputation.md §3).
 *
 * Steps:
 *  1. Read all `MetaEvaluation` records for `runId` (already self-excluded at
 *     write time, §2/evaluation.md §3.1).
 *  2. Group by the **target** `(judge_id, judge_version)`.
 *  3. For each group: `rep_score = mean(meta_score)`, `n_meta = count`,
 *     `components = per-dimension means` (§3.1).
 *  4. Upsert the evaluator row (the comparison key, §4), then append one
 *     `reputation` row per target with `components` serialized to
 *     `components_json` (§6).
 *
 * Returns the appended rows (validated `ReputationRow`s) in stable target order.
 * If the run has no metas, no evaluator/rows are written and `[]` is returned.
 */
export function aggregateRun(
  store: Store,
  runId: string,
  evaluatorVersion: string = DEFAULT_EVALUATOR_VERSION,
): ReputationRow[] {
  const metas = store.readMetas(runId);
  if (metas.length === 0) return [];

  // Group critiques by their target judge version, preserving first-seen order.
  const groups = new Map<string, MetaEvaluation[]>();
  for (const m of metas) {
    const key = targetKey(m.target);
    const existing = groups.get(key);
    if (existing) existing.push(m);
    else groups.set(key, [m]);
  }

  // The evaluator binds the rubric + formulas; record it before any rep rows.
  store.upsertEvaluator(
    evaluatorVersion,
    JSON.stringify({ meta_dimensions: META_DIMENSIONS }),
    "Peer-relative meta evaluator (reputation.md §4): rep_score = mean(meta_score).",
  );

  const rows: ReputationRow[] = [];
  for (const group of groups.values()) {
    const target = group[0]!.target;
    const components = componentMeans(group);
    const row = store.appendReputation({
      judge_id: target.judge_id,
      judge_version: target.judge_version,
      evaluator_version: evaluatorVersion,
      run_id: runId,
      rep_score: meanMetaScore(group),
      n_meta: group.length,
      components_json: JSON.stringify(components),
    });
    rows.push(row);
  }
  return rows;
}
