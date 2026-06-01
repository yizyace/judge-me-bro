import { runInit } from "@/lib/repo";
import { acquireRunLock, releaseRunLock, startRun } from "@/lib/run-registry";

// Spawns the harness CLI + a headless `claude -p` orchestrator via child_process
// and mutates the in-process run registry, so it must run on Node and must never
// be cached (every POST kicks off a fresh, stateful run).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Submit body: one idea + a panel of 3–5 judges, plus an optional evaluator. */
type RunRequest = {
  ideaId?: unknown;
  judgeIds?: unknown;
  evaluator?: unknown;
};

const MIN_JUDGES = 3;
const MAX_JUDGES = 5;

/** 400 helper — a plain `{ error }` body the client surfaces verbatim. */
function badRequest(message: string): Response {
  return Response.json({ error: message }, { status: 400 });
}

/**
 * POST /api/run — scope and start a judging run.
 *
 * Validates the panel (3–5 judges) + a single idea, takes the single-run lock,
 * scopes the run via `run:init` (which fails closed on unknown ids), then spawns
 * the orchestrator with {@link startRun}. Returns `{ run_id }`; the client then
 * subscribes to progress over SSE.
 */
export async function POST(req: Request): Promise<Response> {
  // ── Parse + validate the body ──────────────────────────────────────────
  let body: RunRequest;
  try {
    body = (await req.json()) as RunRequest;
  } catch {
    return badRequest("invalid JSON body");
  }

  const { ideaId, judgeIds, evaluator } = body;

  if (typeof ideaId !== "string" || ideaId.trim() === "") {
    return badRequest("pick exactly one idea");
  }

  if (
    !Array.isArray(judgeIds) ||
    judgeIds.length < MIN_JUDGES ||
    judgeIds.length > MAX_JUDGES ||
    !judgeIds.every((id): id is string => typeof id === "string" && id.trim() !== "")
  ) {
    return badRequest("pick 3–5 judges");
  }

  if (evaluator !== undefined && typeof evaluator !== "string") {
    return badRequest("evaluator must be a string");
  }
  const evaluatorVersion = evaluator ?? "eval@v1";

  // ── Single-run lock: only one judging run may be active at a time ──────
  if (!acquireRunLock()) {
    return Response.json({ error: "a run is already in progress" }, { status: 409 });
  }

  // ── Scope the run (run:init); fails closed on unknown idea/judge ids ───
  let runId: string;
  try {
    const plan = await runInit({
      evaluator: evaluatorVersion,
      judges: judgeIds,
      idea: ideaId,
    });
    runId = plan.run_id;
  } catch (err) {
    // The harness rejected the scope (e.g. unknown id). Drop the lock so the
    // next valid submission can proceed, and surface the harness message.
    releaseRunLock();
    return badRequest(errMsg(err));
  }

  // ── Spawn the orchestrator + start the watchers ────────────────────────
  try {
    startRun(runId, evaluatorVersion);
  } catch (err) {
    // Defense in depth: startRun re-checks the lock and reads run.json.
    releaseRunLock();
    return Response.json({ error: errMsg(err) }, { status: 500 });
  }

  return Response.json({ run_id: runId });
}

/** Best-effort message extraction from an unknown thrown value. */
function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
