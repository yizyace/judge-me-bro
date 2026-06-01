import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

import { listIdeas } from "./catalog";
import type { JudgeRefName, RunEvent } from "./events";
import { aggregate, REPO_ROOT, renderReport, renderReportJson, renderSummaryJson } from "./repo";
import { IdeaEvaluation, IdeaReviewSummary, MetaEvaluation } from "./schema";
import { spawnHeadlessRun } from "./spawn";

/**
 * In-process orchestration state + progress registry for a judging run.
 *
 * One headless `claude -p` orchestrator (spawn.ts) runs the real skills and the
 * harness persists each record into `runs/<id>/{evaluations,meta}/`. This module
 * watches those directories with `fs.watch`, translates each new file into a
 * {@link RunEvent}, buffers the stream, and fans it out to SSE subscribers. It
 * sequences the pipeline:
 *
 *   run_started
 *     → Phase 1 (eval_done × phase1_total)
 *       → BARRIER: summary_ready + phase:"phase2"
 *         → Phase 2 (meta_done × phase2_total)
 *           → child exit / PHASE2_COMPLETE
 *             → phase:"aggregating" → reputation + report + report:json
 *               → leaderboard_ready → phase:"done"
 *
 * A single-run lock keeps only one non-terminal run active at a time (this is a
 * single-tenant local app driving one subscription).
 */

/* ── Tunables ────────────────────────────────────────────────────────────── */

/** Overall wall-clock budget for a run before we SIGTERM/SIGKILL the child. */
const RUN_WALL_CLOCK_MS = 25 * 60 * 1000;
/** Grace period between SIGTERM and SIGKILL. */
const SIGKILL_GRACE_MS = 10 * 1000;
/** Heartbeat cadence while a run is live. */
const HEARTBEAT_MS = 15 * 1000;
/** Per-phase stall watchdog: warn (non-fatal) if no progress for this long. */
const STALL_WATCHDOG_MS = 5 * 60 * 1000;

/* ── State ───────────────────────────────────────────────────────────────── */

/** Phase discriminant tracked per run (superset of the wire `phase` values). */
export type RunPhase = "phase1" | "phase2" | "aggregating" | "done" | "error";

/** Progress counters for the two judging phases. */
export type RunCounts = {
  phase1_done: number;
  phase1_total: number;
  phase2_done: number;
  phase2_total: number;
};

/** Full in-memory state for one run. */
export type RunState = {
  runId: string;
  phase: RunPhase;
  child: ChildProcess | null;
  /** Active fs.watch handles + timers, torn down on terminal. */
  watchers: Array<{ close: () => void }>;
  emitter: EventEmitter;
  buffer: RunEvent[];
  counts: RunCounts;
  judges: JudgeRefName[];
  idea: { id: string; title: string; one_liner: string };
  evaluator: string;
};

// Cross-module singleton. Next.js may evaluate this module more than once (a
// separate bundle per route segment, plus HMR in dev), and a plain module-level
// `new Map()` would give each copy its own registry — so `POST /api/run`
// (startRun) and `GET /api/run/[id]/stream` (subscribeRun) would never see the
// same runs. Pin the Map to globalThis so every route module in the single Node
// server process shares one registry (and it survives HMR).
const globalForRuns = globalThis as unknown as { __jmbRuns?: Map<string, RunState> };
const runs: Map<string, RunState> = (globalForRuns.__jmbRuns ??= new Map<string, RunState>());

/** True iff the run is in a terminal phase (no longer holds the lock). */
function isTerminal(state: RunState): boolean {
  return state.phase === "done" || state.phase === "error";
}

/* ── Single-run lock ─────────────────────────────────────────────────────── */

/**
 * Acquire the global single-run lock. Returns false if any run is currently in
 * a non-terminal phase (one live judging run at a time).
 */
export function acquireRunLock(): boolean {
  for (const state of runs.values()) {
    if (!isTerminal(state)) return false;
  }
  return true;
}

/** Release the lock (idempotent). Terminal runs no longer hold it. */
export function releaseRunLock(): void {
  // The lock is implicit in "is any run non-terminal"; flipping a run to a
  // terminal phase releases it. This explicit hook exists for callers/tests and
  // as the documented release point in the lifecycle.
}

/* ── run.json plan shape (mirrors run:init output) ───────────────────────── */

type PlanJudge = {
  judge_id: string;
  judge_version: number;
  kind: "judge" | "founder";
  name: string;
  persona_path: string;
};
type PlanIdea = { id: string; path: string; title: string };
type Plan = {
  run_id: string;
  evaluator_version: string;
  judges: PlanJudge[];
  ideas: PlanIdea[];
};

function readPlan(runId: string): Plan {
  const planPath = path.join(REPO_ROOT, "runs", runId, "run.json");
  const raw = fs.readFileSync(planPath, "utf8");
  return JSON.parse(raw) as Plan;
}

