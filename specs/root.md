# Judge Me Bro — Root Specification

> Local-first, file-system-based AI judging system for hackathons.
> Distill real judges + "smart founders" into persona files, manifest them as
> subagents, and run a two-phase pipeline: judges score ideas, then judges
> judge each other. A versioned reputation system tracks who judges well.

- **Status:** Draft (hackathon planning)
- **Owner:** Ace
- **Last updated:** 2026-06-01
- **Scope of this doc:** the whole-app idea + the build plan. Sub-specs live
  alongside this file in `./specs/`.

---

## 1. The one-paragraph pitch

Hackathon judging is noisy, slow, and biased. *Judge Me Bro* builds a panel of
**AI judges** distilled from real people — the actual hackathon judges plus a
corpus of respected "smart founders" — captured as structured markdown persona
files. Each persona is **manifested** as a Claude subagent (`agent.md`) that
evaluates startup ideas in parallel. We then run a second, recursive phase where
judges **judge other judges' evaluations**, producing a **judge-to-judge
reputation score**. Reputations are **versioned**, and every version is bound to
an **evaluator** so we can measure whether a new distillation actually judges
better than the last. Runs local-first (markdown + SQLite), with a clean path to
hosting (upload distilled judges, track reputations in a shared DB).

---

## 2. Goals & non-goals

### Goals (hackathon MVP)

- Distill judges + smart founders into a **stable persona schema** (markdown +
  frontmatter).
- **Manifest** each persona as a subagent that can score an idea against a
  rubric and explain its reasoning.
- Run **Phase 1 (idea evaluation)** across all judges in **parallel**.
- Run **Phase 2 (meta-judging)**: each judge critiques other judges' outputs,
  yielding a reputation signal.
- Maintain a **versioned reputation ledger** and an **evaluator tied to each
  version** so improvements are measurable.
- Keep everything **local and fast**; make the storage layer swappable so we
  can host later without rewrites.

### Non-goals (for the hackathon)

- Production auth, multi-tenant security, billing.
- A polished web UI (a thin CLI / static report is enough).
- Perfect scraping coverage — a handful of well-distilled personas beats a
  large noisy corpus.
- Real-time / streaming evaluation.

---

## 3. Core concepts & glossary

| Term | Meaning |
|------|---------|
| **Persona** | A distilled human (a real judge or a "smart founder"), stored as a markdown file with structured frontmatter. The source of truth for a judge's taste. |
| **Judge** | A persona *manifested* as a runnable subagent (`agent.md`) that produces evaluations. |
| **Smart founder** | A reference persona scraped from public material; used to enrich the judge panel and as a calibration baseline. |
| **Idea** | A startup/hackathon-project submission to be evaluated. |
| **Evaluation** | One judge's scored, reasoned verdict on one idea (Phase 1). |
| **Meta-evaluation** | One judge's critique of another judge's evaluation (Phase 2). |
| **Reputation** | A score for a judge derived from meta-evaluations + (optionally) ground-truth agreement. |
| **Version** | An immutable snapshot of a persona/judge distillation. Reputations and evaluators are bound to a version. |
| **Evaluator** | The harness/rubric+scoring logic tied to a version that converts raw outputs into comparable scores. |

---

## 4. System architecture

```
                          ┌──────────────────────────┐
   public sources ──────▶ │  DISTILL (scrape → md)    │
   (talks, posts,         │  agents/distiller         │
    interviews, bios)     └────────────┬─────────────┘
                                        │ persona .md files (versioned)
                                        ▼
                          ┌──────────────────────────┐
   idea submissions ────▶ │  MANIFEST (persona→agent) │
                          │  agents/manifestor        │
                          └────────────┬─────────────┘
                                        │ judge subagents
              ┌─────────────────────────┼─────────────────────────┐
              ▼ (parallel)              ▼                          ▼
     ┌─────────────────┐      ┌─────────────────┐        ┌─────────────────┐
     │ Judge A eval    │      │ Judge B eval    │  ...   │ Judge N eval    │   PHASE 1
     └────────┬────────┘      └────────┬────────┘        └────────┬────────┘
              └─────────────────────────┼─────────────────────────┘
                                        ▼  evaluations[]
                          ┌──────────────────────────┐
                          │  PHASE 2: META-JUDGING    │
                          │  each judge critiques the │
                          │  others' evaluations      │
                          └────────────┬─────────────┘
                                        │ meta-evaluations[]
                                        ▼
                          ┌──────────────────────────┐
                          │  EVALUATOR (version-bound)│
                          │  aggregate → scores       │
                          └────────────┬─────────────┘
                                        ▼
                          ┌──────────────────────────┐
                          │  REPUTATION LEDGER        │  local SQLite now,
                          │  versioned, append-only   │  hosted Postgres later
                          └──────────────────────────┘
```

