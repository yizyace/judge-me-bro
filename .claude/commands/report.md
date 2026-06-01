---
description: Render the reputation leaderboard for a run — text leaderboard + the HTML board with per-dimension bars and version-delta badges.
argument-hint: "[run_id] [--evaluator eval@v1]"
allowed-tools: Bash, Read
---

You render the **reputation leaderboard** for a Judge Me Bro run. The deterministic TS
harness reads the SQLite ledger (populated by `reputation`), populates the tracked
`report/leaderboard.html` template, and writes both `report.md` and `leaderboard.html` into
`runs/<run_id>/`. Your job is to pick the run, invoke the harness, and present the result.

Arguments (optional): `$ARGUMENTS` — an optional positional `run_id` and an optional
`--evaluator <ev>` (default `eval@v1`).

## 1. Determine the run_id
If the user gave a positional `run_id` in `$ARGUMENTS`, use it. Otherwise find the latest:
run `ls runs/` and pick the **lexicographically greatest** entry — run ids are sortable
UTC timestamps like `2026-06-01T18-00-00Z`, so the greatest string is the most recent run.
If `runs/` is empty (or missing), stop and tell the user to run `/run` first or to pass an
explicit `run_id`.

Resolve the evaluator: use the user's `--evaluator <ev>` if given, else default `eval@v1`.

## 2. Render the report
Run:
```
npx tsx harness/cli.ts report --run <run_id> --evaluator <ev>
```
This prints a text leaderboard and writes `runs/<run_id>/leaderboard.html` +
`runs/<run_id>/report.md`.

## 3. Present it
Read `runs/<run_id>/report.md` and present the leaderboard to the user. Then point them to
the HTML board at `runs/<run_id>/leaderboard.html` — **open it in a browser** to see the
per-dimension bars (reasoning / calibration / insight / bias-as-penalty) and the
version-delta badge (up/down vs the judge's previous version under the same evaluator).

## If the leaderboard is empty
`report` reads the SQLite ledger that the `reputation` step populates. An empty leaderboard
means the run hasn't been aggregated yet — run `/run` first, or aggregate this run directly
with:
```
npx tsx harness/cli.ts reputation --run <run_id> --evaluator <ev>
```
then re-run step 2.
