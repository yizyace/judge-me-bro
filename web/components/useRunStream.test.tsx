import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { JudgeRefName, RunEvent } from "@/lib/events";
import type { ReputationReport } from "@/lib/schema";

import { judgeKey, pairKey, useRunStream } from "./useRunStream";

/* ── A controllable mock EventSource ──────────────────────────────────────────
   The hook subscribes per-type via addEventListener; we record handlers keyed
   by type and expose `emit(type, data)` to drive a recorded RunEvent sequence.
   Each emit wraps the event JSON in a MessageEvent-like `{ data }` payload, the
   same shape the real transport delivers. */
class MockEventSource {
  static instances: MockEventSource[] = [];
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;

  url: string;
  readyState = MockEventSource.OPEN;
  onerror: ((this: EventSource, ev: Event) => unknown) | null = null;
  private listeners = new Map<string, Array<(e: { data: string }) => void>>();

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, handler: (e: { data: string }) => void) {
    const arr = this.listeners.get(type) ?? [];
    arr.push(handler);
    this.listeners.set(type, arr);
  }

  close() {
    this.readyState = MockEventSource.CLOSED;
  }

  /** Fire a typed event into the hook with `data` = JSON of the RunEvent. */
  emit(type: string, payload: unknown) {
    const data = JSON.stringify(payload);
    for (const h of this.listeners.get(type) ?? []) h({ data });
  }
}

/* ── Judge refs + a recorded event log (run_started → … → done) ───────────── */
const A: JudgeRefName = { judge_id: "vatsa-shah", judge_version: 1, kind: "judge", name: "Vatsa Shah" };
const B: JudgeRefName = { judge_id: "daniel-merja", judge_version: 1, kind: "judge", name: "Daniel Merja" };

const REPORT: ReputationReport = {
  run_id: "run-xyz",
  evaluator_version: "eval@v1",
  snapshots: [
    {
      name: "Vatsa Shah",
      judge: A,
      rep_score: 7.5,
      n_meta: 1,
      components: { reasoning_quality: 8, calibration: 7, insight: 8, bias: 2 },
    },
    {
      name: "Daniel Merja",
      judge: B,
      rep_score: 6.9,
      n_meta: 1,
      components: { reasoning_quality: 8, calibration: 6, insight: 8, bias: 3 },
    },
  ],
};

const SUMMARY = {
  run_id: "run-xyz",
  idea_id: "idea-001",
  n_judges: 2,
  verdict_counts: { advance: 1, borderline: 1, pass: 0 },
  consensus_verdict: "borderline" as const,
  mean_weighted_total: 7.1,
  mean_scores: { problem: 8, solution: 7, market: 7, team: 8, traction: 6 },
  top_strengths: ["clear wedge"],
  top_risks: ["distribution"],
  key_questions: ["who pays first?"],
  narrative: "A promising but unproven idea.",
};

function evalDone(judge: JudgeRefName, done: number): RunEvent {
  return {
    type: "eval_done",
    idea_id: "idea-001",
    judge,
    verdict: "advance",
    weighted_total: 7.4,
    scores: { problem: 8, solution: 7, market: 7, team: 8, traction: 6 },
    confidence: 0.7,
    rationale: "reasoned",
    key_question: "q?",
    strengths: ["s"],
    risks: ["r"],
    done,
    total: 2,
  };
}

function metaDone(rater: JudgeRefName, target: JudgeRefName, done: number): RunEvent {
  return {
    type: "meta_done",
    idea_id: "idea-001",
    rater,
    target,
    meta_score: 7,
    agreement: "agree",
    dimensions: { reasoning_quality: 8, calibration: 7, insight: 8, bias: 2 },
    notes: "solid",
    done,
    total: 2,
  };
}

const RUN_STARTED: RunEvent = {
  type: "run_started",
  run_id: "run-xyz",
  evaluator_version: "eval@v1",
  idea: { id: "idea-001", title: "Idea One", one_liner: "do a thing" },
  judges: [A, B],
  phase1_total: 2,
  phase2_total: 2,
};

/* ── fetch mock: leaderboard 404 until `armReport()`, then 200 ─────────────── */
let reportArmed = false;

