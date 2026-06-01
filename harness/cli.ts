#!/usr/bin/env tsx
/**
 * judge-me-bro harness CLI — deterministic plumbing only (NO LLM calls).
 *
 * The markdown judging subagents (Claude Code, subscription) call these
 * subcommands over Bash to validate model output, compute derived fields,
 * persist records, aggregate reputation, and render reports.
 *
 * Subcommands are wired incrementally by later beads:
 *   eval:validate  eval:persist  meta:validate  meta:persist
 *   reputation     report        run:init
 */

const [cmd] = process.argv.slice(2);

if (!cmd || cmd === "--help" || cmd === "-h") {
  console.log("judge-me-bro harness — usage: tsx harness/cli.ts <subcommand> [args]");
  console.log("subcommands: eval:validate eval:persist meta:validate meta:persist reputation report run:init");
  process.exit(cmd ? 0 : 1);
}

console.error(`harness: unknown or not-yet-implemented subcommand: ${cmd}`);
process.exit(2);
