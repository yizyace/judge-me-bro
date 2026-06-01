# Valiron Reputation Layer — Sub-Spec

> Make the judges' reputation **real and verifiable**: judges are ERC-8004 agents
> on Solana, Phase-2 meta-evaluations are written on-chain as feedback, and
> **Valiron** (sponsor API) reads that on-chain reputation and gates which judges
> are trusted enough to sit on the panel.

- **Status:** Draft — approved direction (on-chain Solana, "thin" scope), ready to implement
- **Owner:** Ace
- **Last updated:** 2026-06-01
- **Parent spec:** [`root.md`](./root.md) — read it first for the full app.
- **Related sub-specs:** [`reputation.md`](./reputation.md) (the scoring math this
  feeds), [`hosting.md`](./hosting.md) (the `store/` seam this plugs into).
- **Sponsor:** Valiron — <https://www.valiron.co/docs> · `@valiron/sdk` v1.0.2

---

## 0. Context for a cold-start implementer

*Judge Me Bro* distills hackathon judges + "smart founders" into persona files,
manifests each as a Claude subagent, and runs a two-phase pipeline: **Phase 1**
judges score ideas; **Phase 2** judges critique each other's evaluations,
producing a **judge-to-judge reputation**. Today that reputation is a number in
local SQLite. This spec moves the *peer reputation* on-chain and uses Valiron as
the trust layer over it.

A judge is an AI agent. **Valiron is a trust/reputation system for AI agents**
built on the **ERC-8004** reputation registry. So: register each judge as an
ERC-8004 agent on Solana, write judge↔judge feedback to that registry, and let
Valiron aggregate + gate it.

---

## 1. One-paragraph pitch

Each of ~3 demo judges is registered as an **ERC-8004 agent on Solana devnet**
(a Metaplex Core asset). Each Phase-2 meta-evaluation is written **on-chain** as
a feedback entry (score 0–100) about the target judge. The leaderboard is read
straight from Valiron via `getAgentProfile(id, { chain: "solana" })` →
`onchainReputation.averageScore`, and the orchestrator calls `checkAgent()` /
`gate()` to **admit and weight the panel** by Valiron's trust tier. The demo
punchline: re-distill a weak judge, the other judges' on-chain feedback moves its
`averageScore`, Valiron re-tiers it — and every feedback entry is verifiable by
transaction hash on a Solana explorer. The reputation is no longer a number we
report about ourselves; it's on a public registry that Valiron independently reads.

---

## 2. Decisions locked (verified against the SDK — do not relitigate without flagging)

| Decision | Choice | Why / evidence |
|---|---|---|
| **Direction** | Valiron is the **reputation layer** | Same shape as the app's core |
| **Web3 depth** | **On-chain, Solana devnet**, ERC-8004 | The peer-feedback write *requires* on-chain — see §3.1 |
| **Scope** | **"Thin"** — ~3 judges, one shared funded "rater" keypair | Bounds keypair/funding surface for the timebox |
| **Who writes feedback** | **We do**, directly to the ERC-8004 Solana program | `@valiron/sdk` has **no** feedback-write (verified, §3.1) |
| **Who reads/gates** | **Valiron**, via `@valiron/sdk` (no API key for reads) | `getAgentProfile` / `checkAgent` / `gate` are read-only |
| **Integration seam** | The existing `store/` interface (`root.md` §10) | `append_reputation` (write) / `query_reputation` (read) |

