---
name: distill-persona
description: Turn scraped public material (a real hackathon judge or a smart-founder reference — talks, essays, posts, interviews, bios, or source URLs) into ONE schema-valid persona markdown file. Distills their TASTE into the PersonaFrontmatter machine contract (id, kind, version, name, source_urls, domains, values, red_flags, rubric_weights over the 5 criteria summing to 1.0, voice, calibration_notes, provenance), writes grounded few-shot body prose, and validates + installs via the harness CLI. Use whenever you need to add or re-distill a judge/founder persona.
---

# distill-persona

Distill a real person's **taste** into a persona file the judging harness can
manifest. The YAML **frontmatter is the machine contract** (validated by
`harness/schemas.ts` → `PersonaFrontmatter`); the markdown **body is few-shot
fuel** injected verbatim into the manifested judge. Authoritative contract:
[`specs/persona-schema.md`](../../../specs/persona-schema.md) — read it if any
detail here is ambiguous; on conflict, `schemas.ts` + `evaluation.md` win.

**Core principle: a few HIGH-SIGNAL sources beat broad scraping.** Three essays
or talks where the person states their actual decision criteria are worth more
than fifty pages of secondhand profile. Distill the *operating manual* of their
taste, not a biography.

## When to use

- Adding a new `judge` (a real hackathon-panel judge) or `founder` (a
  smart-founder reference for panel enrichment + calibration).
- Re-distilling an existing persona with better sources / sharper weights — this
  **bumps `version`** and writes a *new* file (the old one is retained).

## Workflow

### 1. Gather a few high-signal sources

Find 2–5 sources where the person *reveals how they judge*: their own
essays/blog posts, conference talks, long-form interviews, "how I evaluate
startups" pieces, or an authoritative bio. Prefer primary, first-person material
over secondhand summaries.

- **Capture every URL you actually used into `source_urls`** — this is the
  provenance of the distillation. Each entry must be a valid URL.
- If the user pasted raw text instead of links, distill from that text and
  record whatever canonical URL(s) it came from. **Never invent a source.** If
  there is genuinely no URL for a pasted transcript, it is acceptable to leave
  `source_urls: []`, but prefer at least one real link.
- Stop when you can articulate, in their voice, what they *reward* and *punish*.
  More sources past that point add noise, not signal.

### 2. Distill the taste into the frontmatter (the machine contract)

Fill **every** required field. Map each to `PersonaFrontmatter`
(persona-schema.md §2):

| Field | How to fill it |
|-------|----------------|
| `id` | kebab-case slug, `^[a-z0-9]+(?:-[a-z0-9]+)*$`, ≤64 chars (e.g. `paul-graham`). Must equal the `<slug>` in the filename; immutable across versions. |
| `kind` | `judge` (real panel judge) or `founder` (smart-founder reference). |
| `version` | Positive integer. **`1` for a first distillation.** If a prior file exists for this `id`, **bump to the next integer and keep the old file** (versions are immutable — see step 5). |
| `name` | Human display name (e.g. `"Paul Graham"`). The one optional field — if omitted, reports title-case the `id`. Provide it. |
| `source_urls` | Array of the valid URLs from step 1 — the provenance. |
| `distilled_at` | The date you ran this (e.g. `2026-06-01`); keep it parseable. |
| `distilled_by` | `distiller@v1` (the producer version). |
| `domains` | Sectors they're credible in (e.g. `[b2b, devtools, marketplaces]`). |
| `values` | **What they REWARD** — concrete taste signals in their own framing (e.g. `"clear wedge into a real, frequent pain"`). The signal that makes manifesting meaningful — make these specific, not generic. |
| `red_flags` | **What they PUNISH** (e.g. `"solution in search of a problem"`). |
| `rubric_weights` | See below — the hard one. |
| `voice` | Short style descriptor for how they talk (e.g. `"terse, contrarian, asks the obvious question first"`). |
| `calibration_notes` | Known scoring biases / heuristics (e.g. `"discounts polished demos; rewards distribution insight"`). |

