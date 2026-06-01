"use client";

import { Leaderboard } from "@/components/leaderboard/Leaderboard";
import { Phase1Board } from "@/components/Phase1Board";
import { PanelSummary } from "@/components/PanelSummary";
import { Phase2Matrix } from "@/components/Phase2Matrix";
import { useRunStream, type RunPhase, type RunStreamState } from "@/components/useRunStream";

/** Human-readable label for each phase, shown in the run header. */
const PHASE_LABEL: Record<RunPhase, string> = {
  idle: "Idle",
  loading: "Loading…",
  phase1: "Phase 1 — judges scoring",
  phase2: "Phase 2 — judges reviewing each other",
  aggregating: "Aggregating reputation…",
  done: "Complete",
  error: "Error",
};

/**
 * The full run experience for a single run.
 *
 * Drives off {@link useRunStream}, which transparently handles two cases:
 *   • A completed/seeded run (its leaderboard already exists): the hook lands
 *     directly in `phase:"done"` with the persisted `report` + `summary`, so
 *     this renders the Panel summary and the Leaderboard immediately. The
 *     `phase1`/`phase2` maps stay empty — by design; the persisted artefacts
 *     carry the story.
 *   • A live run: the hook streams `eval_done` → `summary_ready` → `meta_done`
 *     → `leaderboard_ready`, and the sections below appear/fill as their data
 *     arrives.
 *
 * Everything stacks and stays visible as it populates.
 */
export function RunView({ runId }: { runId: string }) {
  const state = useRunStream(runId);

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-10 px-[clamp(16px,5vw,48px)] py-12">
      <RunHeader state={state} runId={runId} />

      {state.phase === "error" && (
        <p
          role="alert"
          className="rounded-xl border border-bad/40 bg-bad/10 px-4 py-3 text-sm font-medium text-bad"
        >
          {state.error ?? "Something went wrong with this run."}
        </p>
      )}

      {/* Phase 1 — judges' reviews. Hidden only before any panel is known
          (i.e. while loading a live run that hasn't sent `run_started` yet). */}
      {state.judges.length > 0 && (
        <Phase1Board judges={state.judges} phase1={state.phase1} />
      )}

      {/* The one consolidated panel summary. */}
      {state.summary && <PanelSummary summary={state.summary} />}

      {/* Phase 2 — judge-to-judge matrix. */}
      {state.judges.length > 0 && (
        <Phase2Matrix judges={state.judges} phase2={state.phase2} />
      )}

      {/* The reputation leaderboard, once aggregation has produced a report. */}
      {state.report && (
        <section aria-label="Reputation leaderboard" className="-mx-[clamp(16px,5vw,48px)]">
          <Leaderboard report={state.report} />
        </section>
      )}
    </main>
  );
}

/** Idea title + a phase label and (when streaming) a progress readout. */
function RunHeader({ state, runId }: { state: RunStreamState; runId: string }) {
  const title = state.idea?.title ?? state.summary?.idea_id ?? runId;
  const progress = phaseProgress(state);

  return (
    <header className="flex flex-col gap-2">
      <div className="text-[12px] font-semibold uppercase tracking-[0.08em] text-muted">
        Judging run
      </div>
      <h1 className="text-balance text-[clamp(26px,4vw,40px)] font-bold tracking-[-0.02em]">
        {title}
      </h1>
      {state.idea?.one_liner && (
        <p className="text-[15px] text-muted">{state.idea.one_liner}</p>
      )}

      <div className="mt-1 flex flex-wrap items-center gap-2">
        <span
          className="inline-flex items-center gap-2 rounded-full border border-line bg-panel px-3 py-1 text-[13px] font-semibold"
          aria-live="polite"
        >
          {state.phase !== "done" && state.phase !== "error" && (
            <span className="h-2 w-2 animate-pulse rounded-full bg-accent" aria-hidden />
          )}
          {PHASE_LABEL[state.phase]}
          {progress && <span className="text-muted">· {progress}</span>}
        </span>
      </div>
    </header>
  );
}

/** A "k / N" progress string for the active phase, or null when not relevant. */
function phaseProgress(state: RunStreamState): string | null {
  const n = state.judges.length;
  if (state.phase === "phase1") {
    return `${state.phase1.size} / ${state.phase1Total || n}`;
  }
  if (state.phase === "phase2") {
    const total = state.phase2Total || n * (n - 1);
    return `${state.phase2.size} / ${total}`;
  }
  return null;
}