**Explicitly out of scope:** EVM/Ethereum, World ID / Icebreaker attestation,
x402/MPP payments, mainnet, per-judge owner wallets (that's "Full Solana", §11).

---

## 3. The division of labor (read this before designing anything)

This is the single most important thing to get right. After reading the shipped
type definitions and `docs/API-REFERENCE.md`, the truth is:

| Step | Who | How |
|---|---|---|
| Register a judge as an agent | **us** | ERC-8004 Solana program (Metaplex Core asset pubkey) via QuantuLabs `8004-solana` + `@solana/web3.js` |
| Write judge→judge feedback (0–100) | **us** | Directly to the ERC-8004 feedback program, from a funded devnet keypair |
| **Read** aggregated reputation | **Valiron** | `getAgentProfile(id,{chain:"solana"})` → `onchainReputation.averageScore` + `feedbackEntries[]` |
| **Gate / weight** the panel | **Valiron** | `checkAgent(id)` / `gate(id,{trustSignals,minScore})` |

### 3.1 Why we write it ourselves (the corrected assumption)
`@valiron/sdk` v1.0.2 is a **read/eval HTTP client only** (`ValironClient`,
"not blockchain-specific"). It exposes **no** `submitFeedback`/`review`/`rate`.
The `giveFeedback()` mentioned in the docs is **Valiron's own automatic
write-back of its behavioral score** (server-side, via `SOLANA_FEEDBACK_KEYPAIR`),
**not** a hook for our peer scores. Therefore our meta-eval scores must be written
to the ERC-8004 registry **directly**, and Valiron then reads them. Do not look
for a Valiron feedback-write method — there isn't one.

### 3.2 Why this is still a strong Valiron integration
Valiron's whole model is reading ERC-8004 reputation and turning it into a trust
decision. Per `docs/TRUST-MODEL.md`, the blended trust score weights **on-chain
reputation ~25%** and **behavioral sandbox ~55%** (human attestations lower),
normalized to 0–100 → Moody's-style tiers → routing (`AAA–A`→`prod`, … `CAA–C`→
`sandbox_only`). So Valiron genuinely consumes our judge↔judge reputation to
admit/weight the panel. (Tunable: `gate({ trustSignals: ["8004","sandbox"],
minScore })`.)

---

## 4. Architecture & integration surface

Everything hangs off the `store/` abstraction (`root.md` §10:
`append_reputation` / `query_reputation`). **Write** and **read** land in two
small modules so neither side is tangled.

```
        Phase 2 meta-evals                         Phase 1 vote tally
               │                                          │
               ▼ store.append_reputation(target, 0..100)  ▼ checkAgent / gate
        ┌─────────────────────┐                    ┌─────────────────────┐
        │  store/solana-rep.*  │  WRITE             │   store/valiron.*    │  READ
        │  ERC-8004 feedback   │                    │  getAgentProfile /   │
        │  via @solana/web3.js │                    │  checkAgent / gate   │
        └──────────┬───────────┘                    └──────────┬──────────┘
                   │ funded rater keypair                      │ @valiron/sdk (no key)
                   ▼                                           ▼
        Solana devnet — ERC-8004 reputation registry  ◀────  Valiron reads it back
```

### Files to add / touch

| Path | Change | Notes |
|---|---|---|
| `store/solana-rep.*` | **new** | WRITE side. `append_reputation(targetAgentId, score, rater)` → submit ERC-8004 feedback on Solana. Holds the rater keypair (loaded from gitignored store). |
| `store/valiron.*` | **new** | READ side. `query_reputation(agentId)` → `getAgentProfile`/`checkAgent`/`gate` via `@valiron/sdk`. |
| `store/solana-identity.*` | **new** | Register a judge agent → returns `solana_agent_id`; manage owner/registrar + rater keypairs. |
| `cli/register-judges.*` | **new** | One-time/idempotent: register each active judge on devnet, fund the rater keypair (faucet), write `solana_agent_id` back to frontmatter. |
| `personas/**/*.md` frontmatter | **+1 field** | `solana_agent_id` (Metaplex Core asset pubkey, stable per `@version`). |
| `specs/persona-schema.md` | **+1 field doc** | Document `solana_agent_id`. |
| `agents/orchestrator` (Phase-1 tally) | **+1 hook** | `checkAgent(judgeId)` → weight each judge's vote (§6 table). |
| `agents/reputation-keeper.md` | **swap calls** | Phase-2 → `store.append_reputation`; Phase-3 reads `store.query_reputation`. |
| `package.json` | **+deps** | `@valiron/sdk`, `@solana/web3.js`, ERC-8004 Solana program client (QuantuLabs `8004-solana` or equivalent). |
| `data/.solana/` (gitignored) | **new** | Keypairs (rater, registrar) + agentId map. |
| `.gitignore` / `.git/info/exclude` | **+1 line** | Ensure `data/.solana/` is never tracked. |

### Config / env
`chain: "solana"`, `SOLANA_CLUSTER=devnet`, `SOLANA_RPC_URL=<devnet rpc>`,
`VALIRON_KEYSTORE_DIR` (override for hosting). The rater keypair path lives under
`data/.solana/` by default.

---

## 5. Data model changes

### 5.1 Persona frontmatter — one new field
```yaml
# personas/judges/<slug>@<version>.md  (frontmatter)
solana_agent_id: "<base58 Metaplex Core asset pubkey>"   # assigned at register time, stable per version
```
Identity is bound to `<slug>@<version>` so **re-distilling bumps the version → a
new agent → fresh on-chain reputation**, which is what makes "did the new version
judge better?" an honest, verifiable comparison (and is the demo's spine).

