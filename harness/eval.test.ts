import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Store } from "./store.js";
import { IdeaEvaluation, type IdeaEvaluationOutput, type JudgeRef, type RubricWeights, type Scores } from "./schemas.js";
import {
  validateIdeaOutput,
  computeWeightedTotal,
  assembleIdeaEvaluation,
  assertScoresConsistent,
  persistIdeaEvaluation,
  type AssembleIdeaArgs,
} from "./eval.js";

/* ── Fixtures ──────────────────────────────────────────────────────────── */

// The §6 worked example weights (paul-graham): sum to 1.0.
const WEIGHTS: RubricWeights = { problem: 0.3, solution: 0.2, market: 0.2, team: 0.2, traction: 0.1 };

// A well-formed IdeaEvaluationOutput matching the §2.2 / §6 example.
const goodOutput = (): IdeaEvaluationOutput => ({
  assessments: {
    problem: { score: 8, reason: "real, frequent pain for eng teams" },
    solution: { score: 6, reason: "plausible but unproven triage" },
    market: { score: 7, reason: "every engineering team" },
    team: { score: 5, reason: "thin on distribution" },
    traction: { score: 3, reason: "no users yet" },
  },
  verdict: "borderline",
  confidence: 0.6,
  rationale: "Strong wedge, weak proof. Could be a feature, not a company.",
  key_question: "What makes this 10x better, not 10% better?",
  strengths: ["clear, frequent pain"],
  risks: ["incumbent CI vendors can ship this"],
});

const JUDGE: JudgeRef = { judge_id: "paul-graham", judge_version: 3, kind: "founder" };

const assembleArgs = (overrides: Partial<AssembleIdeaArgs> = {}): AssembleIdeaArgs => ({
  run_id: "run-2026-06-01",
  evaluator_version: "eval@v1",
  judge: JUDGE,
  idea_id: "idea-014",
  output: goodOutput(),
  rubric_weights: WEIGHTS,
  created_at: "2026-06-01T12:00:00Z",
  ...overrides,
});

/* ── computeWeightedTotal (evaluation.md §2.5, §6 worked example) ───────── */

describe("computeWeightedTotal", () => {
  it("equals 6.3 for the §6 worked example", () => {
    const scores: Scores = { problem: 8, solution: 6, market: 7, team: 5, traction: 3 };
    // 8×0.3 + 6×0.2 + 7×0.2 + 5×0.2 + 3×0.1 = 6.3
    expect(computeWeightedTotal(scores, WEIGHTS)).toBe(6.3);
  });

  it("is rounded to 2 decimals", () => {
    const scores: Scores = { problem: 7, solution: 7, market: 7, team: 7, traction: 7 };
    // 7 × (sum of weights = 1.0) = 7
    expect(computeWeightedTotal(scores, WEIGHTS)).toBe(7);
    // a fractional case: weights {0.33,0.33,0.34,...}-style rounding handled by round2
    const w: RubricWeights = { problem: 0.25, solution: 0.25, market: 0.25, team: 0.15, traction: 0.1 };
    // 9×.25 + 4×.25 + 6×.25 + 2×.15 + 8×.1 = 2.25+1+1.5+0.3+0.8 = 5.85
    const s2: Scores = { problem: 9, solution: 4, market: 6, team: 2, traction: 8 };
    expect(computeWeightedTotal(s2, w)).toBe(5.85);
  });
});

/* ── validateIdeaOutput (evaluation.md §2.2, §2.4 step 3–4, §2.7) ──────── */

describe("validateIdeaOutput", () => {
  it("returns ok:true for a well-formed object inside a ```json fence and prose", () => {
    const text = [
      "Here is my evaluation as Paul Graham:",
      "```json",
      JSON.stringify(goodOutput(), null, 2),
      "```",
      "Hope that's useful.",
    ].join("\n");
    const res = validateIdeaOutput(text);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.verdict).toBe("borderline");
      expect(res.value.assessments.problem.score).toBe(8);
    }
  });

  it("returns ok:true for a bare object embedded in prose", () => {
    const text = `Sure thing! ${JSON.stringify(goodOutput())} — let me know if you want changes.`;
    const res = validateIdeaOutput(text);
    expect(res.ok).toBe(true);
  });

  it("returns ok:false with a non-empty errors string for an out-of-range score", () => {
    const bad = goodOutput();
    bad.assessments.problem.score = 11; // > 10
    const res = validateIdeaOutput(JSON.stringify(bad));
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors.length).toBeGreaterThan(0);
      expect(res.errors).toContain("problem");
    }
  });

  it("returns ok:false with a non-empty errors string for a missing criterion", () => {
    const bad = goodOutput() as unknown as { assessments: Record<string, unknown> };
    delete bad.assessments.traction; // drop a required criterion
    const res = validateIdeaOutput(JSON.stringify(bad));
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors.length).toBeGreaterThan(0);
      expect(res.errors).toContain("traction");
    }
  });

  it("returns ok:false when no JSON object is present", () => {
    const res = validateIdeaOutput("I refuse to answer in JSON.");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.length).toBeGreaterThan(0);
  });
});

