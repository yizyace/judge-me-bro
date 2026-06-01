# Valiron Reputation Layer — Sub-Spec

> Use **Valiron** (sponsor API) as the real, portable reputation/trust layer for
> the AI judges, replacing the self-reported local rep_score with an external
> trust profile that judges earn from each other.

- **Status:** Draft — approved direction, ready to implement
- **Owner:** Ace
- **Last updated:** 2026-06-01
- **Parent spec:** [`root.md`](./root.md) — read it first for the full app.
- **Related sub-specs:** [`reputation.md`](./reputation.md) (scoring math this
  feeds), [`hosting.md`](./hosting.md) (the `store/` seam this plugs into).
- **Sponsor:** Valiron — <https://www.valiron.co/docs> · `@valiron/sdk`

---

## 0. Context for a cold-start implementer

*Judge Me Bro* distills real hackathon judges + "smart founders" into persona
files, manifests each as a Claude subagent, and runs a two-phase pipeline:
**Phase 1** judges score ideas in parallel; **Phase 2** judges critique each
other's evaluations, producing a **judge-to-judge reputation**. Today that
reputation is a number computed and stored in local SQLite (`data/jmb.sqlite`).

**This spec swaps the home of that reputation.** A judge is an AI agent.
**Valiron is a reputation & trust system for AI agents.** So the judges' rep
ledger becomes a Valiron trust profile: judges earn reputation from each other's
meta-evaluations, and Valiron decides who is trusted enough to sit on the panel.

---

## 1. One-paragraph pitch

Each distilled judge registers as a **key-based Valiron agent** (Web2, EIP-191
challenge-response — no wallet, no chain). Phase-2 meta-evaluations are submitted
as **Valiron reputation feedback** about the target judge. The leaderboard is
read straight from Valiron via `getAgentProfile()`, and the orchestrator calls
`checkAgent()` to **gate the panel** — a judge's votes only count at full weight
once Valiron trusts it (`prod`), and are discounted while it is still in
`sandbox`. The demo punchline: re-distill a weak judge, it re-enters Valiron's
sandbox as a fresh agent, earns peer reputation, and Valiron **promotes it to
`prod`** — measurable improvement on a leaderboard we don't own.

---

## 2. Decisions locked (do not relitigate without flagging)

| Decision | Choice | Why |
|---|---|---|
| **Direction** | Valiron is the **reputation layer** (not a payment/access gate, not persona provenance) | Same shape as the app's core; minimal surface |
| **Web3 depth** | **Web2 key-based agents only** (EIP-191) | "Killer but simple" — no wallets/testnet during a timebox; stays close to local-first |
| **Integration seam** | The existing `store/` interface (`root.md` §10) | `append_reputation` / `query_reputation` already abstract this; ~1 new impl |
| **Source of truth** | Valiron, with **SQLite as optional local cache** | Keeps the rest of the pipeline untouched; offline-debuggable |

**Explicitly out of scope** (deferred; these are the directions *not* chosen):
on-chain/ERC-8004 wallets, x402/MPP payments, World ID / Icebreaker
human-ownership attestation, multi-tenant auth.

---

## 3. The core mechanic — three mappings

| judge-me-bro concept | becomes, in Valiron |
|---|---|
| A judge casting Phase-1 evaluations | A key-based agent making *gated requests* → auto-sandboxed on first use, behaviorally scored |
| Phase-2 meta-evaluation (judge A rates judge B) | A **reputation feedback** entry submitted about agent B |
| The reputation leaderboard | `getAgentProfile(judgeId)` — combined peer + behavioral trust |
| "Is this judge trusted enough to count?" | `checkAgent(judgeId)` → `prod` / `prod_throttled` / `sandbox` / `sandbox_only` |

**The demo moment (this is the M4 deliverable in `root.md` §11, upgraded):**
A freshly re-distilled `judge-x@v2` registers as a *new* key-based agent → starts
in Valiron **sandbox** → the other judges' Phase-2 meta-evaluations submit peer
reputation about it → Valiron **promotes it to `prod`** → it climbs a trust
leaderboard that lives outside our repo. "We improved a judge and its reputation
went up" stops being a self-reported SQLite number and becomes externally
verifiable trust.

---

## 4. Architecture & integration surface

The whole point of this design is that Valiron lands at **one seam** the app
already has. `root.md` §10 defines a `store/` abstraction
(`put_persona`, `get_persona`, `list_judges`, `append_reputation`,
`query_reputation`). Everything below hangs off that.

```
                 Phase 2 meta-evals          Phase 1 vote tally
                        │                            │
                        ▼                            ▼
   store.append_reputation(judge, rep_score)   checkAgent(judgeId)  ← gate/weight
                        │                            │
                        ▼                            ▼
            ┌───────────────────────────────────────────────┐
            │              store/valiron.*                    │
            │  append_reputation → submit Valiron feedback    │
            │  query_reputation  → getAgentProfile/checkAgent │
            └───────────────────────┬───────────────────────┘
                                    │  @valiron/sdk
                                    ▼
                          Valiron trust registry
                       (key-based agents, ERC-8004)
```

