# Reputation Spec — Phase 3 Aggregation & Ledger

> Planning documentation for Phase 3 of *Judge Me Bro*: reducing the
> judge-to-judge critiques from Phase 2 into a single, versioned **reputation
> score** per judge, appended to an immutable ledger. Written so an **agent**
> can execute it directly. No code — an implementing agent chooses the runtime.

- **Status:** Draft (hackathon planning)
- **Parent spec:** [`root.md`](./root.md)
- **Depends on:** [`judging-schemas.md`](./judging-schemas.md) — consumes
  `judging-schemas#MetaEvaluation`
- **Last updated:** 2026-06-01
- **Covers:** Phase 3 — aggregate `MetaEvaluation`s into a `ReputationSnapshot`
  per judge version, bind it to an `evaluator_version`, and append it to the
  ledger so reputation stays comparable and trendable across versions.

---

## Spec label & schema index

**Spec label:** `reputation`

This doc is the **single source of truth** for the reputation record and its
math. Cite a contract from another spec by its label, `reputation#<SchemaName>`
(e.g. `reputation#ReputationSnapshot`). Reference by schema *name*, not §number.

| Label | Kind | Defined in | Purpose |
|-------|------|-----------|---------|
| `reputation#ReputationSnapshot` | object | [§2.2](#22-schema-a--reputationsnapshot-persisted-record) | one judge version's reputation for one run (a ledger row) |
| `reputation#RepComponents` | object | [§2.3](#23-schema-b--repcomponents-breakdown) | the score breakdown persisted for debugging (→ `components_json`) |

**Reused contracts** — defined in [`judging-schemas.md`](./judging-schemas.md),
cited here rather than redefined: `judging-schemas#MetaEvaluation`,
`judging-schemas#JudgeRef`, `judging-schemas#EvaluatorVersion`,
`judging-schemas#RunId`, `judging-schemas#IsoTimestamp`, `judging-schemas#Unit`.

**Referencing from other specs** — cite `reputation#ReputationSnapshot` for the
record shape, `reputation §2` for the whole aggregation step. The ledger DDL the
record maps onto is canonical in
[`root.md` §6.5](./root.md#65-reputation-ledger-sqlite-append-only).

---

## 0. How to read this doc

Phase 3 runs once, after Phase 2 completes. It is defined like the other steps:

1. **Inputs** — what the agent receives.
2. **Schema** — the shape of the persisted reputation record.
3. **Procedure** — the ordered steps the agent runs.
4. **Validation** — what must be true before a row is appended.

Scores stay on the **1–10** scale inherited from the meta-evaluations. All
reputation rows are **append-only** in the ledger (`root.md` §6.5).

---

## 1. Shared definitions

### 1.1 What reputation is (and isn't)

Reputation is a judge's **track record at judging** — the mean quality of their
Phase 1 evaluations as scored by *other* judges in Phase 2. It is **not** a
score of any idea, and **not** the judge's own confidence. For the MVP it is
**peer-relative** (`root.md` §14): a high `rep_score` means "the panel thinks
this judge judges well," not "agrees with ground truth."

### 1.2 Comparability rule (read before touching the math)

A `rep_score` is only comparable to another when both were computed:

- under the **same** `evaluator_version`, and
- from meta-evaluations that themselves share that `evaluator_version`.

Aggregating meta-evaluations across mixed evaluator versions is a hard error
(§2.6). Changing the math below = a **new** `evaluator_version`, never an
in-place edit — exactly as in `judging-schemas` §3.7. Otherwise the
version-over-version comparison that is the whole point (`root.md` §12) becomes
invalid.

---

## 2. Phase 3 — Reputation aggregation

**One snapshot per judge version, per run.** For each judge version that was a
**target** in Phase 2, gather every `MetaEvaluation` aimed at it and reduce them
to one score. This is a single reduction over the Phase 2 matrix, not a fan-out.

### 2.1 Inputs

| Input | Description |
|-------|-------------|
| meta-evaluations | every `judging-schemas#MetaEvaluation` record for the run |
| judge versions | the set of `(judge_id, version)` that were Phase 2 *targets* |
| `run_id` | current run |
| `evaluator_version` | the version bound to this scoring pass |
| ground-truth labels | optional; known idea outcomes, if any (unused in v1) |

### 2.2 Schema A — `ReputationSnapshot` (persisted record)

**Label:** `reputation#ReputationSnapshot`

One judge version's reputation for one run. Persisted as a row in the
append-only `reputation` table (DDL:
[`root.md` §6.5](./root.md#65-reputation-ledger-sqlite-append-only)); the
field → column mapping is in [§3](#3-ledger-binding).

| Field | Type | Source |
|-------|------|--------|
| `run_id` | `judging-schemas#RunId` | input |
| `created_at` | `judging-schemas#IsoTimestamp` | now |
| `evaluator_version` | `judging-schemas#EvaluatorVersion` | input |
| `judge` | `judging-schemas#JudgeRef` | the judge being scored (the Phase 2 *target*) |
| `rep_score` | number 1–10 | computed (§2.5) |
| `n_meta` | integer ≥ 1 | count of meta-evaluations aggregated |
| `components` | `reputation#RepComponents` | breakdown (§2.3) |
| `ground_truth_agreement` | `judging-schemas#Unit` \| null | optional; `null` in v1 |

```json
{
  "run_id": "2026-06-01T18-00Z",
  "created_at": "2026-06-01T18-42-00Z",
  "evaluator_version": "eval@v1",
  "judge": { "judge_id": "paul-graham", "judge_version": 3, "kind": "founder" },
  "rep_score": 7.1,
  "n_meta": 4,
  "components": {
    "mean_meta_score": 7.1,
    "mean_dimensions": { "reasoning_quality": 8.0, "calibration": 7.0, "insight": 8.0, "bias": 3.0 },
    "n_meta": 4,
    "ground_truth_term": null
  },
  "ground_truth_agreement": null
}
```

### 2.3 Schema B — `RepComponents` (breakdown)

**Label:** `reputation#RepComponents`

Stored so a reputation can be explained and debugged without re-running. Maps to
the `components_json` column.

| Field | Type | Meaning |
|-------|------|---------|
| `mean_meta_score` | number 1–10 | mean of `meta_score` over the aggregated critiques |
| `mean_dimensions` | map dim → number | per-dimension means (`reasoning_quality`, `calibration`, `insight`, `bias`) for transparency |
| `n_meta` | integer ≥ 1 | sample size (mirrors the row's `n_meta`) |
| `ground_truth_term` | number \| null | contribution of the optional truth term; `null` when no labels |

> `mean_dimensions` is **diagnostic only** — it is *not* re-weighted into
> `rep_score` (that would double-count the weights already baked into
> `meta_score`). It exists to answer "*why* is this judge's reputation low?"

### 2.4 Procedure

1. **Group** every `MetaEvaluation` in the run by its `target` `JudgeRef`.
2. **Guard:** all grouped records must share the run's `evaluator_version`
   (else hard error, §2.6). Self-critiques are excluded upstream
   (`judging-schemas` §3.8); assert `rater != target` on each, regardless.
3. **Skip empties:** a judge version that received **zero** critiques gets **no**
   snapshot (fail-closed — it simply has no reputation this run).
4. **Compute** `rep_score` and `RepComponents` (§2.5).
5. **Assemble** the `ReputationSnapshot` and validate it (§2.6).
6. **Append** one row to the `reputation` ledger (§3); regenerate `report.md`.

### 2.5 Reputation math (evaluator v1)

```
M         = { meta-evaluations whose target == this judge version, this run }
n_meta    = |M|                              # require n_meta ≥ 1
base      = mean_{m ∈ M} ( m.meta_score )    # meta_score per judging-schemas §3.7
rep_score = round2( clamp_[1,10]( base ) )   # + w_gt · ground_truth_agreement when labels exist; w_gt = 0 in v1
```

`meta_score` is already `0.4·reasoning_quality + 0.3·calibration + 0.3·insight −
0.2·bias`, clamped to [1, 10] **per critique** (`judging-schemas` §3.7). So
`rep_score` is just their **mean**: Phase 3 consumes the persisted derived field
and never recomputes from raw dimensions, which keeps the layers clean. Because
every `meta_score ∈ [1, 10]`, the mean is too — the `clamp` is a guard that only
bites once a ground-truth term is added.

> **Reconciliation with `root.md` §7.** root.md writes the v1 baseline as the
> mean of `(0.4·reasoning + 0.3·calibration + 0.3·insight) − 0.2·bias`. By
> linearity that equals the mean of `meta_score`, except root.md clamps once at
> the end while this spec relies on the per-critique clamp already applied in
> Phase 2. They differ only when a critique's raw score falls outside [1, 10] —
> which the Phase 2 schema forbids — so on valid data they are identical. This
> spec is canonical; `root.md` §7 is the summary.

### 2.6 Validation rules (Phase 3)

- `n_meta ≥ 1` (no snapshot for an un-critiqued judge).
- Every aggregated `MetaEvaluation` shares the snapshot's `evaluator_version`.
- `rater != target` held for every aggregated record (self-exclusion).
- `rep_score` and every `RepComponents` field recompute to the stored values.
- **Idempotency:** at most one row per `(judge_id, judge_version,
  evaluator_version, run_id)`. Re-running a completed run must not append a
  duplicate — compute once; the ledger never mutates prior rows (`root.md` §6.5).

---

## 3. Ledger binding

`ReputationSnapshot` maps onto the append-only `reputation` table whose DDL is
canonical in
[`root.md` §6.5](./root.md#65-reputation-ledger-sqlite-append-only):

| `ReputationSnapshot` field | `reputation` column |
|----------------------------|---------------------|
| `judge.judge_id` | `judge_id` |
| `judge.judge_version` | `judge_version` |
| `evaluator_version` | `evaluator_version` |
| `run_id` | `run_id` |
| `rep_score` | `rep_score` |
| `n_meta` | `n_meta` |
| `components` (JSON-encoded) | `components_json` |
| `created_at` | `created_at` |

`judge.kind` and `ground_truth_agreement` are not first-class columns in the v1
ledger: `kind` lives on the `judge_version` row this FK references; the
ground-truth term, when present, rides inside `components_json`. Promoting either
to its own column is a ledger migration, not a scoring change (so it does **not**
force a new `evaluator_version`).

---

## 4. Robustness rules

- **Fail closed:** a judge with zero valid critiques gets no row, not a zero. A
  run can finish with some judges un-scored; the ledger stays clean.
- **Determinism:** `rep_score` and `RepComponents` are always computed by the
  harness from the persisted `MetaEvaluation`s, never supplied by a model.
- **Append-only provenance:** every row carries `run_id`, `created_at`,
  `evaluator_version`, and the judge `JudgeRef`, so any reputation is
  reproducible and locatable in time.
- **No mixed evaluators:** aggregation refuses meta-evaluations whose
  `evaluator_version` differs from the run's.

---

## 5. Agent & skill mapping

(see `root.md` §8–9 for the full roster)

| Step | Subagent | Skill (how-to) | Reads | Writes |
|------|----------|----------------|-------|--------|
| Phase 3 | `reputation-keeper` | `update-reputation` | all `runs/<id>/meta/*` | `data/jmb.sqlite` (reputation rows), `runs/<id>/report.md` |

Phase 3 is one reduction, not a fan-out: a single `reputation-keeper` pass reads
the whole Phase 2 matrix and appends one row per critiqued judge version.

---

## 6. Worked end-to-end example

Continuing the `judging-schemas` §6 example:

1. **Phase 2** produced 4 critiques targeting `paul-graham@3` (from 4 other
   judges), with `meta_score`s `{7.1, 6.8, 7.6, 6.9}`.
2. **`reputation-keeper`** groups them by target, confirms all are `eval@v1` and
   none are self-critiques, then computes
   `rep_score = round2( mean(7.1, 6.8, 7.6, 6.9) ) = round2(7.10) = 7.1`,
   `n_meta = 4`, and the diagnostic `mean_dimensions`.
3. It appends one `reputation` row — `(paul-graham, 3, eval@v1,
   2026-06-01T18-00Z, 7.1, 4, {…}, …)` — and regenerates the leaderboard in
   `report.md`.
4. **Iteration (`root.md` §12 demo):** improve `paul-graham`'s distillation, bump
   to `@4`, re-run under the *same* `eval@v1`. A new append-only row lets us show
   `rep_score` moved — proof the panel measurably got better.

---

## 7. Open questions

- **Low-`n` noise / shrinkage:** with few critiques, `rep_score` is jumpy.
  Consider Bayesian shrinkage toward the panel mean (weighted by `n_meta`). That
  changes the math, so it would mint a new `evaluator_version`. Out of scope for
  v1.
- **Per-rater normalization:** `rep_score` lives on the absolute 1–10 meta scale
  but is read peer-relatively. If raters differ systematically in harshness,
  z-scoring per rater before the mean would be fairer — new `evaluator_version`
  if adopted.
- **Ground-truth term:** the hook (`ground_truth_agreement`, `w_gt`) is reserved
  but unused (`w_gt = 0`). When a labeled set of known outcomes exists, define
  the agreement metric and bump the evaluator (`root.md` §13).
- **Cross-run aggregation:** v1 scores per run. Whether a judge's *headline*
  reputation is the latest run or a decayed average across runs is a reporting
  decision for `report.md` / hosting — not the per-run row, which stays atomic.
