# Persona Schema — Frontmatter Contract & Manifesting

> Sub-spec of [`root.md`](./root.md) (§6.1). Defines the **persona file**: the
> distilled source of truth for a judge's taste. The YAML frontmatter is the
> **machine contract** validated by `harness/schemas.ts` (`PersonaFrontmatter`);
> the markdown body is **few-shot fuel** for the manifested judge.

- **Status:** Draft (hackathon planning)
- **Parent spec:** [`root.md`](./root.md) · sibling: [`evaluation.md`](./evaluation.md)
- **Authoritative contract:** `harness/schemas.ts` → `PersonaFrontmatter`,
  `RubricWeights`, `Slug`, `Version`, `Kind`. This doc MUST match that file; on
  any conflict, `schemas.ts` + `evaluation.md` win.
- **Last updated:** 2026-06-01

---

## 1. What a persona is

A **persona** is a distilled human — a real hackathon `judge` or a
"smart `founder`" reference — stored as one markdown file at:

```
personas/judges/<slug>@<version>.md      # kind: judge
personas/founders/<slug>@<version>.md    # kind: founder
```

The file has two parts:

1. **Frontmatter (YAML)** — the *machine contract*. Parsed and validated against
   `PersonaFrontmatter`. Drives manifesting and the weighted-total math. **A
   persona that fails this schema is never manifested.**
2. **Body (markdown)** — *few-shot fuel*. Prose distilled from the sources; fed
   verbatim into the judge's system prompt as reference. Not schema-validated,
   but three sections are conventional and expected (see §4).

Re-distilling a persona **bumps `version`** and writes a *new* file; the old
file is **retained** (versions are immutable). Reputation and evaluator records
bind to a specific `(judge_id, version)` so improvement is measurable
(root.md §6.5, §7).

---

## 2. Frontmatter field reference (the machine contract)

Every field below maps 1:1 to `PersonaFrontmatter` in `harness/schemas.ts`.
"Required?" = whether the field must be present for the object to validate.

| Field | Type / rule | Required? | Description |
|-------|-------------|-----------|-------------|
| `id` | `Slug` — kebab-case `^[a-z0-9]+(?:-[a-z0-9]+)*$`, ≤64 chars | **Yes** | Stable slug identifying the human (e.g. `paul-graham`). Must match the `<slug>` in the filename. Immutable across versions. |
| `kind` | enum `judge` \| `founder` | **Yes** | `judge` = a real hackathon-panel judge; `founder` = a smart-founder reference persona (panel enrichment + calibration baseline). |
| `version` | `Version` — positive integer (`int`, `> 0`) | **Yes** | Distillation version. Bumped on every re-distillation; the previous file is retained, never overwritten. Pairs with `id` to form the immutable judge identity. |
| `name` | string, ≥1 char | **Optional** | Human display name used by reports / the leaderboard (e.g. `"Paul Graham"`). When absent, the harness falls back to a **title-cased `id`** (`paul-graham` → `Paul Graham`). |
| `source_urls` | array of **URL** strings (each must parse as a URL) | **Yes** | Provenance for the distillation — the public talks/posts/interviews/bios the persona was distilled from. May be empty (`[]`), but every element must be a valid URL. |
| `distilled_at` | string, ≥1 char | **Yes** | When the distillation ran. A date (`2026-06-01`) or an ISO timestamp; not strictly date-validated by the schema, but keep it parseable. |
| `distilled_by` | string, ≥1 char | **Yes** | Which agent/skill produced this file, e.g. `distiller@v1`. Captures the *producer* version for reproducibility. |
| `domains` | array of strings | **Yes** | Sectors/areas of expertise the persona is credible in (e.g. `[b2b, devtools, marketplaces]`). May be empty. Injected as context when manifesting. |
| `values` | array of strings | **Yes** | What this persona **rewards** — taste signals (e.g. `"clear wedge into a real, frequent pain"`). May be empty. |
| `red_flags` | array of strings | **Yes** | What this persona **punishes** (e.g. `"solution in search of a problem"`). May be empty. |
| `rubric_weights` | `RubricWeights` — object keyed by **exactly** the 5 criteria, each a number in `[0,1]`, **summing to 1.0 (±0.01)** | **Yes** | How this persona trades off the shared rubric. Keys MUST be exactly `problem`, `solution`, `market`, `team`, `traction` (no more, no fewer). Consumed by the harness to compute `weighted_total` (evaluation.md §2.5). See §3. |
| `voice` | string, ≥1 char | **Yes** | Short style descriptor for the judge's prose (e.g. `"terse, contrarian, asks the obvious question first"`). Shapes the rationale tone in Phase 1. |
| `calibration_notes` | string, ≥1 char | **Yes** | Known scoring biases / heuristics to apply (e.g. `"tends to discount demos; rewards distribution insight"`). |

**Notes**

- **Strict object:** `PersonaFrontmatter` is a plain `z.object`. Extra unknown
  keys are not part of the contract; keep frontmatter to exactly these fields to
  avoid surprises (per evaluation.md §1, "change them in one place").
- **`name` is the only optional field.** Everything else must be present, even
  if an array is empty (`[]`) or a string is a minimal placeholder.
- Empty-array fields (`source_urls`, `domains`, `values`, `red_flags`) validate
  when empty, but a useful persona populates `values`/`red_flags` — they are the
  taste signal that makes manifesting meaningful.

---

## 3. `rubric_weights` — the five criteria

The five rubric criteria are the single source of truth shared by personas,
scores, and reports (evaluation.md §1.1):

