# Idea Schema — Startup Proposal Contract

> Sub-spec of [`root.md`](./root.md). Defines the on-disk shape of a
> **participant**: a startup/company converted into a hackathon-style pitch that
> the AI judge panel scores. The frontmatter is the machine contract; the body
> sections are the few-shot fuel the judges read.

- **Status:** Draft (hackathon)
- **Owner:** Ace
- **Last updated:** 2026-06-01
- **Locked to:** the **5 shared rubric axes** — `problem, solution, market,
  team, traction` — so scoring is mechanical (one body section → one score).

---

## 1. Terminology

Per `root.md` glossary the canonical on-disk noun is **Idea**. A "startup
proposal" is just the *richer body* of an idea file. We do not rename `ideas/`,
`idea-judge`, etc.

A **distilled idea** is one produced from a *real company's* public material
(the common case for this system). An **original idea** is hand-authored. Both
use this identical schema; `source_company` is `null` for originals.

## 2. File location & naming

```
ideas/<idea-id>.md
```

- `<idea-id>` is a stable slug, prefixed `idea-`, e.g. `idea-stripe`.
- One idea per file. Markdown with YAML frontmatter.

## 3. Frontmatter contract (machine-readable)

```yaml
---
id: idea-stripe                 # stable slug, `idea-<slug>`
title: "Stripe"                 # short product/company name
one_liner: "Payments infrastructure for the internet"
source_company: "Stripe"        # real company this was distilled from; null if original
source_urls:                    # provenance for the distillation (>=1 when distilled)
  - https://stripe.com/
  - https://...
distilled_at: 2026-06-01        # ISO date
distilled_by: idea-distiller@v1 # which agent/skill produced this
stage: seed                     # OPTIONAL, NOT scored in MVP (pre-seed|seed|series-a|growth|public)
team:                           # OPTIONAL
  - "Patrick Collison"
  - "John Collison"
links:                          # OPTIONAL
  demo: https://...
  repo: https://...
  deck: https://...
---
```

### Field reference

| Field | Req | Notes |
|-------|-----|-------|
| `id` | ✅ | slug, `idea-<slug>`, unique |
| `title` | ✅ | short name |
| `one_liner` | ✅ | single sentence, ≤140 chars |
| `source_company` | ✅ | string, or `null` for original ideas |
| `source_urls` | ✅* | ≥1 required when `source_company` is set; provenance |
| `distilled_at` | ✅ | ISO date |
| `distilled_by` | ✅ | `<skill>@v<N>` |
| `stage` | — | optional; **not scored in MVP** |
| `team` | — | optional list |
| `links` | — | optional map (`demo`/`repo`/`deck`) |

## 4. Body — the 5 axes (scored)

The body MUST contain exactly these five H2 sections, in this order. Each maps
**1:1** to a score in the Phase-1 Evaluation (`root.md` §6.3
`scores.{problem,solution,market,team,traction}`). No other scored sections.

```markdown
## Problem
Who has the pain, how acute, how frequent. The wedge.

## Solution
What was built, why it's 10x not 10%, why now.

## Market
Size, who pays, the path from wedge to large market.

## Team
Why this team can win this — earned insight, unfair advantage.

## Traction
Evidence it's working: users, revenue, growth, named numbers.

## The Ask        ← OPTIONAL, NOT scored in MVP
What they're raising / asking for.
```

### Authoring rules

1. **One section per axis, named exactly** as above (judges key off the
   heading). Missing a scored section = invalid idea.
2. **Distillation is reporting, not selling.** Distilled ideas state what the
   public record supports; gaps are named ("no public revenue figures"), not
   invented. Every non-obvious claim is traceable to a `source_urls` entry.
3. **No score hints.** The body describes; it never tells a judge what to score.
4. **The Ask is optional and never scored** in the MVP.

## 5. Validation (skills enforce this)

A valid idea file:
- has all required frontmatter fields with correct types;
- has `source_urls` (≥1) whenever `source_company` is non-null;
- contains the five scored H2 sections, exactly named, in order;
- is the only writer of `ideas/<id>.md` (idempotent on `id`).

`distill-idea` owns this validation so malformed participants never reach the
judges.

## 6. Possible improvements (later — explicitly out of MVP scope)

Captured now so the 5-axis lock is a deliberate floor, not an accident:

- **Per-axis structured sub-fields** — e.g. `market.tam`, `traction.mrr`,
  `problem.frequency` as typed frontmatter so judges can score on numbers, not
  prose.
- **Promote `ask` / `stage` / `competition` to scored, weighted axes** (would
  extend the shared rubric beyond 5 and require an `evaluator_version` bump).
- **Per-idea rubric overrides** (a deep-tech idea weights `team`/`traction`
  differently than a consumer one).
- **Richer `links`** (multiple demos, press, financials) + attachment refs.
- **Confidence / provenance score** on the distillation itself (how much of the
  pitch is sourced vs. inferred).
- **Multi-version ideas** (`ideas/<id>@<version>.md`) to mirror persona
  versioning if we want to track how a pitch's framing changes.
