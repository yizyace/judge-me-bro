import { spawn, type ChildProcess } from "node:child_process";

import { REPO_ROOT } from "./repo";

/**
 * Spawn a headless Claude Code orchestrator that drives a judging run.
 *
 * The judging *reasoning* is done by a real `claude -p` process running this
 * repo's installed skills/subagents (`idea-judge`, `meta-judge`); the
 * deterministic TS harness (invoked by those subagents via
 * `npx tsx harness/cli.ts …`) validates + persists every record. The web layer
 * never reasons about ideas — it only spawns this process and watches the
 * `runs/<id>/` directory the harness writes into (see run-registry.ts).
 *
 * Subscription auth is preserved by inheriting the ambient env (HOME, the
 * Claude config dir, etc.). We MUST NOT set ANTHROPIC_API_KEY — doing so would
 * switch the child off subscription billing.
 */

/**
 * Centralized `claude` flags so they're trivial to retune from one place.
 *
 * - `--output-format stream-json --include-partial-messages --verbose` — emit a
 *   parseable streaming JSON transcript on stdout (the registry tails it for
 *   the `PHASE2_COMPLETE` sentinel; the durable signal is still the files the
 *   harness writes).
 * - `--permission-mode acceptEdits` — auto-accept file edits so the orchestrator
 *   and its subagents can Write temp files + persist without prompting.
 * - `--allowedTools "Bash Read Write Task"` — the orchestrator needs Task (to
 *   dispatch subagents) and Bash (to run the harness CLI + `ls` barriers);
 *   subagents need Read/Write/Bash.
 * - `--add-dir <REPO_ROOT>` + `cwd: REPO_ROOT` — the harness CLI, personas,
 *   ideas, and runs/ all live at the repo root.
 * - `--model sonnet` — the judging panel runs on Sonnet.
 *
 * NOTE: if Task-spawned subagents stall on permission prompts under
 * `acceptEdits`, switch this to `--dangerously-skip-permissions`. The SEED bead
 * (.13) is validating the live recipe; keep this as the single source of truth
 * so reconciling its findings is a one-line change.
 */
export const CLAUDE_ARGS_BASE: string[] = [
  "--output-format",
  "stream-json",
  "--include-partial-messages",
  "--verbose",
  "--permission-mode",
  "acceptEdits",
  "--allowedTools",
  "Bash Read Write Task",
  "--add-dir",
  REPO_ROOT,
  "--model",
  "sonnet",
];

/**
 * Build the orchestrator prompt for a given run.
 *
 * It mirrors `.claude/commands/run.md` but is SCOPED to the plan already
 * written at `runs/<runId>/run.json` (no `run:init` — the backend did that) and
 * STOPS after Phase 2: the web backend owns Phase 3 (reputation + report). The
 * trailing `PHASE2_COMPLETE <n>` sentinel lets the registry react to stdout in
 * addition to the child `exit`.
 */
