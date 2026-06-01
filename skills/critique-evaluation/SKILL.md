---
name: critique-evaluation
description: Phase-2 meta-judging — one manifested judge (the rater) critiques ANOTHER judge's Phase-1 idea-evaluation along 4 fixed dimensions (reasoning_quality, calibration, insight, bias-as-penalty), emits a strict MetaEvaluationOutput JSON, and persists it via the harness (which computes meta_score) with a self-exclusion guard and blinding. Use after Phase 1 evaluations exist (specs/root.md §7 Phase 2). NOT for scoring ideas — that is the sibling `score-idea` skill.
---

# critique-evaluation (Phase 2: judges judge judges)

A rater persona critiques **another** judge's Phase-1 idea-evaluation — the
QUALITY of their judgment, not the idea itself — and emits one strict
`MetaEvaluationOutput` JSON. You reason; the **harness owns the math and the
disk**: it validates your JSON, computes `meta_score`, enforces self-exclusion,
and writes the record. Idea-scoring belongs to `score-idea`; do not score ideas
here.

Authoritative contract: `specs/evaluation.md` §3 (Phase 2) and §4 (robustness),
and `specs/root.md` §7. On any conflict, `harness/schemas.ts`
(`MetaEvaluationOutput`) wins.

**Core principle: judge the JUDGMENT, not the idea.** A great idea can get a
sloppy evaluation and a weak idea a sharp one. Reward sound, grounded reasoning
and well-calibrated scores; penalize halo/vibe/pet-peeve distortion.

## Inputs

- **Rater persona** — `personas/**/<slug>@<ver>.md`. Manifest its `voice`,
  `values`, `red_flags`, `calibration_notes` so the critique is in character.
- **Target evaluation** — another judge's persisted Phase-1 `IdeaEvaluation`
  (e.g. `runs/<run-id>/evaluations/<targetJudge>@<ver>--<idea>.json`). Read its
  `scores`, `weighted_total`, `verdict`, `confidence`, `rationale`,
  `key_question`, `strengths`, `risks`.
- **Idea (context only)** — `title`, `one_liner`; do **not** re-evaluate it.
- **`run_id`**, **`evaluator_version`** (e.g. `eval@v1`).
- Your **rater** `JudgeRef` `{judge_id, judge_version, kind}` and the **target**
  `JudgeRef` (so self-exclusion can be checked).
- **`blind`** — boolean, default **true**.

### Blinding (default true)

If `blind` is true, refer to the target **only** as "Another judge." Do not try
to unmask them — do not guess the persona from voice, do not name them, do not let
a suspected identity color the scores. If `blind` is false, you may refer to them
as `Judge "{target_id}"`. Blinding reduces halo bias (§3.1); honor it.

## Self-exclusion guard (do this FIRST)

**Never critique your own evaluation.** If the rater and target are the same
distillation — same `judge_id` **AND** same `judge_version` — STOP immediately and
report the pair as skipped (self-exclusion). Produce no JSON, write no file, do
not call the harness (it refuses self-pairs anyway). A rater MAY critique a
*different version* of itself (different `judge_version`) — only the identical
`(judge_id, judge_version)` pair is forbidden.

## The four dimensions (§3.2) — each an integer 1–10

| Dimension | What you are rating | Direction |
|-----------|---------------------|-----------|
| `reasoning_quality` | Is the target's rationale sound and grounded in the idea? | higher = better |
| `calibration` | Do the numeric scores match the strength of the reasoning? | higher = better |
| `insight` | Did they surface something non-obvious? | higher = better |
| `bias` | Halo / vibe / pet-peeve distortion | **PENALTY**: 1 = unbiased … 10 = blatantly biased |

`bias` is a **penalty axis**: a fair, even-handed evaluation scores **low** (1–2);
a clearly slanted one scores **high**. Do not invert it.

## Procedure

1. **Self-exclusion guard** — bail if rater and target are the same
   `(judge_id, judge_version)` (see above).
2. **Manifest the rater** persona; read the target evaluation (`rationale`,
   `scores`, `weighted_total`, `verdict`, `key_question`, `strengths`, `risks`)
   and the idea for context. Critique IN the rater's character. Be fair but
   exacting.
