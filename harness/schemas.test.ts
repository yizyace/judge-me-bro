import { describe, it, expect } from "vitest";
import {
  Slug,
  Score10,
  EvaluatorVersion,
  RubricWeights,
  JudgeRef,
  IdeaEvaluationOutput,
  MetaEvaluation,
  PersonaFrontmatter,
  sameJudgeVersion,
} from "./schemas.js";

describe("primitive field types (§1.2)", () => {
  it("Slug accepts kebab-case, rejects junk", () => {
    expect(Slug.safeParse("paul-graham").success).toBe(true);
    expect(Slug.safeParse("idea-014").success).toBe(true);
    expect(Slug.safeParse("Paul Graham").success).toBe(false);
    expect(Slug.safeParse("UPPER").success).toBe(false);
    expect(Slug.safeParse("-leading").success).toBe(false);
  });

  it("Score10 is an integer 1–10", () => {
    expect(Score10.safeParse(1).success).toBe(true);
    expect(Score10.safeParse(10).success).toBe(true);
    expect(Score10.safeParse(0).success).toBe(false);
    expect(Score10.safeParse(11).success).toBe(false);
    expect(Score10.safeParse(7.5).success).toBe(false);
  });

  it("EvaluatorVersion matches eval@vN", () => {
    expect(EvaluatorVersion.safeParse("eval@v1").success).toBe(true);
    expect(EvaluatorVersion.safeParse("eval@v12").success).toBe(true);
    expect(EvaluatorVersion.safeParse("eval-v1").success).toBe(false);
    expect(EvaluatorVersion.safeParse("v1").success).toBe(false);
  });
});

describe("RubricWeights (§1.2: sum to 1.0 ±0.01)", () => {
  it("accepts weights summing to ~1.0", () => {
    const ok = { problem: 0.3, solution: 0.2, market: 0.2, team: 0.2, traction: 0.1 };
    expect(RubricWeights.safeParse(ok).success).toBe(true);
  });
  it("rejects weights that do not sum to 1.0", () => {
    const bad = { problem: 0.5, solution: 0.2, market: 0.2, team: 0.2, traction: 0.1 };
    expect(RubricWeights.safeParse(bad).success).toBe(false);
  });
  it("rejects a missing criterion", () => {
    const missing = { problem: 0.4, solution: 0.3, market: 0.2, team: 0.1 };
    expect(RubricWeights.safeParse(missing).success).toBe(false);
  });
});

describe("IdeaEvaluationOutput (§2.2)", () => {
  const valid = {
    assessments: {
      problem: { score: 8, reason: "real, frequent pain" },
      solution: { score: 6, reason: "plausible but unproven" },
      market: { score: 7, reason: "every eng team" },
      team: { score: 5, reason: "thin on distribution" },
      traction: { score: 3, reason: "no users yet" },
    },
    verdict: "borderline",
    confidence: 0.6,
    rationale: "Strong wedge, weak proof.",
    key_question: "What makes this 10x?",
    strengths: ["clear pain"],
    risks: ["incumbents can ship this"],
  };

  it("accepts a well-formed output", () => {
    expect(IdeaEvaluationOutput.safeParse(valid).success).toBe(true);
  });
  it("rejects an out-of-range score", () => {
    const bad = structuredClone(valid);
    bad.assessments.problem.score = 11;
    expect(IdeaEvaluationOutput.safeParse(bad).success).toBe(false);
  });
  it("rejects an unknown verdict", () => {
    const bad = { ...valid, verdict: "maybe" };
    expect(IdeaEvaluationOutput.safeParse(bad).success).toBe(false);
  });
  it("rejects more than 5 strengths", () => {
    const bad = { ...valid, strengths: ["a", "b", "c", "d", "e", "f"] };
    expect(IdeaEvaluationOutput.safeParse(bad).success).toBe(false);
  });
});

describe("MetaEvaluation self-exclusion (§3.1)", () => {
  const rater = { judge_id: "jessica-livingston", judge_version: 2, kind: "founder" } satisfies JudgeRef;
  const target = { judge_id: "paul-graham", judge_version: 3, kind: "founder" } satisfies JudgeRef;
  const base = {
    run_id: "2026-06-01T18-00Z",
    created_at: "2026-06-01T18:00:00Z",
    evaluator_version: "eval@v1",
    rater,
    target,
    idea_id: "idea-014",
    output: {
      dimensions: { reasoning_quality: 8, calibration: 6, insight: 9, bias: 3 },
      agreement: "partially",
      suggested_total_delta: 0.5,
      counter_verdict: "borderline",
      notes: "good wedge insight",
    },
    meta_score: 7.1,
  };

  it("accepts a rater different from the target", () => {
    expect(MetaEvaluation.safeParse(base).success).toBe(true);
  });
  it("rejects a rater equal to the target (same id+version)", () => {
    const self = structuredClone(base);
    self.rater = { judge_id: "paul-graham", judge_version: 3, kind: "founder" };
    expect(MetaEvaluation.safeParse(self).success).toBe(false);
  });
  it("sameJudgeVersion compares id and version", () => {
    expect(sameJudgeVersion(base.rater, base.target)).toBe(false);
    expect(sameJudgeVersion(base.target, base.target)).toBe(true);
    expect(
      sameJudgeVersion(base.target, { judge_id: "paul-graham", judge_version: 2, kind: "founder" }),
    ).toBe(false);
  });
});

describe("PersonaFrontmatter (root.md §6.1)", () => {
  const valid = {
    id: "paul-graham",
    kind: "founder",
    version: 3,
    source_urls: ["https://example.com/pg-essay"],
    distilled_at: "2026-06-01",
    distilled_by: "distiller@v1",
    domains: ["b2b", "devtools"],
    values: ["clear wedge"],
    red_flags: ["solution in search of a problem"],
    rubric_weights: { problem: 0.3, solution: 0.2, market: 0.2, team: 0.2, traction: 0.1 },
    voice: "terse, contrarian",
    calibration_notes: "discounts demos",
  };
  it("accepts a valid persona (name optional)", () => {
    expect(PersonaFrontmatter.safeParse(valid).success).toBe(true);
  });
  it("rejects a bad rubric weight sum", () => {
    const bad = structuredClone(valid);
    bad.rubric_weights.problem = 0.9;
    expect(PersonaFrontmatter.safeParse(bad).success).toBe(false);
  });
  it("rejects a non-url source", () => {
    const bad = structuredClone(valid);
    bad.source_urls = ["not a url"];
    expect(PersonaFrontmatter.safeParse(bad).success).toBe(false);
  });
});

describe("JudgeRef", () => {
  it("requires id, version, kind", () => {
    expect(JudgeRef.safeParse({ judge_id: "x", judge_version: 1, kind: "judge" }).success).toBe(true);
    expect(JudgeRef.safeParse({ judge_id: "x", judge_version: 0, kind: "judge" }).success).toBe(false);
    expect(JudgeRef.safeParse({ judge_id: "x", judge_version: 1, kind: "other" }).success).toBe(false);
  });
});
