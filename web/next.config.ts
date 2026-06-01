import path from "node:path";
import type { NextConfig } from "next";

/**
 * judge-me-bro web app config.
 *
 * The app drives the existing TypeScript harness in the repo root as a child
 * process (see lib/repo.ts) rather than importing it, so no special bundling
 * of the harness or its native deps (better-sqlite3) is required here.
 *
 * `outputFileTracingRoot` pins file tracing to this web/ dir; without it Next
 * walks up, sees the root harness's package-lock.json, and warns about an
 * ambiguous workspace root.
 */
const nextConfig: NextConfig = {
  outputFileTracingRoot: path.resolve(import.meta.dirname),
};

export default nextConfig;
