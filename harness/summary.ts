import {
  IdeaReviewSummary,
  RUBRIC_CRITERIA,
  VERDICTS,
  type IdeaEvaluation,
  type MeanScores,
  type VerdictCounts,
} from "./schemas.js";
import { round2 } from "./util.js";

/**
 * Panel summary — one consolidated review per run × idea (deterministic, no LLM).
 *
 * `computeIdeaReviewSummary` folds every Phase-1 `IdeaEvaluation` for a single
 * idea into one `IdeaReviewSummary`: verdict tallies + a majority consensus
 * (tie-broken by the mean weighted total), the mean weighted total, per-axis
 * mean scores, pooled-and-deduped strengths/risks, each judge's key question,
 * and a short templated narrative. All numbers are computed here, never taken
 * from a model; rounding follows the harness convention (totals 2dp, axes 1dp).
 */

type Verdict = (typeof VERDICTS)[number];

/** Round to 1 decimal — the per-axis mean convention for the panel summary. */
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Arithmetic mean of a non-empty list (caller guarantees length > 0). */
function mean(xs: number[]): number {
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

/**
 * Map a mean weighted total to a verdict via fixed thresholds (the consensus
 * tie-breaker): `>= 7 → advance`, `>= 4 → borderline`, else `pass`.
 */
function verdictFromMean(meanTotal: number): Verdict {
  if (meanTotal >= 7) return "advance";
  if (meanTotal >= 4) return "borderline";
  return "pass";
}

/**
 * Pool free-text items from every judge, dedupe case-insensitively, and rank by
 * frequency (descending), keeping first-seen order on ties. Returns the original
 * casing of the first occurrence of each distinct item, capped at `limit`.
 */
function pooledTop(lists: string[][], limit: number): string[] {
  const order: string[] = []; // distinct keys in first-seen order
  const display = new Map<string, string>(); // key -> first-seen original casing
  const count = new Map<string, number>();
  for (const list of lists) {
    for (const raw of list) {
      const item = raw.trim();
      if (item.length === 0) continue;
      const key = item.toLowerCase();
      if (!display.has(key)) {
        display.set(key, item);
        order.push(key);
        count.set(key, 0);
      }
      count.set(key, (count.get(key) ?? 0) + 1);
    }
  }
  // Stable sort by frequency desc; first-seen order breaks ties (index in `order`).
  const ranked = order
    .map((key, idx) => ({ key, idx, n: count.get(key) ?? 0 }))
    .sort((a, b) => b.n - a.n || a.idx - b.idx);
  return ranked.slice(0, limit).map((r) => display.get(r.key)!);
}

/** Compose the 1–3 sentence templated synthesis from the aggregates. */
function buildNarrative(
  counts: VerdictCounts,
  consensus: Verdict,
  meanTotal: number,
  topStrength: string | undefined,
  topRisk: string | undefined,
): string {
  const sentences: string[] = [
    `The panel leans ${consensus} (${counts.advance} advance / ${counts.borderline} borderline / ${counts.pass} pass), mean score ${meanTotal.toFixed(2)}/10.`,
  ];
  if (topStrength) sentences.push(`Most-cited strength: ${topStrength}.`);
  if (topRisk) sentences.push(`Sharpest concern: ${topRisk}.`);
  return sentences.join(" ");
}

/**
 * Aggregate all of a run's Phase-1 `IdeaEvaluation`s (for one idea) into a single
 * consolidated `IdeaReviewSummary`. Requires at least one evaluation; the result
 * is validated with `IdeaReviewSummary.parse` before it is returned.
 */
export function computeIdeaReviewSummary(
  runId: string,
  ideaId: string,
  evals: IdeaEvaluation[],
): IdeaReviewSummary {
  if (evals.length === 0) {
    throw new Error("computeIdeaReviewSummary: need at least one evaluation");
  }

  // Verdict tallies across the panel.
  const verdict_counts: VerdictCounts = { advance: 0, borderline: 0, pass: 0 };
  for (const e of evals) verdict_counts[e.output.verdict]++;

  // Mean weighted total (2dp) and the threshold verdict used for tie-breaks.
  const mean_weighted_total = round2(mean(evals.map((e) => e.weighted_total)));
  const thresholdVerdict = verdictFromMean(mean_weighted_total);

  // Majority verdict; on a tie for the top count, fall back to the threshold.
  const maxCount = Math.max(...VERDICTS.map((v) => verdict_counts[v]));
  const leaders = VERDICTS.filter((v) => verdict_counts[v] === maxCount);
  const consensus_verdict: Verdict = leaders.length === 1 ? leaders[0]! : thresholdVerdict;

  // Per-axis mean scores (1dp).
  const mean_scores = {} as MeanScores;
  for (const c of RUBRIC_CRITERIA) {
    mean_scores[c] = round1(mean(evals.map((e) => e.scores[c])));
  }

  // Pooled, deduped, frequency-ranked strengths/risks (~5 each).
  const top_strengths = pooledTop(
    evals.map((e) => e.output.strengths),
    5,
  );
  const top_risks = pooledTop(
    evals.map((e) => e.output.risks),
    5,
  );

  // One key question per judge (in evaluation order).
  const key_questions = evals.map((e) => e.output.key_question);

  const narrative = buildNarrative(
    verdict_counts,
    consensus_verdict,
    mean_weighted_total,
    top_strengths[0],
    top_risks[0],
  );

  return IdeaReviewSummary.parse({
    run_id: runId,
    idea_id: ideaId,
    n_judges: evals.length,
    verdict_counts,
    consensus_verdict,
    mean_weighted_total,
    mean_scores,
    top_strengths,
    top_risks,
    key_questions,
    narrative,
  });
}
