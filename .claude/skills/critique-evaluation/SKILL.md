---
name: critique-evaluation
description: Phase-2 judge-to-judge critique — score the QUALITY of ANOTHER judge's Phase-1 idea-evaluation (never your own) on four fixed dimensions (reasoning_quality, calibration, insight, bias-as-penalty), emit ONE schema-valid MetaEvaluationOutput, and persist it via the harness with a self-exclusion guard, blinding, and a bounded repair loop. Use whenever a manifested rater must judge a target judge's evaluation in Phase 2.
---

# critique-evaluation

You are a **manifested rater judge** doing Phase 2 of *Judge Me Bro*: you
critique the **judgment** of *another* judge's Phase-1 evaluation — not the idea
itself. You reason; the **harness owns the math and the disk**. It extracts and
validates your JSON, computes `meta_score`, enforces self-exclusion, and writes
the record. Your job is to produce **exactly one** `MetaEvaluationOutput` and
hand it to the harness.

Authoritative contract: [`specs/evaluation.md`](../../../specs/evaluation.md) §3
(inputs §3.1, dimensions §3.2, output schema §3.3, procedure §3.5, critique
prompt §3.6, meta-score math §3.7, validation §3.8) and §4 (robustness). On any
conflict, `harness/schemas.ts` (`MetaEvaluationOutput`) + `evaluation.md` win.

**Core principle: judge the JUDGMENT, not the idea.** A great idea can get a
sloppy evaluation and a weak idea a sharp one. Reward sound, grounded reasoning
and well-calibrated scores; penalize halo/vibe/pet-peeve distortion. You are not
re-scoring the idea — you are rating how well *they* scored it.

## What you are given

The agent that invokes you supplies:

- **The idea** — `title`, `one_liner` (context only; do not re-evaluate it).
- **Another judge's Phase-1 evaluation** — the target's `scores` (the 5 rubric
  criteria), `weighted_total`, `verdict`, `confidence`, `rationale`,
  `key_question`, `strengths`, `risks`.
- **`run_id`**, **`evaluator_version`** (e.g. `eval@v1`).
- Your own **rater** `JudgeRef` `{judge_id, judge_version, kind}` and the
  **target** `JudgeRef` (so self-exclusion can be checked).
- **`blind`** — boolean, default **true**.

### Blinding (default true)

If `blind` is true (the default), the target is referred to **only** as
"Another judge." **Do not try to unmask them** — do not guess the persona from
voice, do not name them, do not let a suspected identity color the scores. If
`blind` is false, you may refer to them as `Judge "{target_id}"`. Blinding
reduces halo bias (§3.1); honor it.

## Self-exclusion (hard rule)

**Never critique your own evaluation.** If the rater and target are the same
distillation — same `judge_id` **and** same `judge_version` — STOP immediately
and report the pair as skipped (self-exclusion, §3.1). Do not call the harness;
it will refuse a self-pair anyway, but you must not even attempt it. A rater may
critique a *different version* of itself (different `judge_version`) — only the
identical `(judge_id, judge_version)` pair is forbidden.

## The four meta-dimensions (§3.2)

Score each as an **integer 1–10**:

| Dimension | What you are rating | Direction |
|-----------|---------------------|-----------|
| `reasoning_quality` | Is the rationale sound and grounded in the idea? | higher = better |
| `calibration` | Do the numeric scores match the strength of the reasoning? | higher = better |
| `insight` | Did they surface something non-obvious? | higher = better |
| `bias` | Halo / vibe / pet-peeve distortion | **PENALTY**: 1 = unbiased … 10 = blatantly biased |

`bias` is a **penalty axis**: a fair, even-handed evaluation scores **low** (1–2);
a clearly slanted one scores **high**. Do not invert it.

## Workflow

### 1. Build the critique prompt (§3.6) and reason

Lay out the idea and the target's evaluation using the §3.6 template. If `blind`,
the heading is "Another judge's evaluation"; otherwise `Judge "{target_id}"`.
Read their `rationale`, `scores`, `verdict`, `key_question`, `strengths`, and
`risks`, and form a judgment on the four dimensions. Be **fair but exacting**.

### 2. Decide the non-dimension fields

- `agreement` — `agree` | `partially` | `disagree`: how much you agree with
  their overall call.
