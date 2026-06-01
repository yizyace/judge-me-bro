# Evaluation Spec — Idea Judging & Judge-to-Judge Judging

> Planning documentation for the two evaluation steps in *Judge Me Bro*.
> Written so an **agent** can execute each step directly: it defines the data
> contracts (schemas), the exact procedure, the prompts to issue, and the
> validation rules. No code — an implementing agent chooses the runtime.

- **Status:** Draft (hackathon planning)
- **Parent spec:** [`root.md`](./root.md)
- **Last updated:** 2026-06-01
- **Covers:** Phase 1 (idea judging) and Phase 2 (judge-to-judge judging),
  including their schemas, steps, and the evaluator math that binds them.

---

## 0. How to read this doc

There are two evaluation steps. Each is defined the same way:

1. **Inputs** — what the agent receives.
2. **Schema** — the exact shape of the JSON the judge must return, and the
   shape of the persisted record.
3. **Procedure** — the ordered steps the agent runs.
4. **Validation** — what must be true before a record is written.

Schemas are given as field tables plus a JSON example. Scores are **integers
1–10** unless stated otherwise. All records are persisted as JSON under
`runs/<run_id>/`.

---

## 1. Shared definitions

These are referenced by both phases. Define them once; change them in one place.

### 1.1 Rubric criteria

The five criteria every idea is scored on:

| Criterion | Question it answers |
|-----------|---------------------|
| `problem` | Is this a real, frequent, painful problem? |
| `solution` | Does the approach actually solve it, and is it differentiated? |
| `market` | Is the addressable market large and reachable? |
| `team` | Can *this* team execute it? |
| `traction` | Is there evidence (users, demo, data) that it's working? |

This list is the single source of truth. Persona rubric weights, idea scores,
and reports all key off exactly these five.

### 1.2 Common field types

| Type | Rule |
|------|------|
| `Slug` | kebab-case, `^[a-z0-9]+(?:-[a-z0-9]+)*$`, ≤64 chars (e.g. `paul-graham`, `idea-014`) |
| `Version` | positive integer; the persona distillation version |
| `Score10` | integer, 1–10 inclusive |
| `Unit` | number in [0, 1] (e.g. confidence) |
| `EvaluatorVersion` | `^eval@v\d+$` (e.g. `eval@v1`); bumped whenever scoring math changes |
| `IsoTimestamp` | ISO-8601 with offset (e.g. `2026-06-01T12:00:00Z`) |
| `RunId` | non-empty string shared by all artifacts in one pipeline pass |
| `RubricWeights` | map of the 5 criteria → number in [0,1]; **must sum to 1.0 (±0.01)** |

### 1.3 JudgeRef

A pointer to a specific distilled judge snapshot. Used to tag every record.

```json
{ "judge_id": "paul-graham", "judge_version": 3, "kind": "founder" }
```

`kind` is `"judge"` (a real hackathon judge) or `"founder"` (a smart-founder
reference persona).

### 1.4 Manifesting a judge (prerequisite for both phases)

Before either step runs, the persona must be **manifested** — turned into the
system prompt the judge model uses. The system prompt is assembled from the
persona frontmatter:

- identity (`id`), `voice`
- `values` (what they reward) and `red_flags` (what they punish)
- `rubric_weights` (their priorities — they must NOT pre-average the criteria)
- `calibration_notes`, `domains`
- the persona markdown body (background + worked examples) as reference

Rule baked into the system prompt: *"Score against YOUR priorities, not a
neutral average. Return exactly one JSON object matching the requested schema and
nothing else."*

---

## 2. Phase 1 — Idea judging

**One judge evaluates one idea.** Independent per `(judge, idea)` pair, so the
orchestrator fans these out in parallel.

### 2.1 Inputs

| Input | Description |
|-------|-------------|
| manifested judge | system prompt + the persona's `rubric_weights` and `JudgeRef` |
| idea | `id`, `title`, `one_liner`, `team`, `links`, `body` (full pitch) |
| `run_id` | current run |
| `evaluator_version` | e.g. `eval@v1` |

### 2.2 Schema A — `IdeaEvaluationOutput` (what the judge returns)

This is the **validation gate**: the judge's raw JSON must satisfy this exactly.

