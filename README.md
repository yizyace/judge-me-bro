# Judge Me Bro

> Local-first AI judging for hackathons. Distill real judges + "smart founders" into
> versioned persona files, manifest each as a Claude subagent, and run a two-phase
> pipeline — judges score ideas, then judges judge each other — into a versioned,
> append-only reputation leaderboard.

Full design: [`specs/root.md`](specs/root.md). Phase 1/2 contracts:
[`specs/evaluation.md`](specs/evaluation.md). Schemas + scoring math:
[`specs/persona-schema.md`](specs/persona-schema.md), [`specs/reputation.md`](specs/reputation.md).

## Architecture

Two cooperating layers — **no Agent SDK, no metered API tokens**:

- **Judging (markdown, on your Claude subscription).** Claude Code subagents in
  `.claude/agents/` (`idea-judge`, `meta-judge`, `distiller`) plus skills in
  `.claude/skills/` do the reasoning and emit raw JSON.
- **Harness (thin TypeScript, no LLM).** `harness/` validates that JSON against the
  schemas, computes every derived field (`weighted_total`, `meta_score`, `rep_score`),
  persists records, owns the SQLite ledger, and renders the leaderboard.

The slash commands in `.claude/commands/` (`/run`, `/distill`, `/report`) glue the two: the
parent agent fans out judging subagents via the Task tool and calls the harness for the
deterministic steps. Because the harness computes all derived fields, "the panel improved"
is a real, reproducible claim — not the model grading itself.

## Setup

Requires Node 20+ and Claude Code (logged in — the judging runs on your subscription).

```bash
npm install
npx vitest run     # harness unit + CLI tests
npx tsc --noEmit   # typecheck
```

## Run the pipeline (in Claude Code)

```
/run                                                                   # full panel × ideas
/run --ideas idea-001,idea-004 --judges paul-graham,dana-reyes,priya-anand   # scoped (cheaper)
/report                                                                # leaderboard for the latest run
```

`/run`:
1. enumerates active judges (highest version of each persona) × ideas;
2. **Phase 1** — fans out `idea-judge` subagents in capped waves → one validated
   `IdeaEvaluation` per (judge, idea) in `runs/<run_id>/evaluations/`;
3. **Phase 2** — fans out `meta-judge` subagents (blind, self-excluding) → one
   `MetaEvaluation` per (rater, target, idea) in `runs/<run_id>/meta/`;
4. **Phase 3** — aggregates `rep_score` per judge version into the SQLite ledger and writes
   `runs/<run_id>/report.md` + `runs/<run_id>/leaderboard.html`.

Open `runs/<run_id>/leaderboard.html` in a browser for the visual board (per-dimension bars,
version-delta badge).

**Cost / rate limits.** Full fan-out is N×M (Phase 1) + N×(N−1)×M (Phase 2) subagent runs —
6 judges × 4 ideas = 24 + 120 = 144. Scope down with `--ideas` / `--judges` for a quick demo.

## The harness CLI (called by the subagents; also usable directly)

```bash
npx tsx harness/cli.ts run:init     --evaluator eval@v1
npx tsx harness/cli.ts eval:persist --run <id> --evaluator eval@v1 \
  --judge-id <id> --judge-version <v> --kind <judge|founder> --idea <idea> --raw <file>
npx tsx harness/cli.ts meta:persist --run <id> --evaluator eval@v1 \
  --rater-id <id> --rater-version <v> --rater-kind <k> \
  --target-id <id> --target-version <v> --target-kind <k> --idea <idea> --raw <file>
npx tsx harness/cli.ts reputation   --run <id> --evaluator eval@v1
npx tsx harness/cli.ts report       --run <id> --evaluator eval@v1
npx tsx harness/cli.ts persona:put  --raw <persona.md>
```

Validation failures exit non-zero and write nothing (fail-closed) so a subagent's
≤3-attempt repair loop can retry.

## Repository layout

```
judge-me-bro/
├── specs/                root.md · evaluation.md · persona-schema.md · reputation.md
├── .claude/
│   ├── agents/           distiller.md · idea-judge.md · meta-judge.md
│   ├── skills/           distill-persona/ · score-idea/ · critique-evaluation/
│   └── commands/         run.md · distill.md · report.md
├── harness/              schemas.ts · store.ts · eval.ts · meta.ts · reputation.ts · report.ts · cli.ts (+ util, tests)
├── personas/             judges/<slug>@<v>.md · founders/<slug>@<v>.md
├── ideas/                <idea-id>.md
├── report/leaderboard.html   HTML leaderboard template
├── runs/<run_id>/        evaluations/ · meta/ · report.md · leaderboard.html   (gitignored)
└── data/jmb.sqlite       reputation ledger                                     (gitignored)
```

`data/` and `runs/` are gitignored — the ledger and run artifacts are local-only.

## Drop in the real panel + ideas

The repo ships sample personas (3 judges + 3 founders) and 4 sample ideas so the pipeline
runs out of the box. To use real data:

1. **Judges / founders** — in Claude Code: `/distill "<Person Name>" <source-url> <source-url>`
   for each, or hand-write `personas/<judges|founders>/<slug>@1.md` per
   `specs/persona-schema.md` and `npx tsx harness/cli.ts persona:put --raw <file>`.
2. **Ideas** — drop submissions into `ideas/<slug>.md` (frontmatter per `specs/root.md` §6.2);
   `npx tsx harness/cli.ts run:init` lists what it sees.
3. `/run`, then `/report`. No code changes.

## The iterate demo

Improve a weak judge → bump its version → re-run → its reputation rises under the **same**
evaluator:

1. `/report` to find the lowest-rep judge.
2. Improve its distillation and save as `<slug>@2.md` (retain `@1`) — re-`/distill <slug>`
   with sharper sources/weights, or edit by hand + `persona:put`.
3. `/run` (unchanged `eval@v1`).
4. `/report` — the judge's `rep_score` badge shows ▲ versus v1. The append-only ledger keeps
   the full version history.

## Conventions

Atomic commits + Conventional Commits — see [`CONSTITUTION.md`](CONSTITUTION.md).
