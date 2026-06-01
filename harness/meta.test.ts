import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  validateMetaOutput,
  computeMetaScore,
  assembleMetaEvaluation,
  persistMetaEvaluation,
  type AssembleMetaArgs,
} from "./meta.js";
import { Store } from "./store.js";
import type { JudgeRef, MetaEvaluationOutput } from "./schemas.js";

const PG: JudgeRef = { judge_id: "paul-graham", judge_version: 3, kind: "founder" };
const JL: JudgeRef = { judge_id: "jessica-livingston", judge_version: 2, kind: "founder" };

const OUTPUT = (): MetaEvaluationOutput => ({
  dimensions: { reasoning_quality: 8, calibration: 6, insight: 9, bias: 3 },
  agreement: "partially",
  suggested_total_delta: 0.5,
  counter_verdict: "borderline",
  notes: "Good wedge insight, but slightly harsh on traction given the stage.",
});

const ARGS = (over: Partial<AssembleMetaArgs> = {}): AssembleMetaArgs => ({
  run_id: "2026-06-01T18-00Z",
  evaluator_version: "eval@v1",
  rater: JL,
  target: PG,
  idea_id: "idea-014",
  output: OUTPUT(),
  created_at: "2026-06-01T18:00:00Z",
  ...over,
});

describe("computeMetaScore (evaluation.md §3.7)", () => {
  it("matches the §6 worked example (7.1)", () => {
    expect(computeMetaScore({ reasoning_quality: 8, calibration: 6, insight: 9, bias: 3 })).toBe(7.1);
  });

  it("rounds to 2 decimals", () => {
    // 0.4*7 + 0.3*7 + 0.3*7 - 0.2*1 = 2.8 + 2.1 + 2.1 - 0.2 = 6.8
    expect(computeMetaScore({ reasoning_quality: 7, calibration: 7, insight: 7, bias: 1 })).toBe(6.8);
  });

  it("clamps the ceiling to 10 (all-high, no bias)", () => {
    // raw = 0.4*10 + 0.3*10 + 0.3*10 - 0.2*1 = 9.8 -> within range
    expect(computeMetaScore({ reasoning_quality: 10, calibration: 10, insight: 10, bias: 1 })).toBe(9.8);
    // Force above 10 conceptually is impossible with valid inputs, but the clamp
    // must still never exceed 10 for the max-positive / min-penalty corner.
    const v = computeMetaScore({ reasoning_quality: 10, calibration: 10, insight: 10, bias: 1 });
    expect(v).toBeLessThanOrEqual(10);
    expect(v).toBeGreaterThanOrEqual(1);
  });

  it("clamps the floor to 1 (all-bias / weak signal)", () => {
    // raw = 0.4*1 + 0.3*1 + 0.3*1 - 0.2*10 = 1.0 - 2.0 = -1.0 -> clamps to 1
    expect(computeMetaScore({ reasoning_quality: 1, calibration: 1, insight: 1, bias: 10 })).toBe(1);
  });

  it("stays within [1,10] across the full integer grid", () => {
    for (const rq of [1, 5, 10])
      for (const cal of [1, 5, 10])
        for (const ins of [1, 5, 10])
          for (const bias of [1, 5, 10]) {
            const s = computeMetaScore({ reasoning_quality: rq, calibration: cal, insight: ins, bias });
            expect(s).toBeGreaterThanOrEqual(1);
            expect(s).toBeLessThanOrEqual(10);
          }
  });
});

