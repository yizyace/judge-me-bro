"use client";

import { useEffect, useReducer } from "react";

import type { JudgeRefName, RunEvent } from "@/lib/events";
import type { IdeaReviewSummary, ReputationReport } from "@/lib/schema";

/* ── Narrowed event payload aliases ──────────────────────────────────────────
   The reducer stores the per-judge / per-pair event payloads verbatim, so we
   alias the relevant `RunEvent` variants by their `type` discriminant. Field
   names therefore stay locked to the canonical contract in `lib/events.ts`. */
export type EvalDone = Extract<RunEvent, { type: "eval_done" }>;
export type MetaDone = Extract<RunEvent, { type: "meta_done" }>;

/** A judge's identity collapsed to its stable key: `${judge_id}@${judge_version}`. */
export type JudgeKey = string;

/** A directed Phase-2 pair key: `${raterKey}->${targetKey}`. */
export type PairKey = string;

/** Stable key for a judge across the run (id + distillation version). */
export function judgeKey(j: { judge_id: string; judge_version: number }): JudgeKey {
  return `${j.judge_id}@${j.judge_version}`;
}

/** Directed key for one rater→target meta-evaluation cell. */
export function pairKey(rater: JudgeKey, target: JudgeKey): PairKey {
  return `${rater}->${target}`;
}

export type RunPhase =
  | "idle"
  | "loading"
  | "phase1"
  | "phase2"
  | "aggregating"
  | "done"
  | "error";

export interface RunStreamState {
  phase: RunPhase;
  idea?: { id: string; title: string; one_liner: string };
  judges: JudgeRefName[];
  /** Phase-1 evaluations keyed by `${judge_id}@${judge_version}`. */
  phase1: Map<JudgeKey, EvalDone>;
  phase1Total: number;
  /** Phase-2 meta-evaluations keyed by `${raterKey}->${targetKey}`. */
  phase2: Map<PairKey, MetaDone>;
  phase2Total: number;
  summary?: IdeaReviewSummary;
  report?: ReputationReport;
  error?: string;
}

/* Reducer actions: each SSE event (already JSON-parsed) plus two control
   actions for the completed-run fast path and transport failures. */
type Action =
  | { kind: "event"; event: RunEvent }
  | { kind: "completed"; report: ReputationReport; summary?: IdeaReviewSummary }
  | { kind: "report"; report: ReputationReport }
  | { kind: "transport_error"; message: string };

function initialState(): RunStreamState {
  // The hook starts probing the leaderboard immediately on mount, so the very
  // first render is already "loading" rather than "idle".
  return {
    phase: "loading",
    judges: [],
    phase1: new Map(),
    phase1Total: 0,
    phase2: new Map(),
    phase2Total: 0,
  };
}

function reducer(state: RunStreamState, action: Action): RunStreamState {
  switch (action.kind) {
    case "completed":
      // Fast path: a finished/seeded run. Persisted report (+ summary) carry
      // the whole story; the phase1/phase2 maps stay empty and that's fine.
      return {
        ...state,
        phase: "done",
        report: action.report,
        summary: action.summary ?? state.summary,
      };

    case "report":
      // `leaderboard_ready` arrived on a live stream: fold in the fetched
      // report and finish.
      return { ...state, phase: "done", report: action.report };

    case "transport_error":
      // Never clobber a successful completion with a late transport blip.
      if (state.phase === "done") return state;
      return { ...state, phase: "error", error: action.message };

    case "event":
      return applyEvent(state, action.event);
  }
}

function applyEvent(state: RunStreamState, event: RunEvent): RunStreamState {
  switch (event.type) {
    case "run_started":
      return {
        ...state,
        phase: "phase1",
        idea: event.idea,
        judges: event.judges,
        phase1Total: event.phase1_total,
        phase2Total: event.phase2_total,
      };

    case "phase":
      // Don't downgrade out of a terminal/error phase.
      if (state.phase === "done" || state.phase === "error") return state;
      return { ...state, phase: event.phase };

    case "eval_done": {
      const next = new Map(state.phase1);
      next.set(judgeKey(event.judge), event);
      return { ...state, phase1: next };
    }

    case "summary_ready":
      return { ...state, summary: event.summary };

    case "meta_done": {
      const next = new Map(state.phase2);
      next.set(pairKey(judgeKey(event.rater), judgeKey(event.target)), event);
      return { ...state, phase2: next };
    }

    case "leaderboard_ready":
      // The report itself is fetched out-of-band (see the effect); here we just
      // note that aggregation finished. `phase` flips to "done" on `report`.
      return state;

    case "error":
      return { ...state, phase: "error", error: event.message };

    case "heartbeat":
      return state;

    default: {
      // Exhaustiveness guard: every `RunEvent` variant is handled above.
      const _never: never = event;
      return _never;
    }
  }
}

