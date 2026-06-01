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

## Sources

- Valiron docs — <https://www.valiron.co/docs>
- Auth / agent identity — <https://valiron.co/auth.md>
- SDK reference — <https://valiron.co/docs/agents/SDK-REFERENCE.md>
- Installed skill — [`.claude/skills/valiron/SKILL.md`](../.claude/skills/valiron/SKILL.md)
- Feature spec — [`valiron-reputation-layer.md`](./valiron-reputation-layer.md)
