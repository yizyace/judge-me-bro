---
name: critique-evaluation
description: Phase-2 meta-judging — one manifested judge (the rater) critiques another judge's Phase-1 Evaluation along 4 fixed dimensions and emits a strict Meta-evaluation JSON. Use after Phase 1 evaluations exist (specs/root.md §7 Phase 2) to produce the reputation signal the `update-reputation` skill later aggregates. NOT for scoring ideas — that is the sibling `score-idea` skill.
---

# critique-evaluation (Phase 2: judges judge judges)

A rater persona critiques **another** judge's Phase-1 Evaluation and writes one
Meta-evaluation JSON. This skill owns its output-schema validation so bad rows
never reach the ledger (specs/root.md §9). Idea-scoring belongs to `score-idea`;
do not score ideas here.

## Inputs

- **Rater persona** — `personas/**/<slug>@<ver>.md`. Manifest its `voice`,
  `values`, `red_flags`, `calibration_notes` so the critique is in character.
- **Target Evaluation** — `runs/<run-id>/evaluations/<targetJudge>@<ver>--<idea>.json`
  (Phase-1 output, schema specs/root.md §6.3). Read its `scores`,
  `weighted_total`, `verdict`, `rationale`, and `key_question`.
- **Idea (optional)** — `ideas/<idea-id>.md` for grounding the critique.
- **`run_id`** — the current run.

## Self-exclusion guard (do this FIRST)

A judge MUST NOT rate its own evaluation. **If `rater_id == target_judge_id`,
skip immediately** — produce no meta-evaluation, write no file, emit no JSON.
This prevents self-scoring and halo bias (specs/root.md §7 Phase 2, §13). Only
proceed past this check when rater and target are distinct judges.

## Dimensions (each a 0–10 integer)

- **`reasoning_quality`** — is the target's rationale sound and well-argued?
- **`calibration`** — do the numeric `scores`/`weighted_total` match the stated
  reasoning?
- **`insight`** — did the target see something others missed?
- **`bias`** — degree of bias. **LOWER = more biased.** This is a PENALTY term,
  not a virtue: 0 = heavily biased, 10 = clean. It is subtracted in the formula.

## Procedure

1. **Self-exclusion guard** — bail if `rater_id == target_judge_id` (see above).
2. **Manifest the rater** persona; read the target Evaluation (`rationale`,
   `scores`, `weighted_total`, `verdict`, `key_question`) and optionally the idea.
3. **Score the 4 dimensions** 0–10 in the rater's character, enforcing the
   integer range. Judge the *quality of the evaluation*, not the idea.
4. **Compute `meta_score`** with the locked formula (root.md §7 v1 baseline):

   ```
   meta_score = 0.4*reasoning_quality + 0.3*calibration + 0.3*insight - 0.2*bias
   ```

   Round to 1 decimal.
5. **`notes`** — a crisp critique in the rater's voice: what was strong, what was
   off, citing specifics from the target's rationale/scores (e.g. "score too
   harsh on traction for stage").
6. **Validate** against the schema below, then write to
   `runs/<run-id>/meta/<rater>--on--<target>--<idea>.json`. Filename exactly
   `<rater>--on--<target>--<idea>.json` (judgeA = rater, judgeB = target).

## Output schema (locked — specs/root.md §6.4)

Write to `runs/<run-id>/meta/<judgeA>--on--<judgeB>--<idea>.json`:

```json
{
  "run_id": "...",
  "rater_id": "jessica-livingston",
  "rater_version": 2,
  "target_judge_id": "paul-graham",
  "target_judge_version": 3,
  "idea_id": "idea-014",
  "dimensions": {
    "reasoning_quality": 8,
    "calibration": 6,
    "insight": 9,
    "bias": 3
  },
  "meta_score": 7.3,
  "notes": "strong wedge insight, but score too harsh on traction for stage"
}
```

## Validation checklist

- [ ] `rater_id != target_judge_id` (self-exclusion guard passed).
- [ ] All keys present: `run_id`, `rater_id`, `rater_version`,
      `target_judge_id`, `target_judge_version`, `idea_id`, `dimensions`,
      `meta_score`, `notes`.
- [ ] `dimensions` has exactly the 4 keys `reasoning_quality`, `calibration`,
      `insight`, `bias`, each an **integer in 0–10**.
- [ ] `rater_version` and `target_judge_version` are integers matching the
      personas/evaluation used.
- [ ] `meta_score` equals
      `0.4*reasoning_quality + 0.3*calibration + 0.3*insight - 0.2*bias`,
      rounded to 1 decimal.
- [ ] `notes` is a specific, in-character critique citing the target's reasoning.
- [ ] Filename is exactly `<rater>--on--<target>--<idea>.json` under
      `runs/<run-id>/meta/`.
