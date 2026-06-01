import {
  IdeaEvaluation,
  IdeaEvaluationOutput,
  RUBRIC_CRITERIA,
  type JudgeRef,
  type RubricWeights,
  type Scores,
} from "./schemas.js";
import { extractFirstJsonObject, formatZodError, round2 } from "./util.js";
import type { Store } from "./store.js";

/**
 * Phase 1 evaluation pipeline (evaluation.md §2, §4) — deterministic, no LLM.
 *
 * Given a judge's raw model text, this module owns the harness-side steps:
 * extract + validate the `IdeaEvaluationOutput`, flatten its per-criterion
 * scores, compute the weighted total from the persona's rubric weights, run the
 * consistency check, assemble + validate the persisted `IdeaEvaluation`, and
 * write it through the store. Derived fields are always computed here, never
 * taken from the model (§4 "determinism of derived fields"), and nothing
 * partial is ever returned or persisted — it fails closed.
 */

/** Result of a validation gate: a parsed value or compact agent-readable errors. */
export type Validated<T> = { ok: true; value: T } | { ok: false; errors: string };

/**
 * Extract the JSON object from raw model text and validate it against
 * `IdeaEvaluationOutput` (evaluation.md §2.2, the validation gate; §2.4 step 3–4).
 * Tolerates surrounding prose / ```json fences via `extractFirstJsonObject`.
 * On any failure (no/invalid JSON, or a schema violation) returns
 * `{ ok: false, errors }` carrying the extraction message or `formatZodError`
 * output, so the repair loop can re-prompt with precise errors.
 */
export function validateIdeaOutput(rawText: string): Validated<IdeaEvaluationOutput> {
  let raw: unknown;
  try {
    raw = extractFirstJsonObject(rawText);
  } catch (err) {
    return { ok: false, errors: err instanceof Error ? err.message : String(err) };
  }
  const parsed = IdeaEvaluationOutput.safeParse(raw);
  if (!parsed.success) return { ok: false, errors: formatZodError(parsed.error) };
  return { ok: true, value: parsed.data };
}

/**
 * Weighted total = Σ_criterion ( scores[c] × rubric_weights[c] ), rounded to 2dp
 * (evaluation.md §2.5). Weights sum to 1.0 and scores are 1–10, so the result
 * is always in [1, 10].
 */
export function computeWeightedTotal(scores: Scores, weights: RubricWeights): number {
  let total = 0;
  for (const c of RUBRIC_CRITERIA) total += scores[c] * weights[c];
  return round2(total);
}

/** Flatten `output.assessments[*].score` into a `scores` map (evaluation.md §2.4 step 5). */
export function flattenScores(output: IdeaEvaluationOutput): Scores {
  const scores = {} as Scores;
  for (const c of RUBRIC_CRITERIA) scores[c] = output.assessments[c].score;
  return scores;
}

/**
 * §2.7 consistency rule — assert `scores[c] === output.assessments[c].score`
 * for all five criteria. A mismatch is a hard error and must never be
 * persisted, so this throws (with the offending criterion) rather than
 * returning. Kept separate from `flattenScores` so the guard is meaningful even
 * if `scores` was produced or mutated elsewhere.
 */
export function assertScoresConsistent(scores: Scores, output: IdeaEvaluationOutput): void {
  for (const c of RUBRIC_CRITERIA) {
    const assessed = output.assessments[c].score;
    if (scores[c] !== assessed) {
      throw new Error(
        `consistency check failed (evaluation.md §2.7): scores.${c}=${scores[c]} !== assessments.${c}.score=${assessed}`,
      );
    }
  }
}

export interface AssembleIdeaArgs {
  run_id: string;
  evaluator_version: string;
  judge: JudgeRef;
  idea_id: string;
  output: IdeaEvaluationOutput;
  rubric_weights: RubricWeights;
  created_at?: string;
}

/**
 * Flatten `output.assessments[*].score` into `scores`, compute the
 * `weighted_total`, and assemble the persisted `IdeaEvaluation` record
 * (evaluation.md §2.3, §2.4 steps 5–7).
 *
 * Enforces the §2.7 consistency rule — `scores[c] === output.assessments[c].score`
 * for all five criteria — and throws on any mismatch (a hard error; never
 * persisted). The assembled record is validated with `IdeaEvaluation.parse`, so
 * provenance, ranges, and the recomputed total are all checked before it is
 * returned. `created_at` defaults to the current time.
 */
export function assembleIdeaEvaluation(args: AssembleIdeaArgs): IdeaEvaluation {
  const { run_id, evaluator_version, judge, idea_id, output, rubric_weights } = args;

  // §2.4 step 5 — flatten assessments → scores, then assert §2.7 consistency.
  const scores = flattenScores(output);
  assertScoresConsistent(scores, output);

  // §2.4 step 6 — harness computes the weighted total (never from the model).
  const weighted_total = computeWeightedTotal(scores, rubric_weights);

  // §2.4 step 7 — assemble + validate before it can be written.
  return IdeaEvaluation.parse({
    run_id,
    created_at: args.created_at ?? new Date().toISOString(),
    evaluator_version,
    judge,
    idea_id,
    scores,
    weighted_total,
    output,
  });
}

/**
 * Assemble the `IdeaEvaluation` (validating it) and persist it through the
 * store to `runs/<run_id>/evaluations/`. Returns the written path and the
 * record. Because assembly validates first, a partial or invalid record is
 * never written (evaluation.md §4 "fail closed").
 */
export function persistIdeaEvaluation(
  store: Store,
  args: AssembleIdeaArgs,
): { path: string; evaluation: IdeaEvaluation } {
  const evaluation = assembleIdeaEvaluation(args);
  const path = store.writeEvaluation(evaluation);
  return { path, evaluation };
}
