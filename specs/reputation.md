# Reputation — Scoring Math & Evaluator Binding

> Sub-spec of [`root.md`](./root.md) (§6.5 ledger, §7 pipeline). Defines how
> Phase-2 meta-evaluations roll up into a **versioned reputation score** per
> judge, the **evaluator** that binds the rubric + formulas, and the iterate/demo
> mechanic. The math here MUST match `harness/schemas.ts` and
> [`evaluation.md`](./evaluation.md) §3.7.

- **Status:** Draft (hackathon planning)
- **Parent spec:** [`root.md`](./root.md) · sibling: [`evaluation.md`](./evaluation.md)
- **Authoritative contracts:** `harness/schemas.ts` →
  `MetaEvaluation`, `ReputationRow`, `ReputationComponents`,
  `ReputationSnapshot`, `ReputationReport`, `DEFAULT_EVALUATOR_VERSION`.
- **Last updated:** 2026-06-01

---

## 1. The chain: dimensions → meta_score → rep_score

Reputation is built in two aggregations:

1. **Per critique** — each Phase-2 `MetaEvaluation` carries a single
   **`meta_score`** computed from its four meta-dimensions (§2).
2. **Per judge version** — **`rep_score`** is the **mean** of every `meta_score`
   targeting that judge version in a run, plus the **component means** stored
   beside it (§3).

Both derived numbers are computed **by the harness, never by a model**
(evaluation.md §4). Everything is **versioned and append-only** (§6).

---

## 2. Per-critique `meta_score` (evaluator v1)

For one `MetaEvaluation`, the rater scores the **target judge's judgment** on
four orthogonal dimensions, each an integer 1–10 (evaluation.md §3.2):

| Dimension | Meaning | Direction |
|-----------|---------|-----------|
| `reasoning_quality` | Is the rationale sound and grounded in the idea? | higher = better |
| `calibration` | Do the numeric scores match the strength of the reasoning? | higher = better |
| `insight` | Did they surface something non-obvious? | higher = better |
| `bias` | Halo / vibe / pet-peeve distortion | **PENALTY**: 1 = unbiased … 10 = blatantly biased |

The single-critique score (evaluation.md §3.7):

```
meta_score = clamp_[1,10]( 0.4 · reasoning_quality
                         + 0.3 · calibration
                         + 0.3 · insight
                         − 0.2 · bias )
```

- Round to **2 decimals**.
- `bias` is **subtracted** (penalty axis), so a less-biased critique target
  scores higher.
- The result is **clamped to `[1, 10]`** and stored on the `MetaEvaluation`
  record (`meta_score`, number 1–10 in `schemas.ts`); on read-back it must
  recompute to the stored value (evaluation.md §3.8).
- This is the score of **one critique**, not a reputation. Reputation is the
  mean of many (§3).

**Self-exclusion:** a critique only counts if `rater ≠ target` (same `judge_id`
**and** `judge_version`). `MetaEvaluation.refine` rejects any record where the
rater equals the target version, enforced before the model call and again on the
assembled record (evaluation.md §3.1, §3.8). The helper `sameJudgeVersion(a, b)`
in `schemas.ts` is the source of truth for "same distillation".

---

## 3. Aggregate `rep_score(judge_version)`

For a given judge version in a run, collect **all** `MetaEvaluation` records in
that run whose `target` is that exact `(judge_id, judge_version)` — and (per
self-exclusion) never authored by that same version. Then:

```
rep_score(judge_version) = mean over those critiques of meta_score
n_meta                   = number of those critiques
```

- `rep_score` is a plain **arithmetic mean** of the per-critique `meta_score`s.
  It inherits the `[1, 10]` range (each `meta_score` is already clamped to
  `[1,10]`, so their mean is too) and matches `ReputationRow.rep_score`
  (number, 1–10) and `ReputationSnapshot.rep_score`.
- `n_meta` is the count of critiques feeding the mean
  (`ReputationRow.n_meta`, non-negative integer).

### 3.1 Component means (stored alongside)

Beside `rep_score`, persist the **mean of each meta-dimension** across the same
set of critiques:

```
components = {
  reasoning_quality: mean(reasoning_quality over those critiques),
  calibration:       mean(calibration       over those critiques),
  insight:           mean(insight           over those critiques),
  bias:              mean(bias              over those critiques),   // raw; lower is better
}
```