/* ── assembleIdeaEvaluation (evaluation.md §2.3, §2.4 steps 5–7, §2.7) ─── */

describe("assembleIdeaEvaluation", () => {
  it("produces a record that passes IdeaEvaluation with flattened scores and computed total", () => {
    const ev = assembleIdeaEvaluation(assembleArgs());
    // Re-validating with the schema proves the assembled record is well-formed.
    expect(() => IdeaEvaluation.parse(ev)).not.toThrow();
    expect(ev.scores).toEqual({ problem: 8, solution: 6, market: 7, team: 5, traction: 3 });
    expect(ev.weighted_total).toBe(6.3);
    expect(ev.judge).toEqual(JUDGE);
    expect(ev.idea_id).toBe("idea-014");
    expect(ev.created_at).toBe("2026-06-01T12:00:00Z");
  });

  it("computes weighted_total itself rather than trusting any model-supplied value", () => {
    // The output carries scores summing to 6.3, but if weights change the total
    // must follow the harness math, not anything embedded in the output.
    const flatWeights: RubricWeights = { problem: 0.2, solution: 0.2, market: 0.2, team: 0.2, traction: 0.2 };
    // (8+6+7+5+3) × 0.2 = 29 × 0.2 = 5.8
    const ev = assembleIdeaEvaluation(assembleArgs({ rubric_weights: flatWeights }));
    expect(ev.weighted_total).toBe(5.8);
  });

  it("defaults created_at to an ISO timestamp when omitted", () => {
    const ev = assembleIdeaEvaluation(assembleArgs({ created_at: undefined }));
    // Must be a valid ISO-8601 instant (the schema's IsoTimestamp already enforces this).
    expect(Number.isNaN(Date.parse(ev.created_at))).toBe(false);
  });

  it("THROWS on a consistency mismatch between scores and assessments (§2.7)", () => {
    // Simulate by hand: build scores that diverge from the output's assessments.
    const output = goodOutput();
    const mismatched: Scores = { ...{ problem: 8, solution: 6, market: 7, team: 5, traction: 3 }, problem: 2 };
    expect(() => assertScoresConsistent(mismatched, output)).toThrow(/consistency check failed/);
  });

  it("assertScoresConsistent passes when scores match the assessments", () => {
    const output = goodOutput();
    const scores: Scores = { problem: 8, solution: 6, market: 7, team: 5, traction: 3 };
    expect(() => assertScoresConsistent(scores, output)).not.toThrow();
  });
});

/* ── persistIdeaEvaluation (writes through the store; §2.3 path) ─────────── */

describe("persistIdeaEvaluation", () => {
  let root: string;
  let store: Store;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "jmb-eval-"));
    store = new Store({ root, dbPath: ":memory:" });
  });
  afterEach(() => {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("assembles + writes the evaluation and returns its path", () => {
    const { path: rel, evaluation } = persistIdeaEvaluation(store, assembleArgs());
    expect(rel).toBe(path.join("runs", "run-2026-06-01", "evaluations", "paul-graham@3--idea-014.json"));
    expect(fs.existsSync(path.join(root, rel))).toBe(true);
    expect(evaluation.weighted_total).toBe(6.3);

    // Round-trips back through the store as a schema-valid record.
    const back = store.readEvaluations("run-2026-06-01");
    expect(back).toHaveLength(1);
    expect(back[0]?.weighted_total).toBe(6.3);
    expect(back[0]?.scores).toEqual({ problem: 8, solution: 6, market: 7, team: 5, traction: 3 });
  });

  it("never persists a partial/invalid record: a bad rubric (weights not summing to 1) throws before writing", () => {
    const badWeights = { problem: 0.5, solution: 0.5, market: 0.5, team: 0.5, traction: 0.5 } as RubricWeights;
    expect(() => persistIdeaEvaluation(store, assembleArgs({ rubric_weights: badWeights }))).toThrow();
    // Nothing was written.
    expect(store.readEvaluations("run-2026-06-01")).toHaveLength(0);
  });
});
