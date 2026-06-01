---
name: distill-idea
description: >-
  Phase-0 skill that converts a REAL company's public material into a
  schema-valid "idea" (a startup pitch) the AI judge panel can score. Use when
  you have a real company/startup and need to produce a scorable participant
  pitch at ideas/<idea-id>.md. The participant-side mirror of distill-persona.
  This skill OWNS idea-schema validation so malformed pitches never reach the
  judges.
---

# distill-idea

Turn a real company's public record into one schema-valid idea file. The output
is a **participant** the judge panel scores along the 5 shared rubric axes
(`problem, solution, market, team, traction`). One body section → one score.

Full contract: [`specs/idea-schema.md`](../../specs/idea-schema.md). This skill
is the participant-side parallel of `distill-persona` and is the **only writer**
of `ideas/<id>.md`.

## Core principle

**Distillation is reporting, not selling.** State only what the public record
supports. Name gaps ("no public revenue figures") — never invent them. Every
non-obvious claim must be traceable to a `source_urls` entry. The body
*describes*; it never tells a judge what to score.

## Inputs

- A **real company/startup** to distill (the common case). Originals are
  hand-authored, not produced here.
- **≥1 public source URL** (homepage, about page, press, deck, filings, founder
  talks/posts). Required whenever `source_company` is non-null.
- Optional: a target `<idea-id>` slug. If omitted, derive `idea-<slug>` from the
  company name.

## Procedure

1. **Gather sources.** Collect the company's public material and record each URL
   for `source_urls` (≥1). Prefer primary sources. If a fact has no source,
   it does not go in the body.
2. **Extract per axis.** From the sources, pull what is *supported* for each of
   the five axes — problem, solution, market, team, traction. Mark thin axes as
   gaps; do not pad them. (`stage`, `team` list, and `links` are optional and
   not scored — capture only if public.)
3. **Draft frontmatter.** Fill all required fields: `id` (`idea-<slug>`),
   `title`, `one_liner` (≤140 chars), `source_company`, `source_urls`,
   `distilled_at` (ISO date), `distilled_by: idea-distiller@v1`. Add optional
   `stage`/`team`/`links` only if publicly supported.
4. **Write the 5 sections.** Emit exactly these H2s, in this order:
   `## Problem`, `## Solution`, `## Market`, `## Team`, `## Traction`. Optionally
   append `## The Ask` (unscored). No other scored sections; no score hints.
5. **Validate.** Run the checklist below. If anything fails, fix before writing.
   This skill owns validation — a malformed idea must never reach the judges.

Writing is **idempotent on `id`**: writing the same `id` replaces
`ideas/<id>.md` in place.

## Validation checklist

- [ ] `id` is a unique slug of the form `idea-<slug>`.
- [ ] All required frontmatter present with correct types: `id`, `title`,
      `one_liner`, `source_company`, `source_urls`, `distilled_at`,
      `distilled_by`.
- [ ] `one_liner` is a single sentence, ≤140 characters.
- [ ] `source_urls` has ≥1 entry whenever `source_company` is non-null.
- [ ] `distilled_at` is an ISO date; `distilled_by` is `idea-distiller@v1`.
- [ ] Body contains the five scored H2 sections, **exactly named, in this
      order**: Problem → Solution → Market → Team → Traction. Missing one =
      invalid.
- [ ] `## The Ask` only appears (if at all) as the last section; it is unscored.
- [ ] No score hints in the body; gaps are named, not invented; every
      non-obvious claim traces to a `source_urls` entry.
- [ ] File is written at `ideas/<id>.md` and nowhere else.

## Example

```markdown
---
id: idea-stripe
title: "Stripe"
one_liner: "Payments infrastructure for the internet"
source_company: "Stripe"
source_urls:
  - https://stripe.com/
  - https://stripe.com/about
distilled_at: 2026-06-01
distilled_by: idea-distiller@v1
stage: seed
team: ["Patrick Collison", "John Collison"]
links: { demo: "https://stripe.com/", deck: "https://..." }
---

## Problem
Online businesses faced fragmented, slow card-processing integrations; standing
up payments meant gateways, merchant accounts, and weeks of engineering.

## Solution
A developer-first API: a few lines of code to accept payments, with the
underlying processing, compliance, and infrastructure abstracted away.

## Market
Online commerce and the broader move of economic activity to the internet; the
buyers are any business that needs to charge customers online.

## Team
Founded by Patrick and John Collison. Public record: early technical founders
with prior startup experience; no further claims beyond what sources support.

## Traction
Per public materials, broad adoption across internet businesses. No public
revenue figures are asserted here beyond what `source_urls` document.

## The Ask
(Optional, unscored.) What the company is raising / asking for, if public.
```
