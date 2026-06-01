import * as fs from "node:fs/promises";
import * as path from "node:path";

import { REPO_ROOT } from "@/lib/repo";

// Reads runs/<id>/summary.json off the filesystem, so it must run on Node, and
// the file appears mid-run, so never cache.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET the run's panel summary (the `IdeaReviewSummary` written to
 * runs/<id>/summary.json at the Phase-1 → Phase-2 barrier). Returns 404 while
 * the file does not yet exist (Phase 1 still running, or unknown run).
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const summaryPath = path.join(REPO_ROOT, "runs", id, "summary.json");

  let raw: string;
  try {
    raw = await fs.readFile(summaryPath, "utf8");
  } catch {
    return Response.json({ error: "summary not ready" }, { status: 404 });
  }
  return Response.json(JSON.parse(raw));
}