| Field | Type | Rule |
|-------|------|------|
| `assessments` | object | one entry per rubric criterion (all 5 required) |
| `assessments.<criterion>.score` | `Score10` | integer 1–10 |
| `assessments.<criterion>.reason` | string | 1 line, ≤500 chars |
| `verdict` | enum | `advance` \| `borderline` \| `pass` |
| `confidence` | `Unit` | 0–1 |
| `rationale` | string | 2–4 sentences, in the judge's voice, ≤2000 chars |
| `key_question` | string | the single sharpest question for the founders |
| `strengths` | string[] | 0–5 items |
| `risks` | string[] | 0–5 items |

```json
{
  "assessments": {
    "problem":  { "score": 8, "reason": "real, frequent pain for eng teams" },
    "solution": { "score": 6, "reason": "plausible but unproven triage" },
    "market":   { "score": 7, "reason": "every engineering team" },
    "team":     { "score": 5, "reason": "thin on distribution" },
    "traction": { "score": 3, "reason": "no users yet" }
  },
  "verdict": "borderline",
  "confidence": 0.6,
  "rationale": "Strong wedge, weak proof. Could be a feature, not a company.",
  "key_question": "What makes this 10x better, not 10% better?",
  "strengths": ["clear, frequent pain"],
  "risks": ["incumbent CI vendors can ship this"]
}
```

### 2.3 Schema B — `IdeaEvaluation` (persisted record)

The output plus provenance and a derived weighted total. Written to
`runs/<run_id>/evaluations/<judge_id>@<version>--<idea_id>.json`.

| Field | Type | Source |
|-------|------|--------|
| `run_id` | `RunId` | input |
| `created_at` | `IsoTimestamp` | now |
| `evaluator_version` | `EvaluatorVersion` | input |
| `judge` | `JudgeRef` | manifested judge |
| `idea_id` | `Slug` | input |
| `scores` | map criterion → `Score10` | flattened from `assessments[*].score` |
| `weighted_total` | number 1–10 | computed (see 2.5) |
| `output` | `IdeaEvaluationOutput` | the judge's return |

### 2.4 Procedure

1. **Build the task prompt** from the idea (template in 2.6).
2. **Run the judge** with its manifested system prompt + the task prompt.
3. **Extract** the single JSON object from the response (ignore surrounding
   prose / code fences).
