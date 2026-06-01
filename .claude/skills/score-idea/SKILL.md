---
name: score-idea
description: Phase 1 of judge-me-bro — manifest one distilled persona from its file and score one hackathon idea against THAT judge's priorities, emitting exactly one IdeaEvaluationOutput JSON object and persisting it (with the harness computing the weighted total) via the eval:persist CLI, with a fail-closed repair loop. Use when an idea-judge agent must turn a (persona, idea) pair into a validated, persisted IdeaEvaluation.
---

# score-idea — Phase 1 idea judging

You score **one idea** as **one persona**. The reasoning is yours (this Claude Code
subagent, on the subscription). A deterministic TypeScript harness — never you —
validates your output, flattens scores, applies the persona's `rubric_weights` to
compute `weighted_total`, and writes the persisted record. You judge; the harness
does the math and the bookkeeping.

Spec of record: `specs/evaluation.md` §1.4, §2; `specs/persona-schema.md` §5. If
anything here disagrees with `harness/schemas.ts`, the schema wins.

## Inputs you are given

- `persona_path` — the judge's persona markdown file (frontmatter + body).
- `idea_path` — the idea markdown file (frontmatter + pitch body).
- `run_id` — the current run.
- `evaluator_version` — e.g. `eval@v1`.
- The judge's identity for provenance: `judge_id`, `judge_version`, `kind`
  (`judge` | `founder`). These match the persona's `id`, `version`, `kind`.

## Step 1 — Manifest the judge (evaluation.md §1.4, persona-schema.md §5)

Read `persona_path`. Become this specific person. Build your operating frame from
the **frontmatter**:

- **identity** — `id` / `name` / `kind` (who you are).
- **`voice`** — exactly how you write. Your `rationale` must sound like this.
- **`values`** — what you REWARD. Look for these; score them up when present.
- **`red_flags`** — what you PUNISH. Hunt for these; score them down when present.
- **`rubric_weights`** — YOUR priorities across the five criteria. You do **not**
  pre-average and you do **not** apply these weights yourself — but you let them
  tell you where to be demanding. A criterion you weight heavily deserves a
  harder, more discriminating score; do not be generous on the axes you care about.
- **`calibration_notes`** — your known scoring biases/heuristics. Apply them.
- **`domains`** — sectors you are credible in (context for confidence).

…and from the **body** as few-shot fuel (read it verbatim as reference):

- `## Background` — who you are and how you think.
- `## How they evaluate` — your operating manual: heuristics, quotes, patterns.
- `## Worked examples` — your known yes/no calls. Mimic these decisions: if the
  idea resembles a "Yes" example, lean advance; if a "No" example, lean pass.

Baked-in rule (evaluation.md §1.4): **"Score against YOUR priorities, not a
neutral average. Return exactly one JSON object matching the requested schema and
nothing else."** A neutral, vendor-average review is wrong here — score as *this
human* would, with their taste and their blind spots.

## Step 2 — Build the task prompt from the idea (evaluation.md §2.6)

Read `idea_path`. Its frontmatter gives `title`, `one_liner`, `team` (list),
`links` (label→url map; may be absent), and the body is the full pitch (its
`## Problem / ## Solution / ## Market / ## Team / ## Traction` sections). Frame
your own evaluation against this template:

```
Evaluate this hackathon startup idea against YOUR rubric and priorities.

# {title}
{one_liner}

Team: {team, comma-separated}
Links: {label: url, ...}        ← omit this line entirely if there are no links

## Pitch
{body}

Return ONE JSON object with this exact shape (scores are integers 1-10):
{ ...IdeaEvaluationOutput shape from §2.2... }
```

Then actually evaluate: read the pitch closely and score each of the five criteria
through this persona's lens.

The five criteria (single source of truth, evaluation.md §1.1):

| Criterion | The question it answers |
|-----------|-------------------------|
| `problem` | Is this a real, frequent, painful problem? |
| `solution` | Does the approach actually solve it, and is it differentiated? |
| `market` | Is the addressable market large and reachable? |
| `team` | Can *this* team execute it? |
| `traction` | Is there evidence (users, demo, data) that it's working? |

## Step 3 — Produce EXACTLY one IdeaEvaluationOutput JSON object (§2.2)

Emit a single JSON object — no prose, no markdown fence required, nothing else —
with this exact shape. (The harness tolerates surrounding prose/fences, but clean
output makes the repair loop unnecessary.)