describe("validateMetaOutput (evaluation.md §3.3, §3.8)", () => {
  it("ok:true for a valid object wrapped in prose / code fence", () => {
    const text = "Sure, here is my critique:\n```json\n" + JSON.stringify(OUTPUT()) + "\n```\nThanks!";
    const res = validateMetaOutput(text);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.dimensions.reasoning_quality).toBe(8);
      expect(res.value.counter_verdict).toBe("borderline");
    }
  });

  it("ok:false for an out-of-range dimension (score > 10)", () => {
    const bad = { ...OUTPUT(), dimensions: { reasoning_quality: 11, calibration: 6, insight: 9, bias: 3 } };
    const res = validateMetaOutput(JSON.stringify(bad));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors).toContain("reasoning_quality");
  });

  it("ok:false for a non-integer / sub-1 dimension", () => {
    const bad = { ...OUTPUT(), dimensions: { reasoning_quality: 8, calibration: 6, insight: 9, bias: 0 } };
    const res = validateMetaOutput(JSON.stringify(bad));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors).toContain("bias");
  });

  it("ok:false for a bad enum (agreement)", () => {
    const bad = { ...OUTPUT(), agreement: "mostly" };
    const res = validateMetaOutput(JSON.stringify(bad));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors).toContain("agreement");
  });

  it("ok:false (fail-closed) when no JSON object is present", () => {
    const res = validateMetaOutput("I refuse to answer.");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors).toContain("extract");
  });
});

describe("assembleMetaEvaluation (evaluation.md §3.4–§3.5)", () => {
  it("throws when rater == target (same id AND version, §3.1)", () => {
    expect(() => assembleMetaEvaluation(ARGS({ rater: PG, target: PG }))).toThrow(/self-exclusion/);
  });

  it("throws on self-exclusion even with a distinct JudgeRef object of the same id+version", () => {
    const twin: JudgeRef = { judge_id: "paul-graham", judge_version: 3, kind: "judge" };
    expect(() => assembleMetaEvaluation(ARGS({ rater: twin, target: PG }))).toThrow(/self-exclusion/);
  });

  it("succeeds for distinct judges and computes meta_score from dimensions, not input", () => {
    const meta = assembleMetaEvaluation(ARGS());
    expect(meta.meta_score).toBe(7.1);
    expect(meta.rater.judge_id).toBe("jessica-livingston");
    expect(meta.target.judge_id).toBe("paul-graham");
    // suggested_total_delta (0.5) is unrelated to meta_score — guards against
    // accidentally trusting any model-supplied number.
    expect(meta.output.suggested_total_delta).toBe(0.5);
  });

  it("allows the same judge_id at a different version (not self)", () => {
    const olderPG: JudgeRef = { judge_id: "paul-graham", judge_version: 2, kind: "founder" };
    const meta = assembleMetaEvaluation(ARGS({ rater: olderPG, target: PG }));
    expect(meta.meta_score).toBe(7.1);
  });

  it("defaults created_at to an ISO timestamp when omitted", () => {
    const meta = assembleMetaEvaluation(ARGS({ created_at: undefined }));
    expect(() => new Date(meta.created_at).toISOString()).not.toThrow();
    expect(meta.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe("persistMetaEvaluation", () => {
  let root: string;
  let store: Store;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "jmb-meta-"));
    store = new Store({ root, dbPath: ":memory:" });
  });
  afterEach(() => {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("writes runs/<id>/meta/<rater>--on--<target>--<idea>.json and returns the record", () => {
    const { path: rel, meta } = persistMetaEvaluation(store, ARGS());
    expect(rel).toBe(
      path.join("runs", "2026-06-01T18-00Z", "meta", "jessica-livingston--on--paul-graham--idea-014.json"),
    );
    expect(fs.existsSync(path.join(root, rel))).toBe(true);
    expect(meta.meta_score).toBe(7.1);
    const back = store.readMetas("2026-06-01T18-00Z");
    expect(back).toHaveLength(1);
    expect(back[0]?.meta_score).toBe(7.1);
  });

  it("does not write anything on a self-exclusion violation (fail-closed)", () => {
    expect(() => persistMetaEvaluation(store, ARGS({ rater: PG, target: PG }))).toThrow(/self-exclusion/);
    expect(store.readMetas("2026-06-01T18-00Z")).toHaveLength(0);
  });
});
