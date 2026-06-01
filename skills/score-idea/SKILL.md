---
name: score-idea
description: Phase-1 of Judge Me Bro. Use when ONE manifested judge persona must score ONE idea against the shared 5-axis rubric (problem, solution, market, team, traction), weighted by the persona's rubric_weights, and emit a strict Evaluation JSON. Not for meta-judging — that is critique-evaluation.
---

# score-idea

One judge, in character, scores one idea. Five axes (0–10), weighted by the
persona's `rubric_weights`, into a locked Evaluation JSON. See `specs/root.md`
(§6.3, §7 Phase 1) and `specs/idea-schema.md` (the 5-axis lock).

## Inputs

- **Persona (the judge):** `personas/judges/<slug>@<ver>.md`. Read its
  frontmatter — `voice`, `values`, `red_flags`, `rubric_weights`,
  `calibration_notes` — and the prose `## How they evaluate` and
  `## Worked examples` for few-shot calibration.
- **Idea:** `ideas/<idea-id>.md` with exactly five scored H2 sections —
  `## Problem`, `## Solution`, `## Market`, `## Team`, `## Traction` — each
  mapping 1:1 to one score. Schema: `specs/idea-schema.md`.
- **`run_id`** (e.g. `2026-06-01T18-00Z`) and **`evaluator_version`**
  (e.g. `eval@v1`).

## Procedure

1. **Manifest the persona.** Load `voice`, `values`, `red_flags`,
   `rubric_weights`, `calibration_notes`, and the worked examples. Score IN
   CHARACTER — adopt this judge's taste, not a neutral one.
2. **Score the 5 axes, 0–10 integers.** Read each idea section and score the
   correspondingly-named axis: `## Problem` → `problem`, `## Solution` →
   `solution`, `## Market` → `market`, `## Team` → `team`, `## Traction` →
   `traction`. One section, one score — never cross axes. Enforce the 0–10
   integer range.
3. **`weighted_total`** = sum(`score_axis` × `rubric_weights[axis]`) over the
   five axes. Persona `rubric_weights` sum ~1.0 (MVP default is flat 0.20 each).
   Round to 1 decimal.
4. **`verdict`** ∈ `{"advance","hold","pass"}` — `advance` = fund/progress,
   `hold` = borderline, `pass` = reject. Choose what this persona would call.
5. **`confidence`** ∈ `[0,1]` — how sure this judge is, given the idea's
   evidence and the persona's `calibration_notes`.
6. **`rationale`** — short, written IN the persona's `voice`. Cite the
   persona's actual `values` / `red_flags` that fired on this idea.
7. **`key_question`** — the single sharpest question this judge would ask the
   founder, in voice.
8. **Validate, then write.** Validate against the Output schema below before
   writing. This skill OWNS its output-schema validation so bad rows never reach
   the ledger. Write to
   `runs/<run-id>/evaluations/<judge>@<ver>--<idea>.json` — filename pattern
   exactly `<judge>@<ver>--<idea>.json`.

## Output schema

Write to: `runs/<run-id>/evaluations/<judge>@<ver>--<idea>.json`

```json
{
  "run_id": "2026-06-01T18-00Z",
  "judge_id": "paul-graham",
  "judge_version": 3,
  "idea_id": "idea-014",
  "scores": { "problem": 8, "solution": 6, "market": 7, "team": 9, "traction": 4 },
  "weighted_total": 7.1,
  "verdict": "advance",
  "confidence": 0.72,
  "rationale": "…",
  "key_question": "what makes this 10x not 10%?",
  "evaluator_version": "eval@v1"
}
```

- `judge_id`, `judge_version` come from the persona frontmatter (`id`,
  `version`). `idea_id` comes from the idea frontmatter (`id`).

## Validation checklist

- [ ] `scores` has exactly the five keys `problem, solution, market, team,
      traction`, each an integer in `[0, 10]`.
- [ ] Each score read from its 1:1 idea H2 section — no axes crossed.
- [ ] `weighted_total` = Σ(score × `rubric_weights[axis]`), rounded to 1
      decimal; weights summed ~1.0.
- [ ] `verdict` ∈ `{"advance","hold","pass"}`.
- [ ] `confidence` a number in `[0, 1]`.
- [ ] `rationale` in the persona's voice; cites the `values`/`red_flags` that
      fired.
- [ ] `key_question` in voice, single sharpest question.
- [ ] `judge_id`/`judge_version`/`idea_id` match the source files;
      `evaluator_version` is the passed-in value.
- [ ] File written to `runs/<run-id>/evaluations/` with name exactly
      `<judge>@<ver>--<idea>.json`.