### 5.2 Key material (security — do not get this wrong)
- Solana keypairs are secrets. Store under **gitignored** `data/.solana/`. Never
  write a private key into a persona file or anything tracked. (`git status` must
  stay clean.)
- Frontmatter holds only the **public** `solana_agent_id`.
- `VALIRON_KEYSTORE_DIR` env override lets hosting inject keys from a secret
  manager later without code changes.

---

## 6. Pipeline integration

### Phase 1 — gate + weight the panel
Before a judge's evaluations are tallied, call `checkAgent(judgeId)` (or
`gate(judgeId, { minScore, trustSignals: ["8004","sandbox"] })`) and weight:

| `checkAgent` / `gate.route` | Vote weight | Meaning |
|---|---|---|
| `prod` | **1.0** | Fully trusted |
| `prod_throttled` | **0.7** | Trusted, partial |
| `sandbox` | **0.3** | Provisional (shadow) |
| `sandbox_only` | **0.0** | Shown, excluded from tally |

> Starting weights — tune live. Keep them in one `evaluator_version`-bound
> constant (`root.md` §6.5) so a change forks a new evaluator and version
> comparisons stay apples-to-apples.

### Phase 2 — meta-evals become on-chain feedback
The existing per-meta-eval score (`root.md` §7):
```
rep_score = 0.4·reasoning + 0.3·calibration + 0.3·insight − 0.2·bias
```
is scaled/clamped to a **0–100 integer** and written as **one ERC-8004
FeedbackEntry** about the target judge's `solana_agent_id`. Self-exclusion still
applies (a judge never rates itself; ERC-8004 also blocks self-feedback). In thin
scope, all entries are signed by the **one shared rater keypair**, so encode the
rating judge's id in `tag1`/`tag2` for traceability (see §11 for the per-rater
upgrade).

### Phase 3 — leaderboard from Valiron
`reputation-keeper` reads `getAgentProfile(judgeId, { chain: "solana" })`:
- **Leaderboard number** = `onchainReputation.averageScore` (the pure peer
  reputation we wrote — the cleanest reflection of judge↔judge quality).
- **Admission/tier** = `checkAgent` / `gate` route + tier (Valiron's blended
  trust). Show both in `report.md`; link each feedback entry's `transactionHash`
  to a Solana explorer for the "it's real" moment.

---

## 7. Valiron / Solana reference (verified vs. to-confirm)

### 7.1 Confirmed (shipped type defs + docs)
```ts
import { ValironSDK } from "@valiron/sdk";
const valiron = new ValironSDK({ chain: "solana" });   // no API key for reads
// env: SOLANA_CLUSTER=devnet, SOLANA_RPC_URL=<devnet>

await valiron.getAgentProfile(agentId, { chain: "solana" });
//  → AgentProfile { onchainReputation: { count, averageScore, feedbackEntries[], totalFeedback },
//                   localReputation, routing, chain, ... }
await valiron.checkAgent(agentId);   // → "prod" | "prod_throttled" | "sandbox" | "sandbox_only"
await valiron.gate(agentId, { minScore: 65, trustSignals: ["8004","sandbox"] });
//  → { allow, score, tier, riskLevel, route, agentId, wallet, chain, sandboxRan, cached }
```
- `FeedbackEntry { from, score, tag1, tag2, uri?, hash?, transactionHash?, feedbackIndex?, isRevoked? }`
- Solana agent IDs are **base-58 Metaplex Core asset pubkeys** (not numeric).
- Trust model weights/tiers as in §3.2.

### 7.2 MUST be confirmed in M0 (de-risk first)
1. **🔴 Does Valiron's read API index Solana _devnet_ ERC-8004?** If the hosted
   `/operator/agent/:id?chain=solana` only reads `mainnet-beta`, devnet feedback
   won't appear in `getAgentProfile`. **This gates the whole approach.** Fallbacks
   if devnet is unindexed: (a) self-host/point the Valiron operator at devnet if
   supported; (b) read `onchainReputation` directly from the registry for the
   leaderboard and use Valiron only where it works; (c) budget a tiny amount of
   mainnet SOL. Decide before building.
2. The exact ERC-8004 Solana **register-agent** and **submit-feedback**
   instructions (QuantuLabs `8004-solana`): args (`to`, `score`, `tag1`, `tag2`),
   signer, and returned agent id / tx hash.