| Criterion | What it weights |
|-----------|-----------------|
| `problem` | Is this a real, frequent, painful problem? |
| `solution` | Does the approach actually solve it, and is it differentiated? |
| `market` | Is the addressable market large and reachable? |
| `team` | Can *this* team execute it? |
| `traction` | Is there evidence (users, demo, data) that it's working? |

**Hard rule (enforced by `RubricWeights.refine`):** the five weights must
**sum to 1.0 within ±0.01**. The object must contain **exactly** these five keys
— a missing key, an extra key, or a sum outside `[0.99, 1.01]` fails validation
and the persona is rejected.

These weights are the persona's **priorities**, not a pre-average. In Phase 1 the
judge supplies raw per-criterion scores (1–10); the **harness** applies the
weights to compute `weighted_total = Σ scores[c] × rubric_weights[c]` (rounded
to 2 dp, always in `[1,10]`; evaluation.md §2.5). The judge model must **not**
pre-average the criteria itself.

---

## 4. Body sections (few-shot fuel)

Below the frontmatter, the markdown body carries the distilled prose. It is
**not** schema-validated, but the manifestor injects it verbatim as reference,
so these three sections are the expected shape (root.md §6.1):

| Section | Purpose |
|---------|---------|
| `## Background` | Prose distilled from the sources — who they are, what they've built/judged, how they think. |
| `## How they evaluate` | Heuristics, famous quotes, decision patterns — the *operating manual* for their taste. |
| `## Worked examples` | Known yes/no calls and the reasoning behind them — used as **few-shot calibration** so the manifested judge mimics real decisions. |

Frontmatter is the contract; prose is fuel. Keep the body grounded in the
`source_urls` so the persona stays faithful to the real human.

---

## 5. Manifesting (evaluation.md §1.4)

Before either evaluation phase runs, a persona is **manifested** — assembled
into the **system prompt** the judge model uses. The system prompt is built from
the frontmatter (plus the body as reference):

- **identity** — `id` (and `name`/`kind` for context)
- **`voice`** — how the judge writes
- **`values`** (what they reward) and **`red_flags`** (what they punish)
- **`rubric_weights`** — their priorities (they must **NOT** pre-average the
  criteria; raw scores in, harness applies weights)
- **`calibration_notes`** and **`domains`**
- the **persona body** (`## Background`, `## How they evaluate`,
  `## Worked examples`) as reference / few-shot material

A rule is baked into the assembled system prompt:

> *"Score against YOUR priorities, not a neutral average. Return exactly one
> JSON object matching the requested schema and nothing else."*

So a manifested judge **scores against its own `rubric_weights`**, not a neutral
average, and returns **exactly one JSON object** (the `IdeaEvaluationOutput`
shape in Phase 1, or `MetaEvaluationOutput` in Phase 2). The harness extracts
that single object, validates it, and computes the derived fields
(`weighted_total`, `meta_score`) — never the model. The same persona is
manifested as a **rater** in Phase 2 (judge-of-judges), where it critiques other
judges' Phase-1 outputs (its own hidden, to avoid self-scoring).

---

## 6. Complete valid example

The following file passes `PersonaFrontmatter` in `harness/schemas.ts`
(`rubric_weights` sum `0.30 + 0.20 + 0.20 + 0.20 + 0.10 = 1.00`; all required
fields present; `source_urls` are valid URLs; `name` provided but optional).

```markdown
---
id: paul-graham
kind: founder
version: 3
name: Paul Graham
source_urls:
  - https://www.paulgraham.com/ds.html
  - https://www.ycombinator.com/library/
distilled_at: 2026-06-01
distilled_by: distiller@v1
domains: [b2b, devtools, marketplaces]
values:
  - "clear wedge into a real, frequent pain"
  - "founder/market fit over polish"
  - "distribution insight, not just product"
red_flags:
  - "solution in search of a problem"
  - "vitamin, not painkiller"
rubric_weights:
  problem: 0.30
  solution: 0.20
  market: 0.20
  team: 0.20
  traction: 0.10
voice: "terse, contrarian, asks the obvious question first"
calibration_notes: "tends to discount demos; rewards distribution insight; wary of crowded markets without a wedge"
---

## Background

Co-founded Viaweb and Y Combinator; has read more early-stage pitches than
almost anyone. Thinks in terms of *frequency × intensity* of a pain and whether
the founders are the right people to attack it.

## How they evaluate

- Asks "what makes this 10x better, not 10%?" before anything else.
- Rewards a sharp, narrow wedge over a broad, vague platform.
- Discounts polished demos; looks for evidence of real, frequent usage.
- Distribution is a first-class question, not an afterthought.

## Worked examples

- **Yes:** a tool that removes a daily, hair-on-fire pain for a specific team,
  even with an ugly demo — because the pain is real and frequent.
- **No:** a slick platform "for everyone" with no concrete first user — a
  solution in search of a problem.
```

---

## 7. Cross-references & consistency

- **Criteria & weights:** evaluation.md §1.1 (criteria) and §2.5 (weighted-total
  math); `RUBRIC_CRITERIA` + `RubricWeights` in `schemas.ts`.
- **Manifesting:** evaluation.md §1.4.
- **JudgeRef / versioning:** `{ judge_id, judge_version, kind }` tags every
  record (evaluation.md §1.3); `(judge_id, version)` is the immutable identity in
  the ledger (root.md §6.5).
- **Reputation:** how a judge version is scored from meta-evaluations lives in
  [`reputation.md`](./reputation.md).

> If this doc and `schemas.ts`/`evaluation.md` ever disagree, treat
> `schemas.ts` + `evaluation.md` as authoritative and fix this doc.