4. **Validate** against `IdeaEvaluationOutput`. On failure, re-prompt the judge
   with the exact validation errors and ask for corrected JSON only. Retry up to
   **3 attempts** total, then fail this pair (log it; don't write a record).
5. **Flatten** `assessments[*].score` into `scores`.
6. **Compute** `weighted_total` (2.5).
7. **Assemble** the `IdeaEvaluation` record and validate it (consistency check
   in 2.7) before writing to disk.

### 2.5 Weighted-total math

```
weighted_total = Σ_criterion ( scores[criterion] × rubric_weights[criterion] )
```

Round to 2 decimals. Because weights sum to 1.0 and each score is 1–10, the
result is always in [1, 10]. The judge supplies raw per-criterion scores; the
**harness** applies the weights — the judge must not pre-average.

### 2.6 Task-prompt template (Phase 1)

```
Evaluate this hackathon startup idea against YOUR rubric and priorities.

# {title}
{one_liner}

Team: {team, comma-separated}
Links: {k: v, ...}   ← omit if none

## Pitch
{body}

Return ONE JSON object with this exact shape (scores are integers 1-10):
{ ...IdeaEvaluationOutput shape from §2.2... }
```

### 2.7 Validation rules (Phase 1)

- Output satisfies `IdeaEvaluationOutput` (all 5 criteria present, scores are
  ints 1–10, verdict in enum, confidence in [0,1]).
- **Consistency:** for every criterion, `scores[c] == output.assessments[c].score`.
  A mismatch is a hard error — never persist.
- `weighted_total` recomputes to the stored value.

---

## 3. Phase 2 — Judge-to-judge judging

**One rater judge critiques another judge's Phase 1 evaluation.** This is the
recursive step that produces reputation signal. Depends only on Phase 1 output,
so the full `rater × target × idea` matrix runs in parallel after Phase 1.

### 3.1 Inputs

| Input | Description |
|-------|-------------|
| manifested rater | the judge doing the critiquing (system prompt + `JudgeRef`) |
| target evaluation | a Phase 1 `IdeaEvaluation` to be critiqued |
| idea | the idea both refer to (context for the prompt) |
| `run_id`, `evaluator_version` | current run |
| `blind` | boolean, default **true** — hide the target judge's identity to reduce halo bias |

**Hard rule:** the rater must **not** be the same judge version as the target
(`rater.judge_id/version != target.judge.judge_id/version`). Self-evaluation is
rejected before any model call.

### 3.2 Meta-dimensions

The rater scores the target's *judgment* (not the idea) on four orthogonal axes:

| Dimension | Meaning | Direction |
|-----------|---------|-----------|
| `reasoning_quality` | Is the rationale sound and grounded in the idea? | higher = better |
| `calibration` | Do the numeric scores match the strength of the reasoning? | higher = better |
| `insight` | Did they surface something non-obvious? | higher = better |
| `bias` | Halo / vibe / pet-peeve distortion | **PENALTY**: 1 = unbiased … 10 = blatantly biased |

### 3.3 Schema A — `MetaEvaluationOutput` (what the rater returns)

| Field | Type | Rule |
|-------|------|------|
| `dimensions.reasoning_quality` | `Score10` | 1–10 |
| `dimensions.calibration` | `Score10` | 1–10 |
| `dimensions.insight` | `Score10` | 1–10 |
| `dimensions.bias` | `Score10` | 1–10 (penalty axis) |
| `agreement` | enum | `agree` \| `partially` \| `disagree` |
| `suggested_total_delta` | number | −9…9; **+ = target was too harsh**, − = too generous |
| `counter_verdict` | enum | `advance` \| `borderline` \| `pass` (what the rater would call) |
| `notes` | string | 1–3 sentences citing the target's rationale, ≤1500 chars |

```json
{
  "dimensions": { "reasoning_quality": 8, "calibration": 6, "insight": 9, "bias": 3 },
  "agreement": "partially",
  "suggested_total_delta": 0.5,
  "counter_verdict": "borderline",
  "notes": "Good wedge insight, but slightly harsh on traction given the stage."
}
```

### 3.4 Schema B — `MetaEvaluation` (persisted record)

Written to `runs/<run_id>/meta/<rater_id>--on--<target_id>--<idea_id>.json`.

| Field | Type | Source |
|-------|------|--------|
| `run_id` | `RunId` | input |
| `created_at` | `IsoTimestamp` | now |
| `evaluator_version` | `EvaluatorVersion` | input |
| `rater` | `JudgeRef` | manifested rater |
| `target` | `JudgeRef` | from the target evaluation |
| `idea_id` | `Slug` | input |
| `output` | `MetaEvaluationOutput` | the rater's return |
| `meta_score` | number 1–10 | computed (see 3.7) |

### 3.5 Procedure

1. **Guard self-evaluation** — if rater == target version, abort this pair.
2. **Build the critique prompt** (3.6). If `blind`, refer to the author only as
   "Another judge"; otherwise name them.
3. **Run the rater** with its manifested system prompt + critique prompt.
4. **Extract + validate** against `MetaEvaluationOutput`; re-prompt with exact
   errors, up to 3 attempts, else fail this pair.
5. **Compute** the single-critique `meta_score` (3.7).
6. **Assemble** the `MetaEvaluation` record, re-check the self-exclusion rule,
   and write to disk.

### 3.6 Critique-prompt template (Phase 2)

```
You are reviewing another judge's evaluation of a hackathon idea. Judge the
QUALITY of their judgment — not the idea itself. Be fair but exacting.

## The idea
# {title}
{one_liner}

## {Another judge | Judge "{target_id}"}'s evaluation
Scores:
  problem:  {s}/10 — {reason}
  solution: {s}/10 — {reason}
  market:   {s}/10 — {reason}
  team:     {s}/10 — {reason}
  traction: {s}/10 — {reason}
Weighted total: {weighted_total}/10
Verdict: {verdict} (confidence {confidence})
Rationale: {rationale}
Key question they'd ask: {key_question}
Strengths they cited: {strengths}
Risks they cited: {risks}

Rate them on four dimensions (integers 1-10): reasoning_quality, calibration,
insight, and bias (1 = unbiased … 10 = clearly biased).

Return ONE JSON object with the MetaEvaluationOutput shape from §3.3.
```

### 3.7 Meta-score math (evaluator v1)

```
meta_score = clamp_[1,10]( 0.4 × reasoning_quality
                         + 0.3 × calibration
                         + 0.3 × insight
                         − 0.2 × bias )
```

Round to 2 decimals. This is the score of a **single critique**, not a judge's
reputation — reputation is the mean of many critiques (Phase 3, see `root.md`).

> **Versioning rule:** any change to this formula or the dimension weights = a
> **new** `evaluator_version` (e.g. `eval@v2`), never an in-place edit.
> Otherwise reputation comparisons across versions become invalid.

### 3.8 Validation rules (Phase 2)

- Output satisfies `MetaEvaluationOutput` (4 dimensions present as ints 1–10,
  `agreement` and `counter_verdict` in their enums, `suggested_total_delta` in
  [−9, 9]).
- `rater` ≠ `target` (self-exclusion) — enforced before the model call and again
  on the assembled record.
- `meta_score` recomputes to the stored value.

---

## 4. Robustness rules (both phases)

These make the steps reliable enough to run unattended across a fan-out:

- **JSON extraction:** take the first balanced top-level `{...}` object from the
  model's text; tolerate prose and code fences around it.
- **Repair loop:** on any parse/validation failure, re-issue the same task with
  the precise error appended and "reply with ONLY the corrected JSON object."
  Cap at 3 attempts per pair.
- **Fail closed:** if a pair can't produce a valid record after retries, log it
  and skip — never write a partial or guessed record. A run can complete with
  holes; the ledger stays clean.
- **Determinism of derived fields:** `weighted_total` and `meta_score` are
  always computed by the harness, never taken from the model.
- **Provenance on every record:** `run_id`, `created_at`, `evaluator_version`,
  and `JudgeRef`(s) are mandatory so results are reproducible and comparable.

---

## 5. Agent & skill mapping

How an actual agent system carries this out (see `root.md` §8–9 for the roster):

| Step | Subagent | Skill (how-to) | Reads | Writes |
|------|----------|----------------|-------|--------|
| Phase 1 | `idea-judge` | `score-idea` | manifested judge, idea | `runs/<id>/evaluations/` |
| Phase 2 | `meta-judge` | `critique-evaluation` | manifested rater, target eval, idea | `runs/<id>/meta/` |

Parallelism: the orchestrator spawns one `idea-judge` per `(judge, idea)`,
barriers on completion of Phase 1, then spawns one `meta-judge` per
`(rater, target, idea)` where `rater ≠ target`.

---

## 6. Worked end-to-end example

1. **Manifest** `paul-graham@3` and `jessica-livingston@2`.
2. **Phase 1:** `paul-graham@3` scores `idea-014` → `IdeaEvaluation` with
   `weighted_total = 8×0.3 + 6×0.2 + 7×0.2 + 5×0.2 + 3×0.1 = 6.3`,
   verdict `borderline`.
3. **Phase 2 (blind):** `jessica-livingston@2` critiques that evaluation →
   dimensions `{8,6,9,3}` →
   `meta_score = 0.4×8 + 0.3×6 + 0.3×9 − 0.2×3 = 7.1`.
4. **Phase 3 (out of scope here):** mean of all critiques targeting
   `paul-graham@3` → one append-only `ReputationSnapshot` (see `root.md` §6.5).

---

## 7. Open questions

- **Blind by identity vs. by content:** blinding the *name* reduces halo bias,
  but a distinctive voice in the rationale can still leak identity. Consider
  paraphrasing rationales before Phase 2 if leakage proves significant.
- **Ground truth:** `meta_score` is peer-relative. If a labeled set of known
  winning ideas exists, add an agreement-with-truth term and bump
  `evaluator_version`.
- **Score scale:** 1–10 integers chosen for legibility; revisit if judges
  cluster (e.g. everything 6–8) — a forced-distribution rubric may help.
