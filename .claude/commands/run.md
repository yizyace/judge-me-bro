---
description: Run the full judging pipeline — Phase 1 scoring, Phase 2 meta-judging, then reputation + leaderboard.
argument-hint: "[--evaluator eval@v1] [--ideas idea-001,idea-004] [--judges paul-graham,dana-reyes]"
allowed-tools: Bash, Read, Task
---

You are the **orchestrator** for a Judge Me Bro run. The markdown judging subagents
(`idea-judge`, `meta-judge`) do the reasoning on the subscription; the deterministic TS
harness validates output, computes derived fields, and persists. Your job: fan out work in
parallel, barrier between phases, then aggregate. Never hand-write a record — every
evaluation is persisted through the harness (fail-closed).

Arguments (optional): `$ARGUMENTS`

## 0. Initialize the run
Run `npx tsx harness/cli.ts run:init --evaluator <evaluator>` (default `eval@v1`; use the
user's `--evaluator` if given). Parse the printed JSON: `{ run_id, evaluator_version,
judges[], ideas[] }` where each judge has `{judge_id, judge_version, kind, name,
persona_path}` and each idea `{id, path, title}`.
- If the user passed `--ideas a,b` or `--judges x,y`, filter the lists to that subset.
- State the `run_id`, the judge/idea counts, and the resulting **Phase-1 count = N×M** and
  **Phase-2 count = N×(N−1)×M**. If the total is large, say so (see Scale).

## 1. Phase 1 — idea evaluation (parallel)
For **every (judge, idea) pair**, dispatch an `idea-judge` subagent via the Task tool
(`subagent_type: "idea-judge"`). Dispatch in **waves of at most 6 concurrent Task calls**
(put up to 6 Task uses in one message), wait for the wave, then the next — to stay within
subscription rate limits.

Give each `idea-judge` Task a prompt containing exactly: `persona_path`, `idea_path`,
`run_id`, `evaluator_version`, and the judge's `judge_id`/`judge_version`/`kind`; and the
instruction to read both files, apply the **score-idea** skill, and persist with the
≤3-attempt repair loop via:
```
npx tsx harness/cli.ts eval:persist --run <run_id> --evaluator <ev> \
  --judge-id <id> --judge-version <v> --kind <kind> --idea <idea_id> --raw <tempfile>
```
It must report the written path, or a clean fail-closed failure (do not invent a record).

**Barrier:** after all waves, run `ls runs/<run_id>/evaluations/` and note how many of the
N×M evaluations landed. Missing ones (fail-closed) are acceptable — log them and continue.

## 2. Phase 2 — meta-judging (parallel, blind)
For **every (rater, target, idea)** where `rater ≠ target` (different judge_id or version)
**and** a Phase-1 evaluation exists at
`runs/<run_id>/evaluations/<target_id>@<target_version>--<idea_id>.json`, dispatch a
`meta-judge` subagent (`subagent_type: "meta-judge"`), again in **waves of at most 6**.

Give each `meta-judge` Task: the rater's `persona_path` + rater JudgeRef; the target JudgeRef;
`blind: true` (refer to the target only as "Another judge"); the `idea_path`, `run_id`,
`evaluator_version`; and the **contents of the target's Phase-1 evaluation JSON** (read that
file and include it). Instruct it to apply the **critique-evaluation** skill and persist with
the ≤3-attempt repair loop via:
```
npx tsx harness/cli.ts meta:persist --run <run_id> --evaluator <ev> \
  --rater-id <ri> --rater-version <rv> --rater-kind <rk> \
  --target-id <ti> --target-version <tv> --target-kind <tk> \
  --idea <idea_id> --raw <tempfile>
```
honoring self-exclusion and blinding.

**Barrier:** run `ls runs/<run_id>/meta/` and note the count.

## 3. Phase 3 — aggregate + leaderboard
Run, in order:
```
npx tsx harness/cli.ts reputation --run <run_id> --evaluator <ev>
npx tsx harness/cli.ts report     --run <run_id> --evaluator <ev>
```
Then read `runs/<run_id>/report.md` and present the leaderboard to the user, and point them
to the HTML leaderboard at `runs/<run_id>/leaderboard.html` (open in a browser).

## Scale note (subscription rate limits)
Full fan-out for the default panel (6 judges × 4 ideas) is **24 Phase-1 + 120 Phase-2 = 144**
subagent runs. For a quick demo, scope it down, e.g.
`/run --ideas idea-001,idea-004 --judges paul-graham,dana-reyes,priya-anand`
(3×2 = 6 Phase-1 + 3×2×2 = 12 Phase-2). Keep waves ≤6 concurrent; let fail-closed pairs be
skipped and logged. The reputation comparison only needs a consistent set of critiques, not
every possible pair.
