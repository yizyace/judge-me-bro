/**
 * Canonical SSE event contract for a judging run.
 *
 * This is the shared wire format between the run route (which spawns the
 * harness / watches `runs/<id>/`) and the browser client. Downstream beads
 * import these types directly, so field names are part of the contract — do
 * NOT rename or reshape them.
 *
 * SSE transport: each event is framed on the wire as
 *
 *     event: <type>\n
 *     data: <json>\n
 *     \n
 *
 * where `<type>` is the `type` discriminant below and `<json>` is the
 * JSON-stringified event object. Clients subscribe per type with
 * `EventSource.addEventListener(type, handler)` and `JSON.parse(e.data)`.
 */

import type { IdeaReviewSummary } from "./schema";

/** A judge/founder reference with its display name, as carried in run events. */
export type JudgeRefName = {
  judge_id: string;
  judge_version: number;
  kind: "judge" | "founder";
  name: string;
};

export type RunEvent =
  | {
      type: "run_started";
      run_id: string;
      evaluator_version: string;
      idea: { id: string; title: string; one_liner: string };
      judges: JudgeRefName[];
      phase1_total: number;
      phase2_total: number;
    }
  | { type: "phase"; phase: "phase1" | "phase2" | "aggregating" | "done" }
  | {
      type: "eval_done";
      idea_id: string;
      judge: JudgeRefName;
      verdict: "advance" | "borderline" | "pass";
      weighted_total: number;
      scores: { problem: number; solution: number; market: number; team: number; traction: number };
      confidence: number;
      rationale: string;
      key_question: string;
      strengths: string[];
      risks: string[];
      done: number;
      total: number;
    }
  | {
      type: "meta_done";
      idea_id: string;
      rater: JudgeRefName;
      target: JudgeRefName;
      meta_score: number;
      agreement: "agree" | "partially" | "disagree";
      dimensions: { reasoning_quality: number; calibration: number; insight: number; bias: number };
      notes: string;
      done: number;
      total: number;
    }
  | { type: "leaderboard_ready"; run_id: string }
  | { type: "summary_ready"; summary: IdeaReviewSummary }
  | { type: "error"; scope: "run" | "phase1" | "phase2" | "aggregate"; message: string; fatal: boolean }
  | { type: "heartbeat"; ts: number };

/** The discriminant literal of every {@link RunEvent} variant. */
export type RunEventType = RunEvent["type"];
