# Valiron Setup — Credentials & SDK Runbook

> How to wire up Valiron **credentials** so the reputation-layer feature
> ([`valiron-reputation-layer.md`](./valiron-reputation-layer.md)) can be built and
> run. Written so a future agent can **just follow it** during the hackathon —
> captures the auth research so it does not have to be rediscovered.

- **Status:** Reference runbook (setup only — the feature design lives in
  [`valiron-reputation-layer.md`](./valiron-reputation-layer.md))
- **Last updated:** 2026-06-01
- **Companion:** [`root.md`](./root.md) (the app) · skill context:
  [`.claude/skills/valiron/SKILL.md`](../.claude/skills/valiron/SKILL.md)
- **Sources:** <https://www.valiron.co/docs> · <https://valiron.co/auth.md> ·
  `@valiron/sdk` (`SDK-REFERENCE.md`)

---

> ⚠️ **Solana pivot (2026-06-01).** The reputation-layer feature was verified
> against the shipped `@valiron/sdk` v1.0.2 and is now **on-chain Solana
> (ERC-8004)**, not Web2 key-based — see
> [`valiron-reputation-layer.md`](./valiron-reputation-layer.md). The **operator
> key** (§2) and **secret hygiene** (§4) still apply as-is; the **agent-identity**
> guidance in §1 (row 2) and §3, and the **M0 checks** in §5, are **superseded** by
> the new **§7. Solana on-chain addendum** below.

---

## TL;DR — the "just set it up" path