The pipeline is deliberately **two-phase and recursive**: Phase 1 produces
opinions about ideas; Phase 2 produces opinions about opinions. Reputation is
the fixed point we iterate toward.

---

## 5. Repository layout

```
judge-me-bro/
├── specs/
│   ├── root.md                  ← this file
│   ├── persona-schema.md        ← (sub-spec) frontmatter contract
│   ├── reputation.md            ← (sub-spec) scoring math
│   └── hosting.md               ← (sub-spec) deploy / upload API
├── agents/                      ← subagent definitions (agent.md files)
│   ├── distiller.md             ← turns scraped material → persona md
│   ├── manifestor.md            ← turns persona md → runnable judge
│   ├── idea-judge.md            ← Phase 1 evaluator (templated per persona)
│   ├── meta-judge.md            ← Phase 2 judge-of-judges
│   └── reputation-keeper.md     ← aggregates + writes ledger
├── skills/                      ← repo-specific skill files
│   ├── distill-persona/
│   ├── score-idea/
│   ├── critique-evaluation/
│   └── update-reputation/
├── personas/                    ← distilled humans (source of truth)
│   ├── judges/                  ← the 3 hackathon judges
│   │   └── <slug>@<version>.md
│   └── founders/                ← smart-founder reference set
│       └── <slug>@<version>.md
├── ideas/                       ← submissions to evaluate (md or json)
├── runs/                        ← outputs per run (immutable)
│   └── <run-id>/
│       ├── evaluations/         ← Phase 1
│       ├── meta/                ← Phase 2
│       └── report.md
├── data/
│   └── jmb.sqlite               ← reputation ledger (gitignored)
├── store/                       ← storage abstraction (local ↔ hosted)
└── cli/                         ← thin entrypoints (distill / run / report)
```

---

## 6. Data model & schemas

Everything is markdown-with-frontmatter on disk for human readability; the
ledger is the only relational piece.

### 6.1 Persona file (`personas/**/<slug>@<version>.md`)

```yaml
---
id: paul-graham            # stable slug
kind: founder              # founder | judge
version: 3                 # integer, bumped on re-distillation
source_urls:               # provenance for the distillation
  - https://...
distilled_at: 2026-06-01
distilled_by: distiller@v1 # which agent/skill produced this
# --- the actual "taste" ---
domains: [b2b, devtools, marketplaces]
values:                    # what they reward
  - "clear wedge into a real, frequent pain"
  - "founder/market fit over polish"
red_flags:                 # what they punish
  - "solution in search of a problem"
rubric_weights:            # how they trade off the shared rubric (sums ~1.0)
  problem: 0.30
  solution: 0.20
  market: 0.20
  team: 0.20
  traction: 0.10
voice: "terse, contrarian, asks the obvious question first"
calibration_notes: "tends to discount demos; rewards distribution insight"
---

## Background
<prose distilled from sources>

## How they evaluate
<heuristics, famous quotes, decision patterns>

## Worked examples
<known yes/no calls and why — used for few-shot calibration>
```

> Full field reference lives in `specs/persona-schema.md`. The frontmatter is
> the machine contract; the prose is few-shot fuel for the manifested judge.

### 6.2 Idea (`ideas/<idea-id>.md`)

```yaml
---
id: idea-014
title: "..."
one_liner: "..."
team: [...]
links: [demo, repo, deck]
---
<full pitch / problem / solution / market / ask>
```

### 6.3 Evaluation — Phase 1 (`runs/<run-id>/evaluations/<judge>@<ver>--<idea>.json`)

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

### 6.4 Meta-evaluation — Phase 2 (`runs/<run-id>/meta/<judgeA>--on--<judgeB>--<idea>.json`)

