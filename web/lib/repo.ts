import { execFile } from "node:child_process";
import * as path from "node:path";
import { promisify } from "node:util";

/**
 * Repo root + thin wrappers over the judging harness CLI.
 *
 * Next runs with `cwd = web/`, so the repo root (which holds harness/, runs/,
 * personas/, ideas/, data/) is the parent directory. `JMB_REPO_ROOT` overrides
 * it for tests / non-standard layouts. Every harness invocation runs as
 *
 *     npx tsx harness/cli.ts <subcommand> [flags]
 *
 * from REPO_ROOT, inheriting the ambient env. These functions wrap the CLI
 * subcommands added by the harness-CLI bead and parse their stdout.
 */
export const REPO_ROOT: string = process.env.JMB_REPO_ROOT ?? path.resolve(process.cwd(), "..");

const execFileAsync = promisify(execFile);

/** Run `npx tsx harness/cli.ts <args…>` from REPO_ROOT, returning stdout/stderr. */
async function runHarness(args: string[]): Promise<{ stdout: string; stderr: string }> {
  const { stdout, stderr } = await execFileAsync("npx", ["tsx", "harness/cli.ts", ...args], {
    cwd: REPO_ROOT,
    env: process.env,
    maxBuffer: 32 * 1024 * 1024,
  });
  return { stdout, stderr };
}

/** Extract the last top-level JSON object/array printed to stdout. */
function parseJsonStdout<T>(stdout: string): T {
  const trimmed = stdout.trim();
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    // The CLI may print log lines before the JSON payload; grab the last
    // balanced object/array as a fallback.
    const start = Math.max(trimmed.lastIndexOf("{"), trimmed.lastIndexOf("["));
    if (start >= 0) {
      const candidate = trimmed.slice(start);
      return JSON.parse(candidate) as T;
    }
    throw new Error(`harness produced no parseable JSON on stdout:\n${stdout}`);
  }
}

/** One judge entry in a run plan (mirrors run:init output). */
export type RunPlanJudge = {
  judge_id: string;
  judge_version: number;
  kind: "judge" | "founder";
  name: string;
  persona_path: string;
};

/** One idea entry in a run plan (mirrors run:init output). */
export type RunPlanIdea = { id: string; path: string; title: string };

/** The plan emitted by `run:init` (also written to runs/<id>/run.json). */
export type RunPlan = {
  run_id: string;
  evaluator_version: string;
  judges: RunPlanJudge[];
  ideas: RunPlanIdea[];
};

/**
 * Initialize a run: registers judge versions + evaluator and writes
 * runs/<run_id>/run.json. Returns the parsed plan (incl. the generated
 * `run_id`). `judges` is the list of judge ids; `idea` is a single idea id.
 */
export async function runInit(args: {
  evaluator: string;
  judges: string[];
  idea: string;
}): Promise<RunPlan> {
  const { stdout } = await runHarness([
    "run:init",
    "--evaluator",
    args.evaluator,
    "--judges",
    args.judges.join(","),
    "--idea",
    args.idea,
  ]);
  return parseJsonStdout<RunPlan>(stdout);
}

/**
 * Aggregate reputation for a run (the `reputation` subcommand). Returns the raw
 * stdout text (one `judge@version rep_score=… n_meta=…` line per judge, plus a
 * summary line); use renderReportJson for structured data.
 */
export async function aggregate(runId: string, evaluator: string): Promise<string> {
  const { stdout } = await runHarness(["reputation", "--run", runId, "--evaluator", evaluator]);
  return stdout;
}

/**
 * Render the human report (the `report` subcommand): writes report.html +
 * report.md under runs/<id>/ and returns the markdown printed to stdout.
 */
export async function renderReport(runId: string, evaluator: string): Promise<string> {
  const { stdout } = await runHarness(["report", "--run", runId, "--evaluator", evaluator]);
  return stdout;
}

/**
 * Render the machine report (the `report:json` subcommand with `--stdout`):
 * writes report.json under runs/<id>/ and returns the parsed report object.
 */
export async function renderReportJson(runId: string, evaluator: string): Promise<unknown> {
  const { stdout } = await runHarness([
    "report:json",
    "--run",
    runId,
    "--evaluator",
    evaluator,
    "--stdout",
  ]);
  return parseJsonStdout<unknown>(stdout);
}

/**
 * Render the panel summary (the `summary:json` subcommand with `--stdout`):
 * aggregates the run's Phase-1 evaluations into one consolidated review, writes
 * summary.json under runs/<id>/, and returns the parsed summary object.
 */
export async function renderSummaryJson(runId: string, evaluator: string): Promise<unknown> {
  const { stdout } = await runHarness([
    "summary:json",
    "--run",
    runId,
    "--evaluator",
    evaluator,
    "--stdout",
  ]);
  return parseJsonStdout<unknown>(stdout);
}
