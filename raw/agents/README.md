# raw/agents — raw judge distillations

Raw, browser-sourced distillations of the **PoC Fest** judge panel, written in the
canonical persona schema (`specs/root.md` §6.1, manifested per
`specs/judging-schemas.md` §1.4) so they drop straight into the pipeline. This is
the **raw layer**: a provenance-rich source of truth that feeds
`personas/judges/<slug>@<version>.md`.

Files (all `kind: judge`, `version: 1`, distilled `2026-06-01`):

- **`drew-mailen.md`** — CEO & co-founder, Valiron (trust infra for AI agents).
  **Net-new** — not yet present in `personas/judges/`.
- **`vatsa-shah.md`** — CTO & co-founder, Valiron. Mirrors
  `personas/judges/vatsa-shah@1.md` (PR #2), plus primary sources (X, Superteam Canada).
- **`daniel-merja.md`** — Founder/CEO GoTogether AI; partner, FCV; hw.cafe. Mirrors
  `personas/judges/daniel-merja@1.md` (PR #2), plus primary sources (X, Instagram, FCV, event bio).

**Format** matches PR #2 (`personas/judges/*.md`): YAML frontmatter
(`id, kind, version, source_urls, distilled_at, distilled_by, domains, values,
red_flags, rubric_weights, voice, calibration_notes`) + `## Background` /
`## How they evaluate` / `## Worked examples`. `rubric_weights` are the shared MVP
default (flat `0.20`).

**Provenance:** sources viewed live on 2026-06-01 (gated X/Instagram profiles via
browser, public sites via web). Quotes are verbatim; inferred judging lenses are
flagged in `calibration_notes` and in the "not attested verdicts" worked examples.