- `suggested_total_delta` — a number in **[−9, 9]**. **Positive = the target was
  too harsh** (you'd score higher); **negative = too generous**. `0` if you'd
  land on the same total. This is a delta on the 1–10 weighted total, not a new
  score.
- `counter_verdict` — `advance` | `borderline` | `pass`: the verdict **you**
  would call on this idea.
- `notes` — **1–3 sentences, ≤1500 chars**, that **cite the target's rationale**
  (quote or paraphrase a specific claim of theirs) and justify your scores.

### 3. Emit EXACTLY one JSON object (`MetaEvaluationOutput`, §3.3)

Output a single JSON object with **exactly** these keys and nothing else. Do
**NOT** include `meta_score` — the harness computes it (§3.7); supplying it is
not part of the schema.

```json
{
  "dimensions": {
    "reasoning_quality": 8,
    "calibration": 6,
    "insight": 9,
    "bias": 3
  },
  "agreement": "partially",
  "suggested_total_delta": 0.5,
  "counter_verdict": "borderline",
  "notes": "Good wedge insight, but slightly harsh on traction given the stage."
}
```

Field rules (the validation gate, §3.3 / §3.8):

- `dimensions.{reasoning_quality,calibration,insight,bias}` — each an **integer
  1–10**. All four required.
- `agreement` ∈ `{agree, partially, disagree}`.
- `suggested_total_delta` — number in `[−9, 9]`.
- `counter_verdict` ∈ `{advance, borderline, pass}`.
- `notes` — non-empty string, ≤1500 chars.
- **No `meta_score`**, no extra keys, no surrounding prose required (the harness
  tolerates prose/fences, but a clean object is best).

### 4. Persist via the harness

Write the JSON to a **temp file**, then call the harness. It is **fail-closed**:
it refuses self-pairs, validates the output, and only writes a record on VALID
input. Replace the `<…>` placeholders from your inputs.

```bash
# Write your one MetaEvaluationOutput object to a temp path, e.g.:
#   /tmp/<rater_id>--on--<target_id>--<idea_id>.json

# (optional) pre-check only — prints "- path: message" errors, exits non-zero if invalid:
npx tsx harness/cli.ts meta:validate --raw /tmp/<rater_id>--on--<target_id>--<idea_id>.json

# validate + compute meta_score + write runs/<run_id>/meta/<rater_id>--on--<target_id>--<idea_id>.json:
npx tsx harness/cli.ts meta:persist \
  --run <run_id> --evaluator <evaluator_version> \
  --rater-id <rater_id> --rater-version <rater_version> --rater-kind <judge|founder> \
  --target-id <target_id> --target-version <target_version> --target-kind <judge|founder> \
  --idea <idea_id> --raw /tmp/<rater_id>--on--<target_id>--<idea_id>.json
```

On success the command prints the written path
(`runs/<run_id>/meta/<rater_id>--on--<target_id>--<idea_id>.json`) and exits 0.
**Report that path.** The harness refuses outright if `--rater-id`/`--rater-version`
equal `--target-id`/`--target-version` (self-exclusion).

### 5. Repair loop (≤ 3 attempts, then fail closed) — §4

On a **non-zero exit**, the harness prints `- path: message` validation errors.
**Read them, fix the JSON in the temp file, and re-run `meta:persist`.** Cap at
**3 attempts total** for this pair. Common fixes:

- a dimension missing or out of `[1, 10]` (or not an integer) → correct it.
- `agreement` / `counter_verdict` not in its enum → use an allowed value.
- `suggested_total_delta` outside `[−9, 9]` → clamp it.
- `notes` empty or >1500 chars → tighten it.
- you accidentally included `meta_score` or an extra key → remove it.

If it **still** fails after 3 attempts, **STOP and report the pair failed**
(fail-closed, §4). Never write or fake a record — a run may complete with holes;
the ledger stays clean.

## Done when

- `meta:persist` printed a written path under `runs/<run_id>/meta/` (validation
  passed, record written), **or**
- you correctly skipped a self-pair (self-exclusion), **or**
- you stopped after 3 failed attempts and reported the pair as failed.

## Remember

- **Judge the judgment, not the idea.** You rate *how* they evaluated.
- **Self-exclusion is absolute.** Never rate your own `(judge_id, judge_version)`.
- **`bias` is a penalty** — low = unbiased, high = biased. Don't invert it.
- **Blind by default** — refer to the target as "Another judge"; don't unmask.
- **One JSON object, no `meta_score`** — the harness computes derived fields.
- **Fail closed** — 3 attempts max, then skip; never persist a guessed record.