/**
 * Drive the run experience for `runId` from a single state machine.
 *
 * On mount it FIRST probes `GET /api/run/<id>/leaderboard`:
 *   • 200 → a completed/seeded run. It also fetches `/summary`, sets
 *     `phase:"done"` with `report` (+ `summary`) and returns WITHOUT opening
 *     the SSE stream — the registry's replay buffer may be long gone.
 *   • 404 → a live (or not-yet-started) run. It opens an `EventSource` on
 *     `/api/run/<id>/stream`, dispatches each typed event into the reducer, and
 *     on `leaderboard_ready` fetches the report then closes the stream.
 *
 * The hook is abort/unmount safe: the probe is cancellable and the stream is
 * always closed on cleanup.
 */
export function useRunStream(runId: string): RunStreamState {
  const [state, dispatch] = useReducer(reducer, undefined, initialState);

  useEffect(() => {
    let cancelled = false;
    let es: EventSource | null = null;
    const ac = new AbortController();

    const dispatchEvent = (raw: string) => {
      if (cancelled) return;
      try {
        dispatch({ kind: "event", event: JSON.parse(raw) as RunEvent });
      } catch {
        /* ignore a malformed frame; the stream continues */
      }
    };

    async function fetchReport(): Promise<ReputationReport | null> {
      try {
        const res = await fetch(`/api/run/${runId}/leaderboard`, {
          signal: ac.signal,
        });
        if (!res.ok) return null;
        return (await res.json()) as ReputationReport;
      } catch {
        return null;
      }
    }

    async function fetchSummary(): Promise<IdeaReviewSummary | undefined> {
      try {
        const res = await fetch(`/api/run/${runId}/summary`, {
          signal: ac.signal,
        });
        if (!res.ok) return undefined;
        return (await res.json()) as IdeaReviewSummary;
      } catch {
        return undefined;
      }
    }

    function openStream() {
      es = new EventSource(`/api/run/${runId}/stream`);

      const TYPES: RunEvent["type"][] = [
        "run_started",
        "phase",
        "eval_done",
        "summary_ready",
        "meta_done",
        "leaderboard_ready",
        "error",
        "heartbeat",
      ];

      for (const t of TYPES) {
        es.addEventListener(t, (e: MessageEvent<string>) => {
          if (t === "leaderboard_ready") {
            // Aggregation done: fetch the persisted report, then finish.
            void fetchReport().then((report) => {
              if (cancelled || !report) return;
              dispatch({ kind: "report", report });
              es?.close();
            });
            return;
          }
          dispatchEvent(e.data);
        });
      }

      // Network-level failure on the SSE connection (not an `error` frame).
      es.onerror = () => {
        // `EventSource` auto-reconnects while CONNECTING; only surface a hard
        // failure once it has actually CLOSED.
        if (es && es.readyState === EventSource.CLOSED && !cancelled) {
          dispatch({
            kind: "transport_error",
            message: "Lost connection to the run stream.",
          });
        }
      };
    }

    // Phase 0: probe for a finished run before deciding to stream.
    (async () => {
      const report = await fetchReport();
      if (cancelled) return;

      if (report) {
        const summary = await fetchSummary();
        if (cancelled) return;
        dispatch({ kind: "completed", report, summary });
        return;
      }

      // No report yet → it's a live (or not-yet-started) run; subscribe to the
      // stream. `phase` stays "loading" until the first `run_started`/`phase`
      // frame moves it to "phase1".
      openStream();
    })();

    return () => {
      cancelled = true;
      ac.abort();
      es?.close();
    };
  }, [runId]);

  return state;
}