```json
{
  "run_id": "...",
  "rater_id": "jessica-livingston",
  "rater_version": 2,
  "target_judge_id": "paul-graham",
  "target_judge_version": 3,
  "idea_id": "idea-014",
  "dimensions": {
    "reasoning_quality": 8,    // is the rationale sound?
    "calibration": 6,          // does the score match the reasoning?
    "insight": 9,              // did they see something others missed?
    "bias": 3                  // lower = more biased (penalty)
  },
  "meta_score": 7.3,
  "notes": "strong wedge insight, but score too harsh on traction for stage"
}
```

### 6.5 Reputation ledger (SQLite, append-only)

```sql
-- a judge distillation snapshot
CREATE TABLE judge_version (
  judge_id      TEXT,
  version       INTEGER,
  kind          TEXT,           -- founder | judge
  persona_path  TEXT,
  created_at    TEXT,
  PRIMARY KEY (judge_id, version)
);

-- the evaluator/harness bound to a version
CREATE TABLE evaluator (
  evaluator_version TEXT PRIMARY KEY,  -- e.g. eval@v1
  rubric_json       TEXT,
  notes             TEXT,
  created_at        TEXT
);

-- one row per (judge_version, run) reputation snapshot
CREATE TABLE reputation (
  judge_id           TEXT,
  judge_version      INTEGER,
  evaluator_version  TEXT,
  run_id             TEXT,
  rep_score          REAL,          -- aggregate of meta_scores (+ ground truth)
  n_meta             INTEGER,       -- how many critiques fed it
  components_json    TEXT,          -- breakdown for debugging
  created_at         TEXT,
  FOREIGN KEY (judge_id, judge_version) REFERENCES judge_version(judge_id, version),
  FOREIGN KEY (evaluator_version) REFERENCES evaluator(evaluator_version)
);
```

The ledger is **append-only**: a new run never mutates old rows, so we can plot
a judge's reputation over versions and prove the system is improving.

---

## 7. The evaluation pipeline

### Phase 0 — Distill
For each target human, `distiller` (via the `distill-persona` skill) reads
scraped source material and emits a persona file at version *N*. Re-running
bumps the version; the old file is retained.

### Phase 1 — Idea evaluation (parallel)
The orchestrator manifests every active judge and **fans out**: every judge
scores every idea independently using the `score-idea` skill against the shared
rubric, weighted by the persona's `rubric_weights`. Output: one Evaluation per
(judge, idea). This is the heaviest step and is fully parallelizable across
subagents.

### Phase 2 — Meta-judging (judges judge judges)
Each judge is shown **other judges' Phase-1 evaluations** (their own hidden, to
avoid self-scoring) and critiques them via the `critique-evaluation` skill along
fixed dimensions (reasoning, calibration, insight, bias). Output: a
meta-evaluation matrix. This is also parallelizable; the only ordering
constraint is Phase 2 depends on Phase 1 completing.

### Phase 3 — Aggregate & ledger
The `reputation-keeper` (via `update-reputation`) runs the **version-bound
evaluator** to convert meta-evaluations into a single `rep_score` per judge
version, and appends to the ledger. See `specs/reputation.md` for the math;
v1 baseline:

```
rep_score(judge) = mean over meta-evals received of
                   (0.4·reasoning + 0.3·calibration + 0.3·insight) − 0.2·bias
                   [+ optional ground-truth agreement term when labels exist]
```

### Iteration loop
Inspect low-reputation judges → improve the distillation (better sources,
sharper rubric weights, more worked examples) → bump version → re-run →
confirm `rep_score` went up against the same evaluator. Changing the evaluator
forks a new `evaluator_version` so comparisons stay apples-to-apples.

---

## 8. Agents (subagents / `agent.md`)

We lean on subagents to parallelize and keep each role narrow.

| Agent | Role | Reads | Writes |
|-------|------|-------|--------|
| `distiller` | Turn scraped material into a persona file | source urls/text | `personas/**` |
| `manifestor` | Bind a persona into a runnable judge (inject voice + rubric + few-shots) | persona md | in-memory judge / templated `idea-judge` |
| `idea-judge` | Phase 1: score one idea as one persona | persona, idea | `runs/**/evaluations` |
| `meta-judge` | Phase 2: critique another judge's evaluation | evaluations | `runs/**/meta` |
| `reputation-keeper` | Phase 3: aggregate + write ledger | meta + evaluator | `data/jmb.sqlite`, `report.md` |
| `orchestrator` | Fan out Phase 1/2, enforce ordering, collect | everything | run manifest |