/* ── Public API ──────────────────────────────────────────────────────────── */

/** Look up live state for a run (used by the SSE route + tests). */
export function getRun(runId: string): RunState | undefined {
  return runs.get(runId);
}

/**
 * Start a judging run: read the scoped plan, spawn the headless orchestrator,
 * watch `runs/<id>/{evaluations,meta}/` for persisted records, and drive the
 * phase sequence. Returns the freshly-created {@link RunState}.
 *
 * The caller is responsible for {@link acquireRunLock} first; if the lock is
 * held this throws (defense in depth).
 */
export function startRun(runId: string, evaluator = "eval@v1"): RunState {
  if (!acquireRunLock()) {
    throw new Error("a judging run is already active (single-run lock held)");
  }

  const plan = readPlan(runId);
  const evaluatorVersion = plan.evaluator_version || evaluator;

  // judge_id → display name, for enriching the bare JudgeRefs in persisted files.
  // run.json's name falls back to the id when a persona has no `name` frontmatter,
  // so title-case the slug for display (the leaderboard does the same in buildReport).
  const nameById = new Map<string, string>();
  for (const j of plan.judges) nameById.set(j.judge_id, displayName(j));

  const judges: JudgeRefName[] = plan.judges.map((j) => ({
    judge_id: j.judge_id,
    judge_version: j.judge_version,
    kind: j.kind,
    name: displayName(j),
  }));

  const nJudges = plan.judges.length;
  const nIdeas = plan.ideas.length;
  const phase1_total = nJudges * nIdeas;
  const phase2_total = nJudges * Math.max(nJudges - 1, 0) * nIdeas;

  // The plan idea entries carry no one_liner; pull it from the catalog (falls
  // back to "" if the idea markdown is missing it).
  const firstIdea = plan.ideas[0];
  const oneLiners = new Map(listIdeas().map((i) => [i.id, i.one_liner]));
  const idea = {
    id: firstIdea?.id ?? "",
    title: firstIdea?.title ?? "",
    one_liner: firstIdea ? (oneLiners.get(firstIdea.id) ?? "") : "",
  };

  const state: RunState = {
    runId,
    phase: "phase1",
    child: null,
    watchers: [],
    emitter: new EventEmitter(),
    buffer: [],
    counts: { phase1_done: 0, phase1_total, phase2_done: 0, phase2_total },
    judges,
    idea,
    evaluator: evaluatorVersion,
  };
  // Allow many SSE subscribers without Node's leak warning.
  state.emitter.setMaxListeners(0);
  runs.set(runId, state);

  /** Append to buffer AND notify live subscribers. */
  const emit = (event: RunEvent): void => {
    state.buffer.push(event);
    state.emitter.emit("event", event);
  };

  // Track last-progress time for the stall watchdog (any eval/meta resets it).
  let lastProgressAt = Date.now();
  const markProgress = (): void => {
    lastProgressAt = Date.now();
  };

  emit({
    type: "run_started",
    run_id: runId,
    evaluator_version: evaluatorVersion,
    idea,
    judges,
    phase1_total,
    phase2_total,
  });
  emit({ type: "phase", phase: "phase1" });

  /* ── Phase transitions ───────────────────────────────────────────────── */

  let summaryEmitted = false;
  /** Phase-1 barrier: once every eval has landed, synthesize the panel summary. */
  const maybeCrossPhase1Barrier = async (): Promise<void> => {
    if (summaryEmitted) return;
    if (phase1_total === 0 || state.counts.phase1_done < phase1_total) return;
    summaryEmitted = true;
    try {
      const summaryRaw = await renderSummaryJson(runId, evaluatorVersion);
      const summary = IdeaReviewSummary.parse(summaryRaw);
      emit({ type: "summary_ready", summary });
    } catch (err) {
      // Non-fatal: the summary is a convenience view; keep the run going.
      emit({
        type: "error",
        scope: "phase1",
        message: `summary render failed: ${errMsg(err)}`,
        fatal: false,
      });
    }
    state.phase = "phase2";
    emit({ type: "phase", phase: "phase2" });
  };

  let aggregated = false;
  /** Phase-3: aggregate reputation + render reports, then go terminal. */
  const runAggregation = async (): Promise<void> => {
    if (aggregated) return;
    aggregated = true;
    state.phase = "aggregating";
    emit({ type: "phase", phase: "aggregating" });
    try {
      await aggregate(runId, evaluatorVersion);
      await renderReport(runId, evaluatorVersion);
      await renderReportJson(runId, evaluatorVersion);
      emit({ type: "leaderboard_ready", run_id: runId });
      finish("done");
    } catch (err) {
      emit({
        type: "error",
        scope: "aggregate",
        message: `aggregation failed: ${errMsg(err)}`,
        fatal: true,
      });
      finish("error");
    }
  };

  /** Tear everything down and move to a terminal phase (releases the lock). */
  const finish = (phase: "done" | "error"): void => {
    if (isTerminal(state)) return;
    state.phase = phase;
    if (phase === "done") emit({ type: "phase", phase: "done" });
    for (const w of state.watchers.splice(0)) {
      try {
        w.close();
      } catch {
        /* best effort */
      }
    }
    releaseRunLock();
  };

  /* ── Directory watchers ──────────────────────────────────────────────── */

  const evalDir = path.join(REPO_ROOT, "runs", runId, "evaluations");
  const metaDir = path.join(REPO_ROOT, "runs", runId, "meta");
  // Create the dirs up front so fs.watch attaches; the harness will populate.
  fs.mkdirSync(evalDir, { recursive: true });
  fs.mkdirSync(metaDir, { recursive: true });

  const seenEvals = new Set<string>();
  const seenMeta = new Set<string>();

  /** Handle one newly-observed evaluations/*.json. */
  const onEvalFile = (file: string): void => {
    if (seenEvals.has(file)) return;
    const full = path.join(evalDir, file);
    let evalRecord;
    try {
      evalRecord = IdeaEvaluation.parse(JSON.parse(fs.readFileSync(full, "utf8")));
    } catch {
      // File may still be mid-write; leave it unseen so a later event retries.
      return;
    }
    seenEvals.add(file);
    state.counts.phase1_done += 1;
    markProgress();
    const judge: JudgeRefName = {
      judge_id: evalRecord.judge.judge_id,
      judge_version: evalRecord.judge.judge_version,
      kind: evalRecord.judge.kind,
      name: nameById.get(evalRecord.judge.judge_id) ?? evalRecord.judge.judge_id,
    };
    emit({
      type: "eval_done",
      idea_id: evalRecord.idea_id,
      judge,
      verdict: evalRecord.output.verdict,
      weighted_total: evalRecord.weighted_total,
      scores: evalRecord.scores,
      confidence: evalRecord.output.confidence,
      rationale: evalRecord.output.rationale,
      key_question: evalRecord.output.key_question,
      strengths: evalRecord.output.strengths,
      risks: evalRecord.output.risks,
      done: state.counts.phase1_done,
      total: phase1_total,
    });
    void maybeCrossPhase1Barrier();
  };

  /** Handle one newly-observed meta/*.json. */
  const onMetaFile = (file: string): void => {
    if (seenMeta.has(file)) return;
    const full = path.join(metaDir, file);
    let metaRecord;
    try {
      metaRecord = MetaEvaluation.parse(JSON.parse(fs.readFileSync(full, "utf8")));
    } catch {
      return;
    }
    seenMeta.add(file);
    state.counts.phase2_done += 1;
    markProgress();
    const rater: JudgeRefName = {
      judge_id: metaRecord.rater.judge_id,
      judge_version: metaRecord.rater.judge_version,
      kind: metaRecord.rater.kind,
      name: nameById.get(metaRecord.rater.judge_id) ?? metaRecord.rater.judge_id,
    };
    const target: JudgeRefName = {
      judge_id: metaRecord.target.judge_id,
      judge_version: metaRecord.target.judge_version,
      kind: metaRecord.target.kind,
      name: nameById.get(metaRecord.target.judge_id) ?? metaRecord.target.judge_id,
    };
    emit({
      type: "meta_done",
      idea_id: metaRecord.idea_id,
      rater,
      target,
      meta_score: metaRecord.meta_score,
      agreement: metaRecord.output.agreement,
      dimensions: metaRecord.output.dimensions,
      notes: metaRecord.output.notes,
      done: state.counts.phase2_done,
      total: phase2_total,
    });
  };

  // Scan a directory once for any files we haven't processed (covers files that
  // landed before the watcher attached, and recursive-watch quirks).
  const scanEvalDir = (): void => {
    let files: string[];
    try {
      files = fs.readdirSync(evalDir);
    } catch {
      return;
    }
    for (const f of files) if (f.endsWith(".json")) onEvalFile(f);
  };
  const scanMetaDir = (): void => {
    let files: string[];
    try {
      files = fs.readdirSync(metaDir);
    } catch {
      return;
    }
    for (const f of files) if (f.endsWith(".json")) onMetaFile(f);
  };

  // fs.watch fires on rename (create) and change; we re-scan the dir on any
  // event rather than trusting the per-event filename (more robust across
  // platforms, and dedupe via the seen-sets makes re-scans cheap).
  const evalWatcher = fs.watch(evalDir, () => scanEvalDir());
  const metaWatcher = fs.watch(metaDir, () => scanMetaDir());
  state.watchers.push(evalWatcher, metaWatcher);
  // Pick up anything already present.
  scanEvalDir();
  scanMetaDir();

  /* ── Heartbeat + stall watchdog ──────────────────────────────────────── */

  const heartbeat = setInterval(() => {
    if (isTerminal(state)) return;
    emit({ type: "heartbeat", ts: Date.now() });
  }, HEARTBEAT_MS);
  heartbeat.unref?.();
  state.watchers.push({ close: () => clearInterval(heartbeat) });

  const stallWatchdog = setInterval(() => {
    if (isTerminal(state)) return;
    if (state.phase !== "phase1" && state.phase !== "phase2") return;
    if (Date.now() - lastProgressAt < STALL_WATCHDOG_MS) return;
    lastProgressAt = Date.now(); // throttle to one warning per window
    emit({
      type: "error",
      scope: state.phase === "phase1" ? "phase1" : "phase2",
      message: `no progress for ${Math.round(STALL_WATCHDOG_MS / 1000)}s — run may be stalled`,
      fatal: false,
    });
  }, STALL_WATCHDOG_MS);
  stallWatchdog.unref?.();
  state.watchers.push({ close: () => clearInterval(stallWatchdog) });

  /* ── Spawn the headless orchestrator ─────────────────────────────────── */

  const child = spawnHeadlessRun(runId);
  state.child = child;

  let phase2SentinelSeen = false;
  child.stdout?.on("data", (chunk: Buffer) => {
    // Durable progress is the files on disk; stdout is only tailed for the
    // PHASE2_COMPLETE sentinel so we can react slightly ahead of the exit.
    if (!phase2SentinelSeen && chunk.toString("utf8").includes("PHASE2_COMPLETE")) {
      phase2SentinelSeen = true;
      scanEvalDir();
      scanMetaDir();
      void maybeCrossPhase1Barrier().then(() => void runAggregation());
    }
  });
  // Drain stderr so the pipe never blocks the child; surface nothing by default.
  child.stderr?.on("data", () => {});

  child.on("error", (err) => {
    emit({
      type: "error",
      scope: "run",
      message: `failed to spawn claude: ${errMsg(err)}`,
      fatal: true,
    });
    finish("error");
  });

  child.on("exit", (code) => {
    if (isTerminal(state)) return;
    // Final sweep so late files are counted before we aggregate.
    scanEvalDir();
    scanMetaDir();
    if (code !== null && code !== 0 && state.counts.phase1_done < phase1_total) {
      // Nonzero exit before even finishing Phase 1: fatal, but still try to
      // aggregate whatever landed so a partial leaderboard is available.
      emit({
        type: "error",
        scope: "run",
        message: `orchestrator exited with code ${code} before Phase 1 completed`,
        fatal: true,
      });
    }
    void maybeCrossPhase1Barrier().then(() => void runAggregation());
  });

  /* ── Overall wall-clock timeout ──────────────────────────────────────── */

  const wallClock = setTimeout(() => {
    if (isTerminal(state)) return;
    emit({
      type: "error",
      scope: "run",
      message: `run exceeded ${Math.round(RUN_WALL_CLOCK_MS / 60000)}min wall clock — terminating`,
      fatal: false,
    });
    try {
      child.kill("SIGTERM");
    } catch {
      /* already gone */
    }
    const hardKill = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* already gone */
      }
      // Even if the child never exits cleanly, aggregate what landed.
      scanEvalDir();
      scanMetaDir();
      void maybeCrossPhase1Barrier().then(() => void runAggregation());
    }, SIGKILL_GRACE_MS);
    hardKill.unref?.();
    state.watchers.push({ close: () => clearTimeout(hardKill) });
  }, RUN_WALL_CLOCK_MS);
  wallClock.unref?.();
  state.watchers.push({ close: () => clearTimeout(wallClock) });

  return state;
}

/**
 * Subscribe to a run's event stream. Replays the buffered events immediately
 * (so a reconnecting SSE client catches up), then forwards every future event.
 * Returns an unsubscribe function.
 */
export function subscribeRun(runId: string, cb: (e: RunEvent) => void): () => void {
  const state = runs.get(runId);
  if (!state) {
    // Unknown run: nothing to replay, nothing to forward.
    return () => {};
  }
  // Replay the buffer first (snapshot to avoid mutation-during-iteration).
  for (const event of [...state.buffer]) cb(event);
  const listener = (event: RunEvent): void => cb(event);
  state.emitter.on("event", listener);
  return () => {
    state.emitter.off("event", listener);
  };
}

/** Best-effort message extraction from an unknown thrown value. */
function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/** Title-case a kebab/underscore slug: "drew-mailen" → "Drew Mailen". */
function titleCase(slug: string): string {
  return slug
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Display name for a plan judge: its `name` unless that's just the slug. */
function displayName(j: PlanJudge): string {
  return j.name && j.name !== j.judge_id ? j.name : titleCase(j.judge_id);
}
