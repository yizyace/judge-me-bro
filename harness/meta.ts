import {
  MetaEvaluationOutput,
  MetaEvaluation,
  sameJudgeVersion,
  type JudgeRef,
  type MetaDimensionsT,
} from "./schemas.js";
import { extractFirstJsonObject, formatZodError, round2, clamp } from "./util.js";
import type { Store } from "./store.js";

/**
 * Phase 2 — judge-to-judge (meta) pipeline (evaluation.md §3).
 *
 * Deterministic, LLM-free harness step: it takes a rater's raw critique text,
 * extracts + validates it against `MetaEvaluationOutput`, computes the derived
 * `meta_score` (§3.7) itself (never trusting the model), enforces self-exclusion
 * (§3.1/§3.8) before and after, and assembles + validates the persisted
 * `MetaEvaluation`. Persistence is delegated to the Store (the only disk owner).
 *
 * Fail-closed (§4): a malformed critique yields `ok:false` (or a thrown error on
 * assembly), never a partial or guessed record.
 */

/** Result of a fallible parse — either the value or agent-readable errors. */
export type Validated<T> = { ok: true; value: T } | { ok: false; errors: string };

/**
 * Extract the first JSON object from the rater's text and validate it against
 * `MetaEvaluationOutput` (evaluation.md §3.3, §3.8). Tolerates prose / code
 * fences. Returns `ok:false` with compact `formatZodError` lines (for the repair
 * loop) on any extraction or schema failure — never throws.
 */
export function validateMetaOutput(rawText: string): Validated<MetaEvaluationOutput> {
  let candidate: unknown;
  try {
    candidate = extractFirstJsonObject(rawText);
  } catch (err) {
    return { ok: false, errors: `- (extract): ${(err as Error).message}` };
  }
  const parsed = MetaEvaluationOutput.safeParse(candidate);
  if (!parsed.success) return { ok: false, errors: formatZodError(parsed.error) };
  return { ok: true, value: parsed.data };
}

/**
 * Single-critique meta-score (evaluator v1, evaluation.md §3.7):
 *   clamp_[1,10]( 0.4·reasoning_quality + 0.3·calibration + 0.3·insight − 0.2·bias )
 * rounded to 2 decimals. `bias` is a penalty axis. Clamp is applied before the
 * round so the result is always a valid `MetaEvaluation.meta_score` (1–10).
 */
export function computeMetaScore(d: MetaDimensionsT): number {
  const raw = 0.4 * d.reasoning_quality + 0.3 * d.calibration + 0.3 * d.insight - 0.2 * d.bias;
  return round2(clamp(raw, 1, 10));
}

/** Inputs for assembling/persisting one `MetaEvaluation` record (§3.4). */
export interface AssembleMetaArgs {
  run_id: string;
  evaluator_version: string;
  rater: JudgeRef;
  target: JudgeRef;
  idea_id: string;
  output: MetaEvaluationOutput;
  created_at?: string;
}

/**
 * Assemble + validate a persisted `MetaEvaluation` (evaluation.md §3.4–§3.5).
 *
 * Guards self-exclusion FIRST (§3.1): a rater critiquing its own distillation
 * (same judge_id AND judge_version) is rejected before anything else. The
 * harness computes `meta_score` (§3.7) from `output.dimensions` — never from the
 * model — then `MetaEvaluation.parse` re-validates the whole record, including a
 * second self-exclusion check (§3.8). `created_at` defaults to now.
 */
export function assembleMetaEvaluation(args: AssembleMetaArgs): MetaEvaluation {
  if (sameJudgeVersion(args.rater, args.target)) {
    throw new Error(
      `self-exclusion: rater must not equal target (${args.rater.judge_id}@${args.rater.judge_version})`,
    );
  }
  const meta_score = computeMetaScore(args.output.dimensions);
  return MetaEvaluation.parse({
    run_id: args.run_id,
    created_at: args.created_at ?? new Date().toISOString(),
    evaluator_version: args.evaluator_version,
    rater: args.rater,
    target: args.target,
    idea_id: args.idea_id,
    output: args.output,
    meta_score,
  });
}

/**
 * Assemble the `MetaEvaluation` and persist it via the Store
 * (`runs/<run_id>/meta/<rater>--on--<target>--<idea>.json`, §3.4). Returns the
 * repo-relative path and the validated record. The Store is the only module
 * that touches disk.
 */
export function persistMetaEvaluation(
  store: Store,
  args: AssembleMetaArgs,
): { path: string; meta: MetaEvaluation } {
  const meta = assembleMetaEvaluation(args);
  const path = store.writeMeta(meta);
  return { path, meta };
}