### Files to add / touch

| Path | Change | Notes |
|---|---|---|
| `store/valiron.*` | **new** | Implements the `store/` interface against Valiron. `append_reputation` → submit feedback; `query_reputation` → `getAgentProfile` + `checkAgent`. Optionally write-through to SQLite cache. |
| `store/valiron-client.*` | **new** | Thin wrapper: construct `new ValironSDK({...})`, hold config, manage per-judge agent identities + signing. |
| `store/identity.*` | **new** | Generate/load a key-based agent identity per `<slug>@<version>`; sign EIP-191 challenges. Private keys **never** committed (see §5). |
| `cli/register-judges.*` | **new** | One-time/idempotent: ensure every active judge has a Valiron identity + is known to Valiron. |
| `personas/**/*.md` frontmatter | **+1 field** | `valiron_agent_id` (stable per version). See §5. |
| `specs/persona-schema.md` | **+1 field doc** | Document `valiron_agent_id`. |
| `agents/orchestrator` (Phase-1 tally) | **+1 hook** | `checkAgent(judgeId)` → weight each judge's vote (table in §6). |
| `agents/reputation-keeper.md` | **swap call** | Phase-3 writes via `store.append_reputation` (now Valiron-backed) instead of direct SQLite. |
| `data/.valiron/` (gitignored) | **new** | Local home for key material + agentId map. |

Nothing else in the pipeline changes: **~3 small modules + 1 CLI command + 1
orchestrator hook + 1 frontmatter field.**

---

## 5. Data model changes

### 5.1 Persona frontmatter — one new field

```yaml
# personas/judges/<slug>@<version>.md  (frontmatter)
valiron_agent_id: "vln_agent_<...>"   # stable per (slug, version); assigned at register time
```

A judge's identity is bound to `<slug>@<version>` so that **re-distilling bumps
the version → a brand-new agent → re-enters Valiron's sandbox**. That fresh-start
is what makes the "did the new version actually judge better?" comparison honest
(and is the demo's spine).

### 5.2 Key material (security — do not get this wrong)

Key-based agents authenticate by signing an EIP-191 challenge with a private key.

- **Private keys are secrets.** Store under `data/.valiron/` which **must** be
  gitignored. Never write a private key into a persona file or anything tracked.
- Frontmatter holds only the **public** `valiron_agent_id` (and optionally the
  public key/address). The signer in `store/identity.*` loads the private key
  from the gitignored store at run time.
- Provide an env override (`VALIRON_KEYSTORE_DIR`) so hosting can inject keys
  from a secret manager later without code changes.

---

## 6. Pipeline integration

### Phase 1 — gate + weight the panel
Before a judge's evaluations are tallied, the orchestrator calls
`checkAgent(judgeId)` and weights that judge's contribution:

| `checkAgent` result | Vote weight | Meaning |
|---|---|---|
| `prod` | **1.0** | Fully trusted judge |
| `prod_throttled` | **0.7** | Trusted but rate-limited / partial |
| `sandbox` | **0.3** | Provisional — counted but discounted (shadow) |
| `sandbox_only` | **0.0** | Shown in report, excluded from the tally |

> Weights are a **starting proposal**, not gospel — tune during the demo. Keep
> them in one config constant (`evaluator_version`-bound per `root.md` §6.5 so a
> change forks a new evaluator and comparisons stay apples-to-apples).

### Phase 2 — meta-evals become reputation feedback
Each meta-evaluation already yields a `rep_score` via the existing math
(`root.md` §7, Phase 3 baseline):

```
rep_score = 0.4·reasoning + 0.3·calibration + 0.3·insight − 0.2·bias
```

Submit that value as **one Valiron reputation-feedback entry** about the target
judge's `valiron_agent_id` (rater = the rating judge's agent id). The
self-exclusion guard from `critique-evaluation` still applies (a judge never
rates itself).

### Phase 3 — leaderboard from Valiron
`reputation-keeper` reads each judge's `getAgentProfile(judgeId)` to build
`report.md`'s leaderboard. The append-only guarantee from `root.md` §6.5 is
preserved — feedback entries accrete; Valiron *is* the append-only ledger. Keep
the SQLite mirror if useful for offline diffing.

---

## 7. Valiron SDK reference

### 7.1 Confirmed (from the published README)

```ts
import { ValironSDK } from "@valiron/sdk";
const valiron = new ValironSDK({ chain: "ethereum" }); // no API key needed for reads

await valiron.checkAgent(agentId); // → "prod" | "prod_throttled" | "sandbox" | "sandbox_only"
await valiron.gate(agentId);       // → { allow: boolean }  (runs sandbox tests if needed)
```

- **Key-based (Web2) agents:** supported via **EIP-191 challenge-response**,
  *auto-detected and auto-sandboxed* on first gated request. This is the path
  this spec uses.
- `getAgentProfile(agentId)` and `resolveWallet(...)` exist; full signatures live
  in the fuller "SDK Reference" (`resolveWallet` is on-chain only — not needed
  here).
