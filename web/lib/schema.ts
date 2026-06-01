import { z } from "zod";

/**
 * Client-side zod mirror of the harness contracts.
 *
 * These are a faithful copy of the relevant schemas in
 * `<repo>/harness/schemas.ts` (the single source of truth). They let the web
 * layer parse/validate harness JSON (run.json, report.json, persisted
 * evaluations) without importing the harness package, whose entry points pull
 * in native deps (better-sqlite3). Keep field shapes and constraints in sync
 * with the harness; this file mirrors §1–§3 and the report view schemas.
 *
 * Both the zod schemas and their inferred TS types are exported.
 */

/* ── §1.1 Enumerations (sources of truth) ───────────────────────────────── */
export const RUBRIC_CRITERIA = ["problem", "solution", "market", "team", "traction"] as const;
export type Criterion = (typeof RUBRIC_CRITERIA)[number];

export const META_DIMENSIONS = ["reasoning_quality", "calibration", "insight", "bias"] as const;
export type MetaDimension = (typeof META_DIMENSIONS)[number];

export const VERDICTS = ["advance", "borderline", "pass"] as const;
export const AGREEMENTS = ["agree", "partially", "disagree"] as const;
export const KINDS = ["judge", "founder"] as const;

/* ── §1.2 Common field types ────────────────────────────────────────────── */
export const Slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "must be kebab-case").max(64);
export const Version = z.number().int().positive();
export const Score10 = z.number().int().min(1).max(10);
export const Unit = z.number().min(0).max(1);
export const EvaluatorVersion = z.string().regex(/^eval@v\d+$/, "must look like eval@v1");
export const IsoTimestamp = z.string().datetime({ offset: true });
export const RunId = z.string().min(1);
export const Kind = z.enum(KINDS);
export type Kind = (typeof KINDS)[number];

/** Build a strict object keyed by exactly the five rubric criteria. */
const criterionRecord = <T extends z.ZodTypeAny>(value: T) =>
  z.object({ problem: value, solution: value, market: value, team: value, traction: value });

/* ── §1.3 JudgeRef ──────────────────────────────────────────────────────── */
export const JudgeRef = z.object({ judge_id: Slug, judge_version: Version, kind: Kind });
export type JudgeRef = z.infer<typeof JudgeRef>;

/* ── §2.2 Phase 1 — IdeaEvaluationOutput (what the judge model returns) ──── */
export const Assessment = z.object({ score: Score10, reason: z.string().min(1).max(500) });
export const IdeaEvaluationOutput = z.object({
  assessments: criterionRecord(Assessment),
  verdict: z.enum(VERDICTS),
  confidence: Unit,
  rationale: z.string().min(1).max(2000),
  key_question: z.string().min(1),
  strengths: z.array(z.string()).max(5),
  risks: z.array(z.string()).max(5),
});
export type IdeaEvaluationOutput = z.infer<typeof IdeaEvaluationOutput>;

/* ── §2.3 Phase 1 — IdeaEvaluation (persisted record; harness-assembled) ─── */
export const Scores = criterionRecord(Score10);
export type Scores = z.infer<typeof Scores>;
export const IdeaEvaluation = z.object({
  run_id: RunId,
  created_at: IsoTimestamp,
  evaluator_version: EvaluatorVersion,
  judge: JudgeRef,
  idea_id: Slug,
  scores: Scores,
  weighted_total: z.number().min(1).max(10),
  output: IdeaEvaluationOutput,
});
export type IdeaEvaluation = z.infer<typeof IdeaEvaluation>;

/* ── §3.3 Phase 2 — MetaEvaluationOutput (what the rater model returns) ──── */
export const MetaDimensionsSchema = z.object({
  reasoning_quality: Score10,
  calibration: Score10,
  insight: Score10,
  bias: Score10, // penalty axis: 1 = unbiased … 10 = clearly biased
});
export type MetaDimensionsT = z.infer<typeof MetaDimensionsSchema>;
export const MetaEvaluationOutput = z.object({
  dimensions: MetaDimensionsSchema,
  agreement: z.enum(AGREEMENTS),
  suggested_total_delta: z.number().min(-9).max(9),
  counter_verdict: z.enum(VERDICTS),
  notes: z.string().min(1).max(1500),
});
export type MetaEvaluationOutput = z.infer<typeof MetaEvaluationOutput>;

/** True iff two JudgeRefs are the same distillation (same id AND version). */
export const sameJudgeVersion = (a: JudgeRef, b: JudgeRef): boolean =>
  a.judge_id === b.judge_id && a.judge_version === b.judge_version;

/* ── §3.4 Phase 2 — MetaEvaluation (persisted record; harness-assembled) ─── */
export const MetaEvaluation = z
  .object({
    run_id: RunId,
    created_at: IsoTimestamp,
    evaluator_version: EvaluatorVersion,
    rater: JudgeRef,
    target: JudgeRef,
    idea_id: Slug,
    output: MetaEvaluationOutput,
    meta_score: z.number().min(1).max(10),
  })
  .refine((m) => !sameJudgeVersion(m.rater, m.target), {
    message: "self-exclusion: rater must not equal target (same judge_id and judge_version)",
  });
export type MetaEvaluation = z.infer<typeof MetaEvaluation>;

/* ── Aggregated view consumed by the report (report/leaderboard.html DATA) ─ */
export const ReputationComponents = z.object({
  reasoning_quality: z.number(),
  calibration: z.number(),
  insight: z.number(),
  bias: z.number(),
});
export type ReputationComponents = z.infer<typeof ReputationComponents>;
export const ReputationSnapshot = z.object({
  name: z.string().min(1),
  judge: JudgeRef,
  rep_score: z.number(),
  prev_rep_score: z.number().optional(),
  n_meta: z.number().int().nonnegative(),
  components: ReputationComponents,
});
export type ReputationSnapshot = z.infer<typeof ReputationSnapshot>;
export const ReputationReport = z.object({
  run_id: RunId,
  evaluator_version: EvaluatorVersion,
  snapshots: z.array(ReputationSnapshot),
});
export type ReputationReport = z.infer<typeof ReputationReport>;

/* ── Panel summary view (one consolidated review per run × idea) ─────────── */

/** Per-verdict tallies across the panel's Phase-1 evaluations. */
export const VerdictCounts = z.object({
  advance: z.number().int().nonnegative(),
  borderline: z.number().int().nonnegative(),
  pass: z.number().int().nonnegative(),
});
export type VerdictCounts = z.infer<typeof VerdictCounts>;

/** Per-axis mean scores (1–10, not necessarily integral once averaged). */
export const MeanScores = criterionRecord(z.number().min(1).max(10));
export type MeanScores = z.infer<typeof MeanScores>;

/**
 * A deterministic panel-level synthesis of all of a run's Phase-1 evaluations
 * for ONE idea into a single consolidated review (harness/summary.ts;
 * `computeIdeaReviewSummary`). Mirror of the harness `IdeaReviewSummary`.
 */
export const IdeaReviewSummary = z.object({
  run_id: RunId,
  idea_id: Slug,
  n_judges: z.number().int().nonnegative(),
  verdict_counts: VerdictCounts,
  consensus_verdict: z.enum(VERDICTS),
  mean_weighted_total: z.number().min(1).max(10),
  mean_scores: MeanScores,
  top_strengths: z.array(z.string()).max(5),
  top_risks: z.array(z.string()).max(5),
  key_questions: z.array(z.string()),
  narrative: z.string().min(1),
});
export type IdeaReviewSummary = z.infer<typeof IdeaReviewSummary>;
