import { z } from "zod";

/**
 * judge-me-bro contracts — the single source of truth.
 *
 * Mirrors specs/evaluation.md (Phase 1/2 schemas, §1–§3) and specs/root.md §6
 * (persona, idea, ledger). The markdown judging subagents emit the `*Output`
 * schemas; the harness validates them, computes the derived fields
 * (`weighted_total`, `meta_score`), and assembles the persisted records.
 */

/* ── §1.1 Rubric criteria & meta-dimensions (the only sources of truth) ── */
export const RUBRIC_CRITERIA = ["problem", "solution", "market", "team", "traction"] as const;
export type Criterion = (typeof RUBRIC_CRITERIA)[number];

export const META_DIMENSIONS = ["reasoning_quality", "calibration", "insight", "bias"] as const;
export type MetaDimension = (typeof META_DIMENSIONS)[number];

export const VERDICTS = ["advance", "borderline", "pass"] as const;
export const AGREEMENTS = ["agree", "partially", "disagree"] as const;
export const KINDS = ["judge", "founder"] as const;

export const DEFAULT_EVALUATOR_VERSION = "eval@v1";

/* ── §1.2 Common field types ────────────────────────────────────────────── */
export const Slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "must be kebab-case").max(64);
export const Version = z.number().int().positive();
export const Score10 = z.number().int().min(1).max(10);
export const Unit = z.number().min(0).max(1);
export const EvaluatorVersion = z.string().regex(/^eval@v\d+$/, "must look like eval@v1");
export const IsoTimestamp = z.string().datetime({ offset: true });
export const RunId = z.string().min(1);
export const Kind = z.enum(KINDS);

/** Build a strict object keyed by exactly the five rubric criteria. */
const criterionRecord = <T extends z.ZodTypeAny>(value: T) =>
  z.object({ problem: value, solution: value, market: value, team: value, traction: value });

export const RubricWeights = criterionRecord(z.number().min(0).max(1)).refine(
  (w) => Math.abs(RUBRIC_CRITERIA.reduce((s, c) => s + w[c], 0) - 1) <= 0.01,
  { message: "rubric_weights must sum to 1.0 (±0.01)" },
);
export type RubricWeights = z.infer<typeof RubricWeights>;

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

/* ── root.md §6.1 — Persona frontmatter (the machine contract) ──────────── */
export const PersonaFrontmatter = z.object({
  id: Slug,
  kind: Kind,
  version: Version,
  /** Optional display name for reports; falls back to a title-cased id. */
  name: z.string().min(1).optional(),
  source_urls: z.array(z.string().url()),
  distilled_at: z.string().min(1), // date (2026-06-01) or ISO timestamp
  distilled_by: z.string().min(1), // e.g. distiller@v1
  domains: z.array(z.string()),
  values: z.array(z.string()),
  red_flags: z.array(z.string()),
  rubric_weights: RubricWeights,
  voice: z.string().min(1),
  calibration_notes: z.string().min(1),
});
export type PersonaFrontmatter = z.infer<typeof PersonaFrontmatter>;

/* ── root.md §6.2 — Idea frontmatter ────────────────────────────────────── */
export const IdeaFrontmatter = z.object({
  id: Slug,
  title: z.string().min(1),
  one_liner: z.string().min(1),
  team: z.array(z.string()).default([]),
  // root.md shows a list; evaluation.md §2.6 shows label→url. Accept either.
  links: z.union([z.record(z.string()), z.array(z.string())]).optional(),
});
export type IdeaFrontmatter = z.infer<typeof IdeaFrontmatter>;

/* ── root.md §6.5 — Reputation ledger rows (SQLite) ─────────────────────── */
export const JudgeVersionRow = z.object({
  judge_id: Slug,
  version: Version,
  kind: Kind,
  persona_path: z.string().min(1),
  created_at: IsoTimestamp,
});
export const EvaluatorRow = z.object({
  evaluator_version: EvaluatorVersion,
  rubric_json: z.string(),
  notes: z.string(),
  created_at: IsoTimestamp,
});
export const ReputationRow = z.object({
  judge_id: Slug,
  judge_version: Version,
  evaluator_version: EvaluatorVersion,
  run_id: RunId,
  rep_score: z.number().min(1).max(10),
  n_meta: z.number().int().nonnegative(),
  components_json: z.string(),
  created_at: IsoTimestamp,
});
export type ReputationRow = z.infer<typeof ReputationRow>;

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