beforeEach(() => {
  MockEventSource.instances = [];
  reportArmed = false;
  vi.stubGlobal("EventSource", MockEventSource as unknown as typeof EventSource);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/leaderboard")) {
        return reportArmed
          ? new Response(JSON.stringify(REPORT), { status: 200 })
          : new Response("not found", { status: 404 });
      }
      if (url.includes("/summary")) {
        return new Response(JSON.stringify(SUMMARY), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The single live MockEventSource the hook opened (after the 404 probe). */
function liveStream(): MockEventSource {
  const es = MockEventSource.instances.at(-1);
  if (!es) throw new Error("hook did not open an EventSource");
  return es;
}

describe("useRunStream reducer", () => {
  it("drives phase1 → phase2 → done over a recorded event log", async () => {
    const { result } = renderHook(() => useRunStream("run-xyz"));

    // Mount probes /leaderboard (404) then opens the stream; phase stays loading.
    await waitFor(() => expect(MockEventSource.instances.length).toBe(1));
    expect(result.current.phase).toBe("loading");

    const es = liveStream();
    expect(es.url).toContain("/api/run/run-xyz/stream");

    // run_started → phase1, idea + judges + totals populate.
    act(() => es.emit("run_started", RUN_STARTED));
    expect(result.current.phase).toBe("phase1");
    expect(result.current.idea?.id).toBe("idea-001");
    expect(result.current.judges).toHaveLength(2);
    expect(result.current.phase1Total).toBe(2);
    expect(result.current.phase2Total).toBe(2);

    // eval_done × N → phase1 map fills, keyed by judge_id@version.
    act(() => es.emit("eval_done", evalDone(A, 1)));
    act(() => es.emit("eval_done", evalDone(B, 2)));
    expect(result.current.phase1.size).toBe(2);
    expect(result.current.phase1.get(judgeKey(A))?.weighted_total).toBe(7.4);
    expect(result.current.phase1.get(judgeKey(B))?.verdict).toBe("advance");

    // summary_ready → summary populates.
    act(() => es.emit("summary_ready", { type: "summary_ready", summary: SUMMARY }));
    expect(result.current.summary?.consensus_verdict).toBe("borderline");
    expect(result.current.summary?.narrative).toContain("promising");

    // phase → phase2 transition.
    act(() => es.emit("phase", { type: "phase", phase: "phase2" }));
    expect(result.current.phase).toBe("phase2");

    // meta_done × M → phase2 map fills, keyed by rater->target.
    act(() => es.emit("meta_done", metaDone(A, B, 1)));
    act(() => es.emit("meta_done", metaDone(B, A, 2)));
    expect(result.current.phase2.size).toBe(2);
    expect(result.current.phase2.get(pairKey(judgeKey(A), judgeKey(B)))?.agreement).toBe("agree");
    expect(result.current.phase2.has(pairKey(judgeKey(B), judgeKey(A)))).toBe(true);

    // leaderboard_ready → hook re-fetches /leaderboard (now 200) → done + report.
    reportArmed = true;
    act(() => es.emit("leaderboard_ready", { type: "leaderboard_ready", run_id: "run-xyz" }));

    await waitFor(() => expect(result.current.phase).toBe("done"));
    expect(result.current.report?.run_id).toBe("run-xyz");
    expect(result.current.report?.snapshots).toHaveLength(2);

    // Stream closed after the report landed.
    await waitFor(() => expect(es.readyState).toBe(MockEventSource.CLOSED));

    // Phase-1/phase-2/summary all survived the transition to done.
    expect(result.current.phase1.size).toBe(2);
    expect(result.current.phase2.size).toBe(2);
    expect(result.current.summary?.consensus_verdict).toBe("borderline");
  });

  it("takes the completed-run fast path when /leaderboard already exists", async () => {
    // Arm the report up front: the mount probe returns 200, so no stream opens.
    reportArmed = true;
    const { result } = renderHook(() => useRunStream("run-xyz"));

    await waitFor(() => expect(result.current.phase).toBe("done"));
    expect(result.current.report?.run_id).toBe("run-xyz");
    // Fast path also pulls /summary.
    expect(result.current.summary?.run_id).toBe("run-xyz");
    // It must NOT open an EventSource for a finished run.
    expect(MockEventSource.instances).toHaveLength(0);
  });
});