3. **Score the 4 dimensions** as integers 1–10. Judge the *quality of the
   evaluation*, not the idea. Remember `bias` is a penalty (low = clean).
4. **Decide the non-dimension fields:**
   - `agreement` ∈ `{agree, partially, disagree}` — how much you agree with their
     overall call.
   - `suggested_total_delta` — a number in **[−9, 9]**. **Positive = the target
     was too harsh** (you'd score higher); **negative = too generous**; `0` if
     you'd land on the same total. A delta on the 1–10 weighted total, not a new
     score.
   - `counter_verdict` ∈ `{advance, borderline, pass}` — the verdict **you** would
     call on this idea.
   - `notes` — **1–3 sentences, ≤1500 chars**, that **cite the target's
     rationale** (quote or paraphrase a specific claim of theirs) and justify your
     scores.
5. **Emit, then persist.** Emit exactly one `MetaEvaluationOutput` JSON object
   (below), write it to a temp file, and persist via the harness — which
   validates, computes `meta_score`, enforces self-exclusion, and owns the disk
   write.

## Output schema

Emit a single `MetaEvaluationOutput` JSON object with **exactly** these keys and
nothing else. Do **NOT** include `meta_score` — the harness computes it (§3.7);
supplying it is not part of the schema.

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
  "notes": "Strong wedge insight, but the traction score reads too harsh for the stage given their own '2 paid' note."
}
```

Field rules (from `harness/schemas.ts` — authoritative — §3.3 / §3.8):

- `dimensions.{reasoning_quality,calibration,insight,bias}` — each an **integer
  1–10**. All four required.
- `agreement` ∈ `{agree, partially, disagree}`.
- `suggested_total_delta` — number in `[−9, 9]`.
- `counter_verdict` ∈ `{advance, borderline, pass}`.
- `notes` — non-empty string, ≤1500 chars.
- **No `meta_score`**, no `rater_id`/`target_judge_id`/`run_id`/`idea_id` (those
  are provenance/derived fields the harness adds), no extra keys. No surrounding
  prose required (the harness tolerates prose/fences, but a clean object is best).

Write this JSON object to a temp file, e.g.
`/tmp/<rater_id>--on--<target_id>--<idea_id>.json`.

## Persist via the harness (computes meta_score, writes the record)

It is **fail-closed**: it refuses self-pairs, validates the output, computes
`meta_score`, and only writes a record on VALID input. Replace the `<…>`
placeholders from your inputs.

```bash
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

## Repair loop (≤ 3 attempts, then fail closed) — §4

On a **non-zero exit**, the harness prints `- path: message` validation errors.
Read them, fix the JSON in the temp file, and re-run `meta:persist`. Cap at **3
attempts total** for this pair. Common fixes:

- a dimension missing or out of `[1, 10]` (or not an integer) → correct it.
- `agreement` / `counter_verdict` not in its enum → use an allowed value.
- `suggested_total_delta` outside `[−9, 9]` → clamp it.
- `notes` empty or >1500 chars → tighten it.
- you accidentally included `meta_score` or an extra key → remove it.

If it **still** fails after 3 attempts, **STOP and report the pair failed**
(fail-closed). Never write or fake a record — a run may complete with holes; the
ledger stays clean.

## Validation checklist

- [ ] Self-exclusion guard passed (rater `(judge_id, judge_version)` ≠ target).
- [ ] `dimensions` has exactly the 4 keys `reasoning_quality`, `calibration`,
      `insight`, `bias`, each an **integer in 1–10** (`bias` = penalty, low =
      clean).
- [ ] `agreement` ∈ `{agree, partially, disagree}`.
- [ ] `suggested_total_delta` a number in `[−9, 9]`.
- [ ] `counter_verdict` ∈ `{advance, borderline, pass}`.
- [ ] `notes` a specific, in-character critique citing the target's reasoning,
      ≤1500 chars.
- [ ] **No** `meta_score` and **no** provenance keys — the harness adds them.
- [ ] Persisted via `meta:persist`; the CLI printed a path under
      `runs/<run_id>/meta/`.
