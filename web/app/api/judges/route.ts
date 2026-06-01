import { listJudges } from "@/lib/catalog";

// Reads the filesystem (node:fs + gray-matter), so it must run on Node, and the
// catalog can change between deploys, so never cache it.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(listJudges());
}