- Middleware helpers exist (`createValironGate({ sdk })` for Express/Fastify/
  Next.js) — optional, see §8.

### 7.2 MUST be confirmed before building (de-risk first — see M0)

1. **Feedback-write path for key-based agents.** The exact call to submit a
   reputation/feedback entry about an agent (the ERC-8004 "feedback registry"
   write). The README does not show it; confirm method name, args, auth, and
   whether it is available to key-based (non-wallet) agents.
2. **`getAgentProfile` return shape** — which numeric fields represent peer
   reputation vs. behavioral score, so the leaderboard reads the right number.
3. **Identity/registration flow** — how a key-based `valiron_agent_id` is created
   and how the EIP-191 challenge-response is performed via the SDK.
4. **Whether a profile exists before any gated request** — `checkAgent` on a
   never-seen agent may need a first `gate()` call to trigger sandboxing.

> **Honesty rule:** do not build on §7.2 assumptions as if confirmed. If a check
> fails, fall back (§8) rather than faking the call.

---

## 8. Scope: core, cherry, fallback

- **Core (the demo):** register judges as key-based agents → submit Phase-2
  meta-evals as Valiron feedback → leaderboard from `getAgentProfile` → gate +
  weight Phase-1 votes via `checkAgent`. Sandbox→prod promotion is the story.
- **Cherry (only if cheap):** route a judge's evaluation submission through a
  local `createValironGate`-protected endpoint so the *act of judging* is itself
  a gated request that accrues behavioral signal. Skip if it adds a server you
  don't otherwise need — `gate()`/`checkAgent()` called directly from the
  orchestrator is enough.
- **Fallback (if §7.2.1 feedback-write is unavailable for key-based agents):**
  keep SQLite as source of truth for `rep_score`; use Valiron as the **gate**
  (`checkAgent`/`gate`) + verifiable **identity** + behavioral layer, mirroring
  scores where the API allows. Still a meaningful, demoable Valiron integration —
  just less "Valiron IS the ledger."

---

## 9. Milestones (de-risk the unknown first)

1. **M0 — SDK spike (≈45m, BLOCKING):** install `@valiron/sdk`; create one
   key-based agent; resolve every item in §7.2 with a throwaway script. Decide
   core-vs-fallback (§8) based on what the feedback-write supports. **Everything
   else depends on this.**
2. **M1 — Identity + register (≈1h):** `store/identity.*` (keygen + EIP-191
   signing, gitignored keystore) + `cli/register-judges`; add `valiron_agent_id`
   to persona frontmatter + `persona-schema.md`.
3. **M2 — Store impl (≈1.5h):** `store/valiron-client.*` + `store/valiron.*`
   implementing `append_reputation` (feedback submit) and `query_reputation`
   (`getAgentProfile`/`checkAgent`), with optional SQLite write-through.
4. **M3 — Pipeline wiring (≈1h):** Phase-2 → `append_reputation`; Phase-1 vote
   weighting via `checkAgent` (§6 table); `reputation-keeper` reads the Valiron
   leaderboard into `report.md`.
5. **M4 — The demo (≈30m):** run a panel, improve one judge, bump version,
   re-run, show the new version promoted in Valiron and the leaderboard moving.

---

## 10. Acceptance criteria

- [ ] Each active judge has a stable `valiron_agent_id`; private keys are **not**
      tracked by git (`git status` clean; key material under gitignored
      `data/.valiron/`).
- [ ] `store/valiron.*` satisfies the same `store/` interface as the local impl;
      swapping is a config change (no other module imports Valiron directly).
- [ ] Phase-2 meta-evaluations result in reputation visible via
      `getAgentProfile` (core) **or**, in fallback mode, a documented reason and
      working gate-only integration.
- [ ] Phase-1 tally weights votes by `checkAgent` result per §6.
- [ ] `report.md` leaderboard is sourced from Valiron.
- [ ] **Demo:** a re-distilled judge measurably changes Valiron trust state
      (sandbox→prod and/or rising reputation) across a version bump, against a
      fixed `evaluator_version`.

---

## 11. Open questions / risks

- **Behavioral signal may be thin** for abstract judge agents that don't serve a
  real API → peer feedback (Phase 2) is what actually moves reputation. This is
  fine (and on-theme), but it makes §7.2.1 the linchpin — confirm it in M0.
- **`chain` config for key-based agents:** README inits with `chain: "ethereum"`;
  confirm the right value/options for the Web2 key-based path during M0.
- **Rate limits / latency** on N judges × M feedback writes during a live demo —
  cap panel size, batch writes, and pre-warm agents before presenting.
- **Determinism for the demo:** Valiron promotion timing may vary; rehearse and
  have the SQLite mirror as a narrated backup if the network is flaky.

---

## 12. References

- Valiron docs — <https://www.valiron.co/docs>
- Valiron home — <https://www.valiron.co/>
- SDK — `@valiron/sdk` (npm); README mirror:
  <https://unpkg.com/@valiron/sdk/README.md>
- Parent: [`root.md`](./root.md) · math: [`reputation.md`](./reputation.md) ·
  seam: [`hosting.md`](./hosting.md)
