---
name: score-idea
description: Phase-1 of Judge Me Bro. Use when ONE manifested judge persona must score ONE idea against the shared 5-axis rubric (problem, solution, market, team, traction), emit a strict IdeaEvaluationOutput JSON, and persist it via the harness (which computes the weighted total). Not for meta-judging — that is critique-evaluation.
---

# score-idea

One judge, in character, scores one idea. Five axes (integers 1–10) through this
judge's taste, into a strict `IdeaEvaluationOutput` JSON. A deterministic
TypeScript harness — never you — validates your output, flattens scores, applies
the persona's `rubric_weights` to compute `weighted_total`, and writes the
persisted record. You judge; the harness does the math and the bookkeeping. See
`specs/root.md` (§6.3, §7 Phase 1), `specs/evaluation.md` §2, and
`specs/idea-schema.md` (the 5-axis lock). If anything here disagrees with
`harness/schemas.ts` (`IdeaEvaluationOutput`), the schema wins.

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
- The judge's identity for provenance: `judge_id`, `judge_version`, `kind`
  (`judge` | `founder`). These match the persona's `id`, `version`, `kind`.

## Procedure

1. **Manifest the persona.** Load `voice`, `values`, `red_flags`,
   `rubric_weights`, `calibration_notes`, and the worked examples. Score IN
   CHARACTER — adopt this judge's taste, not a neutral one. You do **not**
   pre-average and you do **not** apply `rubric_weights` yourself — but let them
   tell you where to be demanding: a heavily-weighted axis deserves a harder,
   more discriminating score.
2. **Score the 5 axes, integers 1–10.** Read each idea section and score the
   correspondingly-named axis: `## Problem` → `problem`, `## Solution` →
   `solution`, `## Market` → `market`, `## Team` → `team`, `## Traction` →
   `traction`. One section, one score — never cross axes. Enforce the 1–10
   integer range (not 0, not a float, not a string).
3. **`verdict`** ∈ `{"advance","borderline","pass"}` — `advance` = fund/progress,
   `borderline` = on the fence, `pass` = reject. Choose what this persona would
   call.
4. **`confidence`** ∈ `[0,1]` — how sure this judge is, given the idea's
   evidence and the persona's `calibration_notes`.
5. **`rationale`** — 2–4 sentences written IN the persona's `voice`, ≤2000 chars.
   Cite the persona's actual `values` / `red_flags` that fired on this idea.
6. **`key_question`** — the single sharpest question this judge would ask the
   founder, in voice.
7. **`strengths` / `risks`** — each an array of **0–5** short strings: the
   standout positives and the things that would worry this judge.
8. **Emit, then persist.** Emit exactly one `IdeaEvaluationOutput` JSON object
   (below), write it to a temp file, and persist it via the harness — which
   validates, computes `weighted_total`, and owns the disk write. The harness
   OWNS validation so bad rows never reach the ledger; never hand-write the
   record.

## Output schema

Emit a single `IdeaEvaluationOutput` JSON object — no prose, no provenance,
nothing else. (The harness tolerates surrounding prose/fences, but a clean object
makes the repair loop unnecessary.)

```json
{
  "assessments": {
    "problem":  { "score": 8, "reason": "real, frequent pain for backend teams" },
    "solution": { "score": 6, "reason": "plausible codemod wedge, quality unproven at scale" },
    "market":   { "score": 7, "reason": "every backend org; mid-market wedge is reachable" },
    "team":     { "score": 9, "reason": "scratch-their-own-itch; shipped this before" },
    "traction": { "score": 4, "reason": "9 design partners, 2 paid — early but real" }
  },
  "verdict": "advance",
  "confidence": 0.72,
  "rationale": "Strong wedge into a real, frequent pain, attacked by founders who lived it. The open question is whether codemod quality holds past the easy ecosystems.",
  "key_question": "what makes this 10x not 10%?",
  "strengths": ["clear, frequent painkiller", "founder/market fit"],
  "risks": ["incumbent CI vendors can ship this", "codemod quality may not generalize"]
}
```

Field rules (from `harness/schemas.ts` — authoritative — and evaluation.md §2.2):