**`rubric_weights` — reflect THEIR priorities, not a neutral split.** An object
with **exactly** these five keys, each in `[0,1]`, **summing to 1.0 within
±0.01** (the harness rejects anything outside `[0.99, 1.01]`, with a missing
key, or with an extra key):

```yaml
rubric_weights:
  problem: 0.32   # real, frequent, painful problem?
  solution: 0.16  # actually solves it + differentiated?
  market: 0.14    # large & reachable?
  team: 0.30      # can THIS team execute?
  traction: 0.08  # evidence it's working?
```

Skew the weights toward what the *sources show the person actually cares about*.
Someone who preaches founder/market fit and "make something people want" should
weight `problem` and `team` heavily and `traction` lightly; a metrics-driven
operator might invert that. **Do the arithmetic and confirm the five numbers sum
to 1.00** before moving on — this is the most common validation failure. These
are *priorities*, not a pre-average: the judge later emits raw 1–10 scores and
the harness applies these weights.

### 3. Write the body sections (few-shot fuel)

Below the frontmatter, write three sections (persona-schema.md §4), all
**grounded in the sources** so the persona stays faithful to the real human:

- `## Background` — who they are, what they've built/judged, how they think.
  Prose distilled from the sources.
- `## How they evaluate` — their heuristics, famous lines, decision patterns —
  the *operating manual* for their taste. Bullets work well.
- `## Worked examples` — **real** yes/no calls with the reasoning, used as
  few-shot calibration so the manifested judge mimics their actual decisions.
  Ground these in things the person genuinely said or did (e.g. a startup they
  praised or panned and why). Mark each clearly as **Yes:** / **No:**. Don't
  fabricate verdicts the sources don't support.

Keep the body tight and concrete — it is reference material the judge reads
every run, not an essay.

### 4. Validate + install via the harness

Write the file to a **temp path first**, then run the harness to validate and
install it. The harness is **fail-closed**: it never writes on invalid input.

```bash
# 1. Write the candidate to a temp path (NOT directly into personas/).
#    e.g. /tmp/<id>@<version>.md

# 2. Validate only — prints "- path: message" errors, exits non-zero if invalid:
npx tsx harness/cli.ts persona:validate --raw /tmp/<id>@<version>.md

# 3. Validate + write to personas/<judges|founders>/<id>@<version>.md and
#    register the judge version. Prints the written path:
npx tsx harness/cli.ts persona:put --raw /tmp/<id>@<version>.md
```

You can go straight to `persona:put` (it validates first and only writes if
valid). On any validation error, **read the `- path: message` lines, fix the
frontmatter in the temp file, and re-run** until it passes. Typical fixes:

- `rubric_weights` don't sum to ~1.0 → re-balance so they total 1.00.
- `rubric_weights` missing/extra key → keys must be exactly the five criteria.
- a `source_urls` entry isn't a valid URL → fix or drop it.
- `id` not kebab-case, or missing a required string field → correct it.

The `kind` field routes the install: `kind: judge` → `personas/judges/`,
`kind: founder` → `personas/founders/`. The filename is always
`<id>@<version>.md` and **must** match `id`/`version` in the frontmatter.

### 5. Re-distillation (bump, don't overwrite)

If a persona already exists for this `id`, set `version` to the next integer
(e.g. `2`), write the new `<id>@2.md`, and **leave `<id>@1.md` in place**.
Versions are immutable; reputation records bind to `(judge_id, version)` so
improvement is measurable across versions (persona-schema.md §1).

## Done when

- `npx tsx harness/cli.ts persona:put --raw <temp>` printed a written path under
  `personas/judges/` or `personas/founders/` (i.e. validation passed and the
  file was installed).
- The frontmatter has all required fields, `rubric_weights` sum to 1.0, and
  `source_urls` are real URLs from the material you actually used.
- The body's `## Worked examples` are grounded in the sources, not invented.

## Remember

- **A few high-signal sources beat broad scraping.** Find where they state their
  criteria; stop there.
- **The frontmatter is the machine contract; the prose is few-shot fuel.** Get
  the weights and taste signals right first.
- **Never invent sources or verdicts.** Provenance and worked examples must be
  faithful to the real person.
