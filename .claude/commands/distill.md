---
description: Distill ONE real judge or smart-founder into a schema-valid, versioned persona file from a few high-signal public sources.
argument-hint: "<person-or-slug> [source-url ...]"
allowed-tools: Task, Bash, Read
---

You are the **distill orchestrator** for Judge Me Bro. Your job is thin: resolve the
target's identity + version, dispatch the **distiller** subagent to do the actual
research and writing, and report the result. The distiller (via the `distill-persona`
skill) does the reasoning; the TS harness validates and writes the file (fail-closed).
**You never hand-write a persona file** — every persona is installed through
`npx tsx harness/cli.ts persona:put` so the schema is enforced.

Arguments: `$ARGUMENTS`
The first token is the **target person** — either a display name (`"Paul Graham"`) or a
kebab-case **slug** (`paul-graham`). Any remaining tokens are optional **source URLs** or
pasted reference material to distill from. If `$ARGUMENTS` is empty, ask the user who to
distill (and for at least one source URL) before continuing.

**Core principle:** a few HIGH-SIGNAL primary sources (their own essays, talks, long-form
interviews, an authoritative bio) beat broad scraping. Provenance is required — every
source actually used must land in the persona's `source_urls`.

## 1. Resolve the `id` slug and `kind`

- **`id`** — derive the stable kebab-case slug (`^[a-z0-9]+(?:-[a-z0-9]+)*$`, ≤64 chars)
  from the target: lowercase, spaces/punctuation → single hyphens (`"Paul Graham"` →
  `paul-graham`). If the user already passed a slug, use it verbatim.
- **`kind`** — `judge` (a real hackathon-panel judge) or `founder` (a smart-founder
  reference for panel enrichment / calibration). **Infer** it if the request makes it
  obvious; otherwise **ask the user** which one. Do not guess silently.

## 2. Decide the `version` (bump if the persona already exists)

Check whether a persona already exists for this `id` in **either** persona directory
(`kind` decides where the *new* file lands, but an id should be checked in both to be safe):

```bash
ls personas/judges/<id>@*.md personas/founders/<id>@*.md 2>/dev/null
```

- **No existing file** → `version: 1` (first distillation).
- **Existing file(s)** → set the new `version` to **(highest existing version) + 1**.
  Versions are **immutable**: the old `<id>@<N>.md` file is **retained**, never
  overwritten — you are creating a *new* file at the bumped version. (Read an existing
  file if helpful to carry forward identity, but the distiller rewrites the content from
  the sources.)

State the resolved `id`, `kind`, and chosen `version` before dispatching.

## 3. Dispatch the distiller subagent

Dispatch **one** `distiller` subagent via the Task tool
(`subagent_type: "distiller"`). Give its prompt exactly:

- the **target** (name and/or slug) and the resolved **`id`**,
- the **`kind`** (`judge` | `founder`),
- the chosen **`version`** (and, if a bump, that prior versions exist and must be retained),
- any **source URLs / pasted material** the user provided (verbatim),

and these instructions:

- Apply the **distill-persona** skill (`.claude/skills/distill-persona/SKILL.md`); the
  authoritative field contract is `specs/persona-schema.md`.
- Gather **2–5 high-signal primary sources** where the person reveals *how they judge*;
  record every URL actually used in `source_urls`. **Never invent a source or a verdict.**
- Fill **every** required `PersonaFrontmatter` field — including `id`/`kind`/`version`
  exactly as resolved above, `distilled_by: distiller@v1`, and `rubric_weights` over the
  five criteria (`problem`, `solution`, `market`, `team`, `traction`) **summing to 1.0
  (±0.01)** and **skewed to this person's documented priorities** — then write the grounded
  body (`## Background`, `## How they evaluate`, `## Worked examples`).
- Write the candidate to a **temp path** (e.g. `/tmp/<id>@<version>.md`) and install it
  through the harness (it validates first and only writes if valid):

  ```bash
  npx tsx harness/cli.ts persona:put --raw /tmp/<id>@<version>.md
  ```

  On validation errors (printed as `- path: message`, non-zero exit), **fix the temp file
  and re-run** until it passes (optionally `persona:validate --raw <tempfile>` to check
  without writing). The harness routes by `kind` and writes
  `personas/judges/<id>@<version>.md` or `personas/founders/<id>@<version>.md`.
- Report back the **written persona path** the harness printed, or, on failure, the exact
  validation errors.

## 4. Report

Relay to the user:

- The **written persona path** under `personas/judges/` or `personas/founders/` (and note
  whether this was version 1 or a bump that retained the prior file), **or**
- the **validation errors** if the distiller could not produce a valid persona (a persona
  that fails the schema is never written — say so plainly rather than claiming success).

Keep it to one persona per invocation.