| Field | Rule |
|-------|------|
| `assessments` | object with **exactly** these 5 keys: `problem`, `solution`, `market`, `team`, `traction`. No more, no fewer. |
| `assessments.<c>.score` | integer **1–10** (not 0, not a float, not a string). |
| `assessments.<c>.reason` | non-empty string, **1–500 chars**. |
| `verdict` | exactly one of `advance` \| `borderline` \| `pass`. |
| `confidence` | number in **[0, 1]**. |
| `rationale` | **2–4 sentences in the persona's voice**, 1–2000 chars. |
| `key_question` | the single sharpest question for the founders; non-empty string. |
| `strengths` | array of **0–5** strings. |
| `risks` | array of **0–5** strings. |

**Do NOT include** `scores`, `weighted_total`, `judge_id`, `judge_version`,
`idea_id`, `run_id`, `created_at`, or `evaluator_version` — those are
provenance/derived fields the harness adds (it derives `weighted_total =
Σ score × rubric_weights[axis]`). Keep your object to exactly the seven fields
above; never pre-average the criteria into a single number.

Write this JSON object to a temp file, e.g.:

```
out=$(mktemp /tmp/idea-eval-XXXXXX.json)
# …write the single IdeaEvaluationOutput object to "$out" (Write tool or a heredoc)…
```

## Persist via the harness (computes weighted_total, writes the record)

Run the deterministic CLI. It extracts the first JSON object from your file,
validates it against `IdeaEvaluationOutput`, reads the persona's `rubric_weights`
(by `--judge-id`/`--judge-version`), computes `weighted_total`, assembles +
validates the `IdeaEvaluation`, and writes it to
`runs/<run_id>/evaluations/<judge_id>@<judge_version>--<idea_id>.json`:

```bash
npx tsx harness/cli.ts eval:persist \
  --run "$run_id" --evaluator "$evaluator_version" \
  --judge-id "$judge_id" --judge-version "$judge_version" --kind "$kind" \
  --idea "$idea_id" --raw "$out"
```

- **Exit 0:** it prints the written path. Report that path — you are done.
- **Non-zero:** it prints validation errors as `- path: message` lines and writes
  **nothing** (fail-closed). Run the repair loop below.

Optional pre-check (no write): `npx tsx harness/cli.ts eval:validate --raw "$out"`
validates the JSON shape only. `eval:persist` validates anyway, so it is optional.

## Repair loop (evaluation.md §4) — at most 3 attempts total

If `eval:persist` exits non-zero:

1. Read the printed `- path: message` errors literally (e.g.
   `- assessments.team.score: Number must be less than or equal to 10`, or
   `- verdict: Invalid enum value`).
2. Fix **only** what the errors call out (a score out of range, a missing
   criterion, a wrong enum value, a too-long string, an extra/derived field).
   Keep your judgment intact.
3. Rewrite the corrected single JSON object to the temp file and re-run
   `eval:persist`.

Cap at **3 attempts total** (the first persist + up to 2 repairs). If it still
fails, **STOP**: report this `(persona, idea)` pair as **failed** and do not write
a record any other way. **Never hand-write or fake an `IdeaEvaluation`** — a run
may complete with holes; the ledger stays clean (§4 "fail closed"). Only report a
path the CLI actually printed.

## Validation checklist

- [ ] `assessments` has exactly the five keys `problem, solution, market, team,
      traction`, each `{ score, reason }` with `score` an integer in `[1, 10]`.
- [ ] Each score read from its 1:1 idea H2 section — no axes crossed.
- [ ] `verdict` ∈ `{"advance","borderline","pass"}`.
- [ ] `confidence` a number in `[0, 1]`.
- [ ] `rationale` (≤2000 chars) in the persona's voice; cites the
      `values`/`red_flags` that fired.
- [ ] `key_question` in voice, single sharpest question.
- [ ] `strengths` and `risks` each an array of 0–5 strings.
- [ ] **No** `scores`, `weighted_total`, or provenance fields — the harness adds
      them.
- [ ] Persisted via `eval:persist`; the CLI printed a path under
      `runs/<run_id>/evaluations/`.
