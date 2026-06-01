import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { aggregateRun } from "./reputation.js";
import { assembleMetaEvaluation } from "./meta.js";
import { Store } from "./store.js";
import {
  ReputationComponents,
  type JudgeRef,
  type MetaDimensionsT,
  type MetaEvaluationOutput,
} from "./schemas.js";

const RUN = "2026-06-01T18-00Z";
const EVAL = "eval@v1";

const PG3: JudgeRef = { judge_id: "paul-graham", judge_version: 3, kind: "founder" };

const output = (dimensions: MetaDimensionsT): MetaEvaluationOutput => ({
  dimensions,
  agreement: "partially",
  suggested_total_delta: 0.5,
  counter_verdict: "borderline",
  notes: "Critique notes.",
});

/** Write a meta record targeting `target`, raters chosen distinct from target. */
function writeMeta(
  store: Store,
  rater: JudgeRef,
  target: JudgeRef,
  dimensions: MetaDimensionsT,
  ideaId = "idea-014",
): void {
  const meta = assembleMetaEvaluation({
    run_id: RUN,
    evaluator_version: EVAL,
    rater,
    target,
    idea_id: ideaId,
    output: output(dimensions),
    created_at: "2026-06-01T18:00:00Z",
  });
  store.writeMeta(meta);
}

let root: string;
let store: Store;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "jmb-rep-"));
  store = new Store({ root, dbPath: ":memory:" });
});
afterEach(() => {
  store.close();
  fs.rmSync(root, { recursive: true, force: true });
});

describe("aggregateRun (reputation.md §3, §7.2)", () => {
  /** Seed the §7.2 worked example: three critiques of paul-graham@3. */
  function seedSection72(): void {
    // A {8,6,9,3} -> 7.1 ; B {7,7,6,4} -> 5.9 ; C {9,8,8,2} -> 8.0
    writeMeta(store, { judge_id: "jessica-livingston", judge_version: 2, kind: "founder" }, PG3, {
      reasoning_quality: 8,
      calibration: 6,
      insight: 9,
      bias: 3,
    });
    writeMeta(store, { judge_id: "naval-ravikant", judge_version: 1, kind: "founder" }, PG3, {
      reasoning_quality: 7,
      calibration: 7,
      insight: 6,
      bias: 4,
    });
    writeMeta(store, { judge_id: "dana-reyes", judge_version: 1, kind: "judge" }, PG3, {
      reasoning_quality: 9,
      calibration: 8,
      insight: 8,
      bias: 2,
    });
  }

  it("rep_score is the mean of meta_score (7.00) with n_meta = 3", () => {
    seedSection72();
    const rows = aggregateRun(store, RUN, EVAL);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.judge_id).toBe("paul-graham");
    expect(rows[0]?.judge_version).toBe(3);
    expect(rows[0]?.rep_score).toBe(7.0);
    expect(rows[0]?.n_meta).toBe(3);
  });

  it("component means match §7.2 (8.00 / 7.00 / 7.67 / 3.00)", () => {
    seedSection72();
    const rows = aggregateRun(store, RUN, EVAL);
    const c = ReputationComponents.parse(JSON.parse(rows[0]!.components_json));
    expect(c.reasoning_quality).toBe(8.0);
    expect(c.calibration).toBe(7.0);
    expect(c.insight).toBe(7.67);
    expect(c.bias).toBe(3.0);
  });

  it("appends exactly one reputation row per target (assert via queryReputation)", () => {
    seedSection72();
    // A second target with its own two critiques.
    const JL2: JudgeRef = { judge_id: "jessica-livingston", judge_version: 2, kind: "founder" };
    writeMeta(store, PG3, JL2, { reasoning_quality: 8, calibration: 8, insight: 7, bias: 2 }, "idea-001");
    writeMeta(
      store,
      { judge_id: "marcus-liang", judge_version: 1, kind: "judge" },
      JL2,
      { reasoning_quality: 6, calibration: 8, insight: 9, bias: 2 },
      "idea-002",
    );

    const rows = aggregateRun(store, RUN, EVAL);
    expect(rows).toHaveLength(2);

    const persisted = store.queryReputation({ run_id: RUN });
    expect(persisted).toHaveLength(2);
    const byTarget = Object.fromEntries(persisted.map((r) => [`${r.judge_id}@${r.judge_version}`, r]));
    expect(byTarget["paul-graham@3"]?.rep_score).toBe(7.0);
    expect(byTarget["paul-graham@3"]?.n_meta).toBe(3);
    // JL2: meta_scores -> {8,8,7,2}=0.4*8+0.3*8+0.3*7-0.2*2=7.3 ; {6,8,9,2}=2.4+2.4+2.7-0.4=7.1
    expect(byTarget["jessica-livingston@2"]?.n_meta).toBe(2);
    expect(byTarget["jessica-livingston@2"]?.rep_score).toBe(7.2);
  });

  it("upserts the evaluator row before appending reputation rows", () => {
    seedSection72();
    aggregateRun(store, RUN, EVAL);
    const ev = store.db
      .prepare("SELECT evaluator_version FROM evaluator WHERE evaluator_version = ?")
      .get(EVAL) as { evaluator_version: string } | undefined;
    expect(ev?.evaluator_version).toBe(EVAL);
  });

  it("defaults the evaluator to eval@v1 when omitted", () => {
    seedSection72();
    const rows = aggregateRun(store, RUN);
    expect(rows[0]?.evaluator_version).toBe("eval@v1");
  });

  it("is append-only: re-running adds a second row per target, never mutating the first", () => {
    seedSection72();
    aggregateRun(store, RUN, EVAL);
    aggregateRun(store, RUN, EVAL);
    const persisted = store.queryReputation({ run_id: RUN, judge_id: "paul-graham" });
    expect(persisted).toHaveLength(2);
    expect(persisted.every((r) => r.rep_score === 7.0)).toBe(true);
  });

  it("returns [] and writes nothing when the run has no metas", () => {
    const rows = aggregateRun(store, "empty-run", EVAL);
    expect(rows).toEqual([]);
    expect(store.queryReputation({ run_id: "empty-run" })).toHaveLength(0);
    const ev = store.db.prepare("SELECT COUNT(*) AS n FROM evaluator").get() as { n: number };
    expect(ev.n).toBe(0);
  });
});
