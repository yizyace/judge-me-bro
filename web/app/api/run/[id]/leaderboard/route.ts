import * as fs from "node:fs/promises";
import * as path from "node:path";

import { REPO_ROOT } from "@/lib/repo";

// Reads runs/<id>/report.json off the filesystem, so it must run on Node, and
// the file appears mid-run, so never cache.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET the run's reputation leaderboard (the `ReputationReport` written to
 * runs/<id>/report.json once Phase-3 aggregation completes). Returns 404 while
 * the file does not yet exist (run still in progress, or unknown run).
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const reportPath = path.join(REPO_ROOT, "runs", id, "report.json");

  let raw: string;
  try {
    raw = await fs.readFile(reportPath, "utf8");
  } catch {
    return Response.json({ error: "report not ready" }, { status: 404 });
  }
  return Response.json(JSON.parse(raw));
}