export function buildOrchestratorPrompt(runId: string): string {
  return [
    `You are the ORCHESTRATOR for Judge Me Bro run "${runId}". The judging`,
    `subagents (idea-judge, meta-judge) do the reasoning; the deterministic TS`,
    `harness validates, computes derived fields, and persists every record. Fan`,
    `work out in parallel, barrier between phases, and NEVER hand-write a record.`,
    ``,
    `## 0. Read the scoped plan`,
    `Read \`runs/${runId}/run.json\`. It is the SCOPED plan for THIS run:`,
    `\`{ run_id, evaluator_version, judges[], ideas[] }\` where each judge is`,
    `\`{judge_id, judge_version, kind, name, persona_path}\` and each idea is`,
    `\`{id, path, title}\`. Use run_id="${runId}" and the plan's evaluator_version`,
    `for every harness call below. Do NOT run \`run:init\` — the plan already`,
    `exists. Do NOT add or drop judges/ideas; use exactly what the plan lists.`,
    ``,
    `## 1. Phase 1 — idea evaluation (parallel)`,
    `For EVERY (judge, idea) pair in the plan, dispatch an \`idea-judge\` subagent`,
    `via the Task tool (subagent_type: "idea-judge"), in WAVES OF AT MOST 6`,
    `concurrent Task calls (put up to 6 Task uses in one message, wait for the`,
    `wave, then the next) to respect rate limits.`,
    ``,
    `Give each idea-judge Task a prompt containing exactly: the judge's`,
    `\`persona_path\`, the idea's \`idea_path\` (the plan's \`path\`),`,
    `\`run_id="${runId}"\`, the \`evaluator_version\`, and the judge's`,
    `\`judge_id\`/\`judge_version\`/\`kind\`. Instruct it to read both files, apply`,
    `the **score-idea** skill, and persist with the ≤3-attempt repair loop via:`,
    `\`\`\``,
    `npx tsx harness/cli.ts eval:persist --run ${runId} --evaluator <ev> \\`,
    `  --judge-id <id> --judge-version <v> --kind <kind> --idea <idea_id> --raw <tempfile>`,
    `\`\`\``,
    `It must report the written path, or a clean fail-closed failure (never invent`,
    `a record). The harness writes`,
    `\`runs/${runId}/evaluations/<judge_id>@<judge_version>--<idea_id>.json\`.`,
    ``,
    `**Barrier:** after all Phase-1 waves complete, run`,
    `\`ls runs/${runId}/evaluations/\` and note how many of the N×M evaluations`,
    `landed. Missing (fail-closed) ones are acceptable — log and continue.`,
    ``,
    `## 2. Phase 2 — meta-judging (parallel, blind)`,
    `For EVERY (rater, target, idea) where rater ≠ target (different judge_id OR`,
    `judge_version) AND the target's Phase-1 file`,
    `\`runs/${runId}/evaluations/<target_id>@<target_version>--<idea_id>.json\``,
    `EXISTS, dispatch a \`meta-judge\` subagent (subagent_type: "meta-judge"),`,
    `again in WAVES OF AT MOST 6.`,
    ``,
    `Give each meta-judge Task: the rater's \`persona_path\` + rater JudgeRef`,
    `(judge_id/judge_version/kind); the target JudgeRef; \`blind: true\` (refer to`,
    `the target only as "Another judge"); the idea's \`idea_path\`,`,
    `\`run_id="${runId}"\`, \`evaluator_version\`; and the CONTENTS of the target's`,
    `Phase-1 evaluation JSON (read that file and paste it in). Instruct it to apply`,
    `the **critique-evaluation** skill, honor self-exclusion and blinding, and`,
    `persist with the ≤3-attempt repair loop via:`,
    `\`\`\``,
    `npx tsx harness/cli.ts meta:persist --run ${runId} --evaluator <ev> \\`,
    `  --rater-id <ri> --rater-version <rv> --rater-kind <rk> \\`,
    `  --target-id <ti> --target-version <tv> --target-kind <tk> \\`,
    `  --idea <idea_id> --raw <tempfile>`,
    `\`\`\``,
    `The harness writes`,
    `\`runs/${runId}/meta/<rater_id>--on--<target_id>--<idea_id>.json\`.`,
    ``,
    `**Barrier:** run \`ls runs/${runId}/meta/\` and note the count.`,
    ``,
    `## 3. STOP`,
    `Do NOT run reputation, report, or any Phase-3 aggregation — the backend owns`,
    `Phase 3. After the Phase-2 barrier, print a final line exactly:`,
    `\`PHASE2_COMPLETE <n>\` where <n> is the number of meta files in`,
    `\`runs/${runId}/meta/\`. Then stop.`,
  ].join("\n");
}

/**
 * Spawn the headless orchestrator for `runId`.
 *
 * stdio: stdin ignored, stdout/stderr piped so the registry can tail the
 * stream-json transcript (and watch for the `PHASE2_COMPLETE` sentinel). cwd is
 * REPO_ROOT and the full ambient env is inherited (subscription auth).
 */
export function spawnHeadlessRun(runId: string): ChildProcess {
  return spawn("claude", ["-p", buildOrchestratorPrompt(runId), ...CLAUDE_ARGS_BASE], {
    cwd: REPO_ROOT,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
}