- This matches `ReputationComponents` in `schemas.ts` (four numbers) and is
  serialized into the **`reputation.components_json`** ledger column
  (root.md §6.5) — the "breakdown for debugging."
- The **leaderboard consumes** these means: `ReputationSnapshot.components`
  carries them into `report/leaderboard.html`.
- `bias` is stored as the **raw mean** (penalty axis: lower = less biased). Do
  **not** invert it in storage; the report explains the direction.
- **Consistency check:** because `meta_score` is linear in the dimensions, when
  no clamp bound binds, `rep_score` equals the v1 formula applied to the
  component means:
  `0.4·mean(reasoning) + 0.3·mean(calibration) + 0.3·mean(insight) − 0.2·mean(bias)`.
  (Per-critique clamping can introduce a small divergence; the stored `rep_score`
  is the mean of the clamped `meta_score`s, which is authoritative.)

### 3.2 Aggregated view (report data)

The reputation report bundles per-version snapshots for a run
(`ReputationReport` → `{ run_id, evaluator_version, snapshots[] }`). Each
`ReputationSnapshot` carries:

| Field | Type | Source |
|-------|------|--------|
| `name` | string (≥1) | persona display `name`, else **title-cased `id`** (per persona-schema §2) |
| `judge` | `JudgeRef` | the scored `(judge_id, judge_version, kind)` |
| `rep_score` | number | §3 mean |
| `prev_rep_score` | number, **optional** | previous version's rep_score, **same evaluator** (§5) |
| `n_meta` | int ≥ 0 | §3 count |
| `components` | `ReputationComponents` | §3.1 means |

---

## 4. The evaluator `eval@v1`

The **evaluator** is the version-bound binding of **(rubric + the scoring
formulas above)** — i.e. the five rubric criteria, the four meta-dimensions, the
`meta_score` formula (§2), and the `rep_score` aggregation (§3). It is recorded
in the `evaluator` ledger table (root.md §6.5):

| Column | Meaning |
|--------|---------|
| `evaluator_version` | `^eval@v\d+$`, the default baseline is **`eval@v1`** (`DEFAULT_EVALUATOR_VERSION` in `schemas.ts`) |
| `rubric_json` | the rubric + weights/formulas that define this evaluator |
| `notes` | human description of what this evaluator computes |
| `created_at` | ISO timestamp |

Every `IdeaEvaluation`, `MetaEvaluation`, and `ReputationRow` is **tagged with
`evaluator_version`** so all comparisons are apples-to-apples.

### 4.1 Versioning rule (never edit in place)

> **Any** change to the math — the `meta_score` weights, the clamp, the
> aggregation, the dimensions, or the rubric — **forks a new `eval@vN`**
> (e.g. `eval@v2`). The evaluator is **never edited in place**.

This is the same rule stated in evaluation.md §3.7 and root.md §13/§7: editing an
evaluator in place would silently change historical scores and make
version-over-version reputation comparisons invalid. New math ⇒ new evaluator row
⇒ comparisons are only ever made **within a single `evaluator_version`**.

### 4.2 Optional ground-truth term (future `eval@v2`)

`meta_score`/`rep_score` are **peer-relative** under `eval@v1` (root.md §13,
evaluation.md §7). When a labeled set of **known winning ideas** exists, a future
**`eval@v2`** may add a **ground-truth agreement term** — rewarding judges whose
verdicts/scores agree with real outcomes — and re-weight accordingly. Per §4.1
this is a **new evaluator version**, not an edit to `eval@v1`; runs under each
version are compared only within that version.

---

## 5. Iterate / demo mechanic

The headline demo (root.md §11 M4, §12) is showing a judge's reputation **rise
across versions under an unchanged evaluator**:

1. Inspect a low-`rep_score` judge.
2. Improve its distillation (better sources, sharper `rubric_weights`, more
   worked examples) and **bump `version`** (a new persona file; old retained —
   see persona-schema §1).
3. **Re-run** the pipeline against the **same `evaluator_version`**.
4. Confirm `rep_score` went **up**.

To surface this, define:

```
prev_rep_score(judge@vN) = rep_score of the judge's previous version (judge@v(N-1))
                           under the SAME evaluator_version
```

- It is the **same-evaluator** predecessor score — comparing across evaluator
  versions is invalid (§4.1), so `prev_rep_score` is only ever drawn from rows
  with a matching `evaluator_version`.