Parallelism model: the orchestrator spawns N `idea-judge` runs concurrently
(one per judge × idea batch), barriers on completion, then spawns the Phase-2
`meta-judge` matrix concurrently.

---

## 9. Skills (repo-specific)

Skills hold the *reusable how-to* so agents stay thin.

- **`distill-persona`** — scraping → schema-valid persona md (frontmatter
  validation + provenance capture).
- **`score-idea`** — apply shared rubric + persona weights, emit Evaluation
  JSON in the exact schema, enforce score ranges.
- **`critique-evaluation`** — produce a meta-evaluation along the 4 fixed
  dimensions, self-exclusion guard.
- **`update-reputation`** — run the version-bound evaluator, compute
  `rep_score`, append to ledger, regenerate `report.md`.

Each skill owns its output schema validation so bad rows never reach the ledger.

---

## 10. Storage & hosting

**MVP (now):** local-first. Personas + ideas + runs are files in the repo; the
reputation ledger is `data/jmb.sqlite`. Fast, inspectable, diffable, zero infra.

**Hosting path (designed-in, built later):** a `store/` abstraction with a
single interface (`put_persona`, `get_persona`, `list_judges`,
`append_reputation`, `query_reputation`). Local implementation backs onto
files+SQLite; hosted implementation backs onto object storage (persona md) +
Postgres (ledger). Because nothing else touches the disk directly, swapping is a
config change.

Hosting features (see `specs/hosting.md`):
- **Upload distilled judges** — POST a persona file; server validates schema,
  assigns/keeps version, stores it.
- **Shared reputation tracking** — multiple people contribute runs against the
  same judge versions and evaluator versions.
- Keep auth trivial for the hackathon (single shared token); design the
  interface so real auth slots in later.

---

## 11. Milestones (hackathon timeboxed)

1. **M0 — Schema lock (≈1h):** finalize persona frontmatter + Evaluation +
   meta schemas. Write 1 persona by hand to validate the shape.
2. **M1 — Distill (≈2h):** `distiller` + `distill-persona` produce the 3
   judges + ~5 smart founders.
3. **M2 — Phase 1 (≈2h):** `idea-judge` + parallel orchestration; score a real
   idea set end-to-end into `runs/`.
4. **M3 — Phase 2 + ledger (≈2h):** `meta-judge` matrix + `reputation-keeper`
   writing SQLite; produce first `report.md`.
5. **M4 — Iterate (≈1h):** improve one weak judge, bump version, show
   `rep_score` improved against the same evaluator. **This is the demo.**
6. **M5 — Stretch:** `store/` hosted impl + upload endpoint.

---

## 12. Demo narrative

"Here are three AI judges distilled from the real hackathon panel, plus a few
legendary founders. They scored every idea in parallel. Then they judged each
other. Here's the reputation leaderboard — and watch: we improved Judge X's
distillation, re-ran, and its reputation score went *up* against the exact same
evaluator. The panel measurably got better."

---

## 13. Open questions / risks

- **Scraping quality & rights:** use public talks/posts; capture `source_urls`
  for provenance; a few high-signal sources beat broad scraping.
- **Self-reference & collusion:** Phase 2 hides a judge's own work; consider
  also hiding *identities* of the judge being rated to reduce halo bias.
- **Ground truth:** without real outcomes, reputation is peer-relative. Add an
  optional labeled set (known winning ideas) to anchor it if time allows.
- **Cost/latency of full N×M×ideas fan-out:** batch ideas, cap panel size for
  the demo, rely on parallel subagents.
- **Evaluator drift:** any change to scoring math = new `evaluator_version`,
  never an in-place edit, or version-over-version comparisons become invalid.

---

## 14. Decisions taken in this draft (defaults; revisit freely)

- Storage: **local files (md) + SQLite**, behind a `store/` interface that is
  hosting-ready.
- Stack: orchestration is **agent.md + repo skills first**, with thin CLI glue;
  add a real SDK/runtime only where parallel fan-out needs it.
- Reputation is **peer-relative** for MVP, with an optional ground-truth term.
- Everything **versioned and append-only**.

> These were chosen to keep the hackathon fast. Flag any you want changed and
> the dependent sections (schemas, ledger, milestones) update accordingly.