3. Whether `getAgentProfile` needs the agent to have made a gated request before a
   profile exists on Solana.
4. Devnet **faucet** + RPC for funding the rater keypair.

> **Honesty rule:** do not build on §7.2 as if confirmed. If M0 #1 fails, switch
> to a documented fallback rather than faking the read.

---

## 8. Milestones (de-risk the unknown first)

1. **M0 — Spike (≈1h, BLOCKING):** install `@valiron/sdk` + `@solana/web3.js` +
   `8004-solana`; on devnet, register one agent, write one feedback entry, then
   `getAgentProfile(id,{chain:"solana"})` and confirm `averageScore`/
   `feedbackEntries` reflect it. **Resolve §7.2 #1 here.** Decide go / fallback.
2. **M1 — Identity + register (≈1.5h):** `store/solana-identity.*` +
   `cli/register-judges`; register 3 judges, fund rater, write `solana_agent_id`
   to frontmatter + `persona-schema.md`. Keep `data/.solana/` gitignored.
3. **M2 — Store impls (≈2h):** `store/solana-rep.*` (`append_reputation` →
   ERC-8004 feedback) + `store/valiron.*` (`query_reputation` → profile/gate).
4. **M3 — Pipeline wiring (≈1h):** Phase-2 → `append_reputation`; Phase-1
   weighting via `checkAgent`; `reputation-keeper` builds the leaderboard from
   `averageScore` + tier.
5. **M4 — The demo (≈45m):** run a panel, improve one judge, bump version,
   re-run; show the new agent's on-chain `averageScore` move + Valiron re-tier,
   with feedback tx hashes on a Solana explorer.

---

## 9. Acceptance criteria
- [ ] 3 judges registered as ERC-8004 Solana (devnet) agents; `solana_agent_id`
      in frontmatter; **keypairs untracked** (`git status` clean; keys under
      gitignored `data/.solana/`).
- [ ] Each Phase-2 meta-eval appears as an on-chain `FeedbackEntry` (verifiable
      by `transactionHash`).
- [ ] `getAgentProfile(...,{chain:"solana"})` returns `onchainReputation.
      averageScore` reflecting those entries; leaderboard sourced from it.
- [ ] Phase-1 tally weights votes by `checkAgent`/`gate` per §6.
- [ ] No module imports Valiron or Solana libs except the three `store/*` files
      (the seam stays swappable).
- [ ] **Demo:** a re-distilled judge measurably changes its on-chain
      `averageScore` (and ideally Valiron tier) across a version bump, against a
      fixed `evaluator_version`.

---

## 10. Open questions / risks
- **🔴 Valiron devnet indexing (M0 #1)** — the make-or-break unknown.
- **On-chain rep is only ~25% of the blended tier** (sandbox ~55%) → render the
  leaderboard from `averageScore` directly, and/or `gate({trustSignals:["8004"]})`
  so peer feedback visibly moves the gate.
- **Thin scope uses one shared rater key** → `from` attribution collapses; encode
  the rater in `tag1/tag2`. (Full Solana, §11, restores real per-rater `from`.)
- **Devnet RPC flakiness / rate limits** → pre-warm agents, cache reads, batch
  writes; have the SQLite mirror as a narrated backup if the network stalls.
- **Third-party `8004-solana` maturity** → pin the version; confirm its API in M0.
- **Cost/latency** of N registrations + N×M feedback writes on devnet → keep N=3,
  batch ideas.

---

## 11. Upgrade path (post-hackathon) — "Full Solana"
Give each judge its **own** owner + rater keypair so every feedback entry's `from`
is the actual rating judge (true peer attribution), add EVM/ERC-8004 parity behind
the same `store/` seam, and move to mainnet with a funded treasury. None of this
changes the interface — only the identity/keypair management in `store/solana-*`.

---

## 12. References
- Valiron docs — <https://www.valiron.co/docs> (`CHAINS.md`, `TRUST-MODEL.md`,
  `API-REFERENCE.md`, `SDK-REFERENCE.md` ship inside the npm package under `docs/`)
- `@valiron/sdk` README mirror — <https://unpkg.com/@valiron/sdk/README.md>
- ERC-8004 on Solana — QuantuLabs `8004-solana` (Metaplex Core assets)
- `@solana/web3.js` — Solana client for registration + feedback writes
- Parent: [`root.md`](./root.md) · math: [`reputation.md`](./reputation.md) ·
  seam: [`hosting.md`](./hosting.md)