- It is **optional** (`ReputationSnapshot.prev_rep_score?`): a judge's **first**
  version under a given evaluator has no predecessor, so the field is omitted.
- The leaderboard **`report/leaderboard.html`** renders a **delta badge**
  (`rep_score − prev_rep_score`) so reviewers see the improvement at a glance.

Because the ledger is append-only (§6), the full version history is recoverable,
and the predecessor lookup is just "the most recent prior `(judge_id, version)`
reputation row under this `evaluator_version`."

---

## 6. Ledger binding & append-only invariant

Reputation persists into the SQLite **reputation ledger** (root.md §6.5; mirrored
by `ReputationRow` in `schemas.ts`):

| Column | Maps to |
|--------|---------|
| `judge_id`, `judge_version` | the scored judge version (FK → `judge_version`) |
| `evaluator_version` | the binding evaluator (FK → `evaluator`); the comparison key |
| `run_id` | the pipeline pass |
| `rep_score` | §3 mean of `meta_score` |
| `n_meta` | §3 count of critiques |
| `components_json` | §3.1 `ReputationComponents`, serialized |
| `created_at` | ISO timestamp |

**The ledger is append-only.** A new run **never mutates** old rows — it inserts
one new `reputation` row per `(judge_version, run)`. This is what makes a judge's
reputation plottable over versions and lets the demo *prove* the panel improved
(root.md §6.5, §14). No update or delete on historical rows, ever.

---

## 7. Worked examples

### 7.1 Single `meta_score` (evaluation.md §6)

`jessica-livingston@2` critiques `paul-graham@3`'s evaluation of `idea-014`,
returning dimensions `{ reasoning_quality: 8, calibration: 6, insight: 9,
bias: 3 }`:

```
meta_score = clamp_[1,10]( 0.4·8 + 0.3·6 + 0.3·9 − 0.2·3 )
           = clamp_[1,10]( 3.2 + 1.8 + 2.7 − 0.6 )
           = clamp_[1,10]( 7.1 )
           = 7.1
```

### 7.2 Aggregate `rep_score` (mean of a few critiques)

Suppose three critiques (from three different rater versions, none being
`paul-graham@3`) `target` `paul-graham@3` in one run:

| Critique | reasoning | calibration | insight | bias | `meta_score` |
|----------|-----------|-------------|---------|------|--------------|
| A | 8 | 6 | 9 | 3 | `3.2+1.8+2.7−0.6` = **7.1** |
| B | 7 | 7 | 6 | 4 | `2.8+2.1+1.8−0.8` = **5.9** |
| C | 9 | 8 | 8 | 2 | `3.6+2.4+2.4−0.4` = **8.0** |

```
rep_score(paul-graham@3) = mean(7.1, 5.9, 8.0) = 21.0 / 3 = 7.00
n_meta = 3
components = {
  reasoning_quality: mean(8,7,9) = 8.00,
  calibration:       mean(6,7,8) = 7.00,
  insight:           mean(9,6,8) = 7.67,
  bias:              mean(3,4,2) = 3.00,
}
```

Cross-check (§3.1): `0.4·8.00 + 0.3·7.00 + 0.3·7.67 − 0.2·3.00 = 3.2 + 2.1 +
2.30 − 0.6 = 7.00` — matches the mean of the per-critique scores (no clamp bound
here).

If `paul-graham@2` had `rep_score = 6.40` under the **same** `eval@v1`, the
leaderboard shows `prev_rep_score = 6.40` and a delta badge of **+0.60** —
the M4 demo: the distillation measurably improved.

---

## 8. Cross-references & consistency

- **`meta_score` math & dimensions:** evaluation.md §3.7, §3.2; `MetaEvaluation`
  in `schemas.ts`.
- **Self-exclusion:** evaluation.md §3.1/§3.8; `sameJudgeVersion` +
  `MetaEvaluation.refine` in `schemas.ts`.
- **Ledger:** root.md §6.5; `ReputationRow` / `EvaluatorRow` / `JudgeVersionRow`.
- **Report data:** `ReputationComponents`, `ReputationSnapshot`,
  `ReputationReport` in `schemas.ts`; consumed by `report/leaderboard.html`.
- **Persona `name` fallback:** [`persona-schema.md`](./persona-schema.md) §2.

> If this doc and `schemas.ts`/`evaluation.md` ever disagree, treat
> `schemas.ts` + `evaluation.md` as authoritative and fix this doc.
