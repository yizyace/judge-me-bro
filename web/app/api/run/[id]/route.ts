import * as fs from "node:fs/promises";
import * as path from "node:path";

import { REPO_ROOT } from "@/lib/repo";
import { getRun } from "@/lib/run-registry";

// Reads run.json + lists runs/<id>/{evaluations,meta} off the filesystem, so it
// must run on Node, and the snapshot changes as files land, so never cache.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Phase = "phase1" | "phase2" | "aggregating" | "done" | "error" | "unknown";

type StatusSnapshot = {
  run_id: string;
  phase: Phase;
  phase1: { done: number; total: number };
  phase2: { done: number; total: number };
};

/** run.json plan shape (mirrors run:init output); only the totals matter here. */
type Plan = {
  run_id: string;
  judges: unknown[];
  ideas: unknown[];
};

/** Count `*.json` files in a run subdir (evaluations/ or meta/); 0 if absent. */
async function countJsonFiles(dir: string): Promise<number> {
  let files: string[];
  try {
    files = await fs.readdir(dir);
  } catch {
    return 0;
  }
  return files.filter((f) => f.endsWith(".json")).length;
}

/** True iff a file exists and is readable. */
async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * GET a status snapshot for a run: `{ phase, phase1: {done,total},
 * phase2: {done,total} }`. Prefers the live in-process registry state when this
 * server still holds it; otherwise reconstructs purely from disk — reads
 * run.json for the totals (phase1 = judges×ideas, phase2 = judges×(judges−1)×
 * ideas) and counts the landed records in runs/<id>/{evaluations,meta}/ — so a
 * client reconnecting to a different/restarted process can still recover. Phase
 * is inferred from the report.json / summary.json artifacts plus those counts.
 * Returns 404 (phase "unknown") if the run was never initialized.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // Fast path: this process is actively running (or has run) this id.
  const live = getRun(id);
  if (live) {
    const snapshot: StatusSnapshot = {
      run_id: id,
      phase: live.phase,
      phase1: { done: live.counts.phase1_done, total: live.counts.phase1_total },
      phase2: { done: live.counts.phase2_done, total: live.counts.phase2_total },
    };
    return Response.json(snapshot);
  }

  // Recovery path: reconstruct from disk (no registry entry — e.g. a restarted
  // server, or a different worker than the one that ran startRun).
  const runDir = path.join(REPO_ROOT, "runs", id);
  const planPath = path.join(runDir, "run.json");

  let plan: Plan;
  try {
    plan = JSON.parse(await fs.readFile(planPath, "utf8")) as Plan;
  } catch {
    return Response.json({ error: "unknown run", run_id: id, phase: "unknown" }, { status: 404 });
  }

  const nJudges = Array.isArray(plan.judges) ? plan.judges.length : 0;
  const nIdeas = Array.isArray(plan.ideas) ? plan.ideas.length : 0;
  const phase1Total = nJudges * nIdeas;
  const phase2Total = nJudges * Math.max(nJudges - 1, 0) * nIdeas;

  const [phase1Done, phase2Done, hasReport, hasSummary] = await Promise.all([
    countJsonFiles(path.join(runDir, "evaluations")),
    countJsonFiles(path.join(runDir, "meta")),
    fileExists(path.join(runDir, "report.json")),
    fileExists(path.join(runDir, "summary.json")),
  ]);

  // Infer phase from durable artifacts + counts (best effort without the
  // registry): report.json ⇒ done; otherwise Phase 1 complete (or the summary
  // barrier crossed) ⇒ phase2; else still phase1.
  let phase: Phase;
  if (hasReport) {
    phase = "done";
  } else if (hasSummary || (phase1Total > 0 && phase1Done >= phase1Total)) {
    phase = "phase2";
  } else {
    phase = "phase1";
  }

  const snapshot: StatusSnapshot = {
    run_id: id,
    phase,
    phase1: { done: phase1Done, total: phase1Total },
    phase2: { done: phase2Done, total: phase2Total },
  };
  return Response.json(snapshot);
}