1. Get an **operator API key** from the Valiron dashboard
   (<https://www.valiron.co/dashboard>). Operator keys carry a **`val_op_` prefix**.
2. Create a local **`.env`** (gitignored) at the repo root:
   ```dotenv
   VALIRON_API_KEY=val_op_xxxxxxxxxxxxxxxx
   ```
3. Install the SDK: `npm install @valiron/sdk`
4. Construct it with the key from the environment:
   ```ts
   import { ValironSDK } from "@valiron/sdk";
   const valiron = new ValironSDK({
     apiKey: process.env.VALIRON_API_KEY, // omittable for read-only calls
     chain: "ethereum",
   });
   ```
5. If `VALIRON_API_KEY` is needed but unset, **stop and ask the user** to add it to
   `.env` (this rule is also in [`AGENTS.md`](../AGENTS.md)). Do **not** fabricate,
   hardcode, or commit a key.

That covers the **read + gate** path (`checkAgent`, `getAgentProfile`, `gate`). The
**write/feedback** path and per-judge **agent identities** need §3–§4 plus a one-time
live check (§5 / reputation-layer **M0**).

---

## 1. Two distinct credentials (do not conflate)

| Credential | What it is | Where it lives | Needed for |
|---|---|---|---|
| **Operator API key** | A `val_op_…` token from the Valiron Operator Dashboard | `.env` → `VALIRON_API_KEY` (gitignored) | Write / operator calls; Pro features. **Optional for reads.** |
| **Agent identity key** | An EIP-191 / secp256k1 **private key**, one per judge agent | gitignored `data/.valiron/` (**not** `.env`) | A judge proving its own identity (challenge-response) as a key-based agent |

The operator key authenticates **us (the operator)** to Valiron's API. The agent
identity keys authenticate **each judge agent**. Different secrets, different
lifetimes — never commit either.

## 2. Operator API key → `VALIRON_API_KEY`

- The `ValironSDK` constructor takes an **`apiKey`** option (`SDK-REFERENCE.md`),
  documented as *"optional for read operations"* → therefore **required for
  write/operator operations**.
- Format: operator keys carry a **`val_op_` prefix**; obtain one from the Operator
  Dashboard.
- Convention (**ours**, not Valiron's): expose it as **`VALIRON_API_KEY`** in `.env`
  and pass `apiKey: process.env.VALIRON_API_KEY`. Valiron does **not** document an
  env-var name and the SDK does **not** auto-read `.env`, so the app loads it.
- Read-only calls (`checkAgent`, `getAgentProfile`, `gate`) work **without** a key
  (SKILL.md: *"No API key required for read operations"*).

## 3. Agent identities (key-based / Web2, EIP-191)

> ⚠️ **Superseded for the reputation-layer feature** — it uses **Solana keypairs +
> ERC-8004 registration** (§7), not this EIP-191 path. Kept for reference and any
> other (Web2) Valiron use.

Per `auth.md`, agents authenticate with an Ethereum keypair (no API key) via HTTP
headers:

- `x-agent-address` — the agent's `0x…` address (sent on each request)
- `x-agent-signature` — signature over a server challenge (when proving ownership)
- `x-agent-session` — session token returned after a successful challenge, reusable
  for ~1 hour

Flow: send `x-agent-address` → if the API replies `{"error":"challenge_required"}`,
sign the challenge with the agent's private key → retry with all three headers →
cache the returned `x-agent-session`.

Storage: Valiron's own CLI uses an `agent-identity.json` (*"contains private keys.
Never commit it to git."*). In this repo, per
[`valiron-reputation-layer.md`](./valiron-reputation-layer.md) §5.2, generate one
identity per `<slug>@<version>` under the **gitignored `data/.valiron/`**, with a
`VALIRON_KEYSTORE_DIR` env override for hosting. Persona frontmatter holds only the
**public** `valiron_agent_id`.

## 4. Secret hygiene (.gitignore)

Already ignored in the repo `.gitignore`:

- `.env`, `.env.*` (operator key) — `!.env.example` stays trackable as a template
- `data/` (covers `data/.valiron/` agent keys and the optional SQLite mirror)

Never write a `val_op_…` token or a private key into a tracked file.

## 5. Still needs a live check before building (reputation-layer M0)

> ⚠️ **Superseded by §7.3.** The checks below were for the earlier Web2 / key-based
> framing. The current (Solana) M0 checks are in §7.3.

These came back **thin / undocumented** and must be confirmed with a throwaway script
against the live SDK before you rely on them
([`valiron-reputation-layer.md`](./valiron-reputation-layer.md) §7.2):

1. The exact **feedback-write** call for key-based agents (method, args, auth) — the
   linchpin for "Valiron *is* the ledger."
2. `getAgentProfile()` return shape — which field is peer reputation vs. behavioral.
3. The key-based **registration** flow and how the SDK performs the EIP-191
   challenge-response.
4. Whether `checkAgent` works before any gated request (may need a first `gate()`).

If a check fails, take the spec's **fallback** (§8): SQLite stays source of truth;
Valiron provides the gate + verifiable identity. Do not fake an unconfirmed call.

## 6. Smoke test (sketch — verify, don't trust)

```bash
npm install @valiron/sdk
# read-only connectivity check (no key needed). Replace <AGENT_ID> with a real id.
node -e "import('@valiron/sdk').then(async ({ValironSDK})=>{const v=new ValironSDK({chain:'ethereum'});console.log(await v.checkAgent('<AGENT_ID>'))})"
```

A `prod | prod_throttled | sandbox | sandbox_only` result (or a clean API error)
confirms connectivity. Add `apiKey: process.env.VALIRON_API_KEY` once write calls are
needed. (Exact arg/return shapes are part of the §5 M0 check.)

---

## 7. Solana on-chain addendum (current design)

> Supersedes the **agent-identity** guidance in §1 (row 2) and §3, and the **M0
> checks** in §5. The **operator key** (§2) and **secret hygiene** (§4) are
> unchanged. Full design: [`valiron-reputation-layer.md`](./valiron-reputation-layer.md).

`@valiron/sdk` v1.0.2 is **read / gate only** — it has no feedback-write. So judges'
peer feedback is written to the **ERC-8004 reputation registry on Solana directly**,
and Valiron **reads and gates** over it.

### 7.1 Credentials under this design

| Credential | What | Where | Needed for |
|---|---|---|---|
| **Operator API key** (`val_op_…`) | unchanged — see §2 | `.env` → `VALIRON_API_KEY` (gitignored) | Valiron operator/gate calls; **optional for reads** |
| **Judge agent identity** | a **Solana keypair** (Ed25519), one per `<slug>@<version>`, registered as an **ERC-8004 agent** (Metaplex Core asset) | gitignored `data/.solana/` | the judge's on-chain identity; the base-58 asset pubkey is `solana_agent_id` in persona frontmatter |
| **Rater keypair** | a **funded** Solana **devnet** keypair that signs feedback writes | gitignored `data/.solana/` | writing ERC-8004 feedback entries on-chain |

This **replaces** the EIP-191 / `secp256k1` key-based identity and the
`x-agent-address` / `x-agent-signature` / `x-agent-session` flow in §3 — not used
for this feature. Frontmatter holds `solana_agent_id` (not `valiron_agent_id`).

### 7.2 SDK + env

```ts
import { ValironSDK } from "@valiron/sdk";
const valiron = new ValironSDK({ chain: "solana" }); // not "ethereum"; no key for reads
```
```dotenv
# .env (gitignored) — alongside VALIRON_API_KEY
SOLANA_CLUSTER=devnet
SOLANA_RPC_URL=https://api.devnet.solana.com   # or a dedicated devnet RPC
```

Extra deps beyond `@valiron/sdk`: **`@solana/web3.js`** and the ERC-8004 Solana
program client (**QuantuLabs `8004-solana`**) for registration + feedback writes.

### 7.3 Live checks before building (replaces §5)

Per [`valiron-reputation-layer.md`](./valiron-reputation-layer.md) §7.2 / M0:

1. **🔴 Does Valiron's read API index Solana _devnet_ ERC-8004?** Gates the whole
   approach; fallbacks are documented in the feature spec.
2. Exact ERC-8004 Solana **register-agent** + **submit-feedback** instructions
   (`8004-solana`): args (`to`, `score`, `tag1`, `tag2`), signer, returned id / tx.
3. `getAgentProfile(id, { chain: "solana" })` shape — `onchainReputation.averageScore`.
4. Devnet **faucet** + RPC for funding the rater keypair.

### 7.4 Secret hygiene (same rule as §4)

`data/.solana/` is covered by the existing `data/` ignore. Never commit a keypair or
a `val_op_…` token. If a needed secret is unset, **stop and ask** — do not fabricate
or hardcode.

---

## Sources

- Valiron docs — <https://www.valiron.co/docs>
- Auth / agent identity — <https://valiron.co/auth.md>
- SDK reference — <https://valiron.co/docs/agents/SDK-REFERENCE.md>
- ERC-8004 on Solana — QuantuLabs `8004-solana` (Metaplex Core) · `@solana/web3.js`
- Installed skill — [`.claude/skills/valiron/SKILL.md`](../.claude/skills/valiron/SKILL.md)
- Feature spec — [`valiron-reputation-layer.md`](./valiron-reputation-layer.md)