```json
{
  "assessments": {
    "problem":  { "score": 8, "reason": "real, frequent pain for backend teams" },
    "solution": { "score": 6, "reason": "plausible codemod wedge, quality unproven at scale" },
    "market":   { "score": 7, "reason": "every backend org; mid-market wedge is reachable" },
    "team":     { "score": 8, "reason": "scratch-their-own-itch; shipped this before" },
    "traction": { "score": 4, "reason": "9 design partners, 2 paid — early but real" }
  },
  "verdict": "borderline",
  "confidence": 0.6,
  "rationale": "Strong wedge into a real, frequent pain, attacked by founders who lived it. The open question is whether codemod quality holds past the easy ecosystems — until then it could be a feature, not a company.",
  "key_question": "What makes this 10x better, not 10% better, once changelog discipline gets worse?",
  "strengths": ["clear, frequent painkiller", "founder/market fit"],
  "risks": ["incumbent CI/Renovate vendors can ship this", "codemod quality may not generalize"]
}
```

Field rules (from `harness/schemas.ts` — authoritative — and evaluation.md §2.2):

| Field | Rule |
|-------|------|
| `assessments` | object with **exactly** these 5 keys: `problem`, `solution`, `market`, `team`, `traction`. No more, no fewer. |
| `assessments.<c>.score` | integer **1–10** (not 0, not a float, not a string). |
| `assessments.<c>.reason` | non-empty string, **1–500 chars**, one line. |
| `verdict` | exactly one of `advance` \| `borderline` \| `pass`. |
| `confidence` | number in **[0, 1]**. |
| `rationale` | **2–4 sentences in your (the persona's) voice**, ≤2000 chars, non-empty. |
| `key_question` | the single sharpest question for the founders; non-empty string. |
| `strengths` | array of **0–5** strings. |
| `risks` | array of **0–5** strings. |

**Do NOT include** `scores`, `weighted_total`, `judge`, `run_id`, `created_at`, or
`evaluator_version` — those are provenance/derived fields the harness adds. If you
emit them you are doing the harness's job; keep your object to exactly the eight
fields above. Never pre-average the criteria into a single number.

Write this JSON object to a temp file, e.g.:

```
out=$(mktemp /tmp/idea-eval-XXXXXX.json)
# …write the single JSON object to "$out" (Write tool or a heredoc)…
```

## Step 4 — Persist via the harness (computes weighted_total, writes the record)

Run the deterministic CLI. It extracts the first JSON object from your file,
validates it against `IdeaEvaluationOutput`, reads the persona's `rubric_weights`
(by `--judge-id`/`--judge-version`), computes `weighted_total = Σ score × weight`
(rounded 2dp), runs the §2.7 consistency check, assembles + validates the
`IdeaEvaluation`, and writes it to
`runs/<run_id>/evaluations/<judge_id>@<judge_version>--<idea_id>.json`:

```bash
npx tsx harness/cli.ts eval:persist \
  --run "$run_id" --evaluator "$evaluator_version" \
  --judge-id "$judge_id" --judge-version "$judge_version" --kind "$kind" \
  --idea "$idea_id" --raw "$out"
```

- **Exit 0:** it prints the written path. Report that path — you are done.
- **Non-zero:** it prints validation errors as `- path: message` lines and writes
  **nothing** (fail-closed). Go to Step 5.

Optional pre-check (no write): `npx tsx harness/cli.ts eval:validate --raw "$out"`
validates the JSON shape only. Useful to catch shape errors before persisting, but
`eval:persist` validates anyway, so it is not required.

## Step 5 — Repair loop (evaluation.md §4) — at most 3 attempts total

If `eval:persist` exits non-zero:

1. Read the printed `- path: message` errors literally. Each names the offending
   JSON path (e.g. `- assessments.team.score: Number must be less than or equal to 10`,
   or `- verdict: Invalid enum value`).
2. Fix **only** what the errors call out (a score out of range, a missing
   criterion, a wrong enum value, a too-long string, an extra/derived field, a
   `score` ≠ its place in `assessments`). Keep your judgment intact.
3. Rewrite the corrected single JSON object to the temp file and re-run
   `eval:persist`.

Cap at **3 attempts total** (the first persist + up to 2 repairs). If it still
fails after the third, **STOP**: report this `(persona, idea)` pair as **failed**
and do not write a record any other way. **Never hand-write or fake an
`IdeaEvaluation`** — a run is allowed to complete with holes; the ledger must stay
clean (§4 "fail closed"). Do not invent a path; only report a path the CLI
actually printed.

## Output of this skill

On success: the absolute path the CLI printed
(`runs/<run_id>/evaluations/<judge_id>@<judge_version>--<idea_id>.json`).
On failure after 3 attempts: a clear "FAILED: <judge_id>@<judge_version> ×
<idea_id> after N attempts" with the last validation errors — and no record.
