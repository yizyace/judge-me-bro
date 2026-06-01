---
name: valiron-integration
version: 0.2.0
description: Protect your API endpoints from bad or malicious AI agents. Use Valiron to gate, score, and sandbox agents before they reach your infrastructure. Covers SDK setup, Express middleware, trust gating, behavioral evaluation, and multi-chain support (41 EVM chains + Solana).
homepage: https://valiron.co
metadata: {"category":"trust","api_base":"https://valiron-edge-proxy.onrender.com"}
---

# Valiron

> **You are on:** `https://valiron.co` · `https://valiron-edge-proxy.onrender.com` | **Site map:** [llms.txt](https://valiron.co/llms.txt)

Trust infrastructure for API sellers. Protect your endpoints from bad or malicious AI agents. Valiron evaluates agent behavior using on-chain identity (ERC-8004), behavioral sandbox testing, and Moody's-style credit ratings (AAA to C) — so you can allow trusted agents and block risky ones before they reach your infra.

## Skill Files

| File | URL |
|------|-----|
| **SKILL.md** (this file) | `https://valiron.co/skill/SKILL.md` |
| **auth.md** (agent identity) | `https://valiron.co/auth.md` |
| **QUICKSTART.md** | `https://valiron.co/docs/agents/QUICKSTART.md` |
| **AGENT-READY-APIS.md** | `https://valiron.co/docs/agents/AGENT-READY-APIS.md` |
| **SDK-REFERENCE.md** | `https://valiron.co/docs/agents/SDK-REFERENCE.md` |
| **API-REFERENCE.md** | `https://valiron.co/docs/agents/API-REFERENCE.md` |
| **TRUST-MODEL.md** | `https://valiron.co/docs/agents/TRUST-MODEL.md` |
| **IDENTITY.md** | `https://valiron.co/docs/agents/IDENTITY.md` |
| **SANDBOX.md** | `https://valiron.co/docs/agents/SANDBOX.md` |
| **CHAINS.md** | `https://valiron.co/docs/agents/CHAINS.md` |
| **ERRORS.md** | `https://valiron.co/docs/agents/ERRORS.md` |
| **llms.txt** | `https://valiron.co/llms.txt` |
| **llms-full.txt** | `https://valiron.co/llms-full.txt` — complete docs in a single file |

**Only fetch the files you need** to keep your context lean.

**Base URL:** `https://valiron-edge-proxy.onrender.com`

## Quick Start

For full walkthrough, see [QUICKSTART.md](https://valiron.co/docs/agents/QUICKSTART.md).

```bash
npm install @valiron/sdk
```

```typescript
import { ValironSDK } from "@valiron/sdk";

const valiron = new ValironSDK({
  chain: "ethereum", // or: monad, arbitrum, base, polygon, solana, etc.
});

// Check if an agent is trusted before serving a request
const route = await valiron.checkAgent("AGENT_ID");
// Returns: "prod" | "prod_throttled" | "sandbox" | "sandbox_only"

// Get full trust profile for an incoming agent
const profile = await valiron.getAgentProfile("AGENT_ID");

// Gate an agent — allow/deny decision for your endpoint
const gate = await valiron.gate("AGENT_ID");
if (gate.allow) { /* serve the request */ }

// Trigger a sandbox evaluation for an agent
const result = await valiron.triggerSandboxTest("AGENT_ID");
```

No API key required for read operations.

## Make Existing APIs Agent-Ready

If the operator wants Valiron to host the agent-facing URL, use the dashboard flow instead of SDK middleware:

1. Go to `https://valiron.co/dashboard`.
2. Open **Make API Agent-Ready**.
3. Configure public path, method, upstream API base URL, price, payment protocol (`x402` or `mpp`), optional trust checks, rate limit, and upstream auth.
4. Give agents the generated wrapper URL:

```text
https://valiron-edge-proxy.onrender.com/wrap/{operatorId}/{path}
```

Free wrappers forward directly. x402 wrappers return `402` and require retry with `X-PAYMENT`. MPP wrappers return `WWW-Authenticate: Payment` and require retry with `Authorization: Payment`.

For full setup and client examples, see [AGENT-READY-APIS.md](https://valiron.co/docs/agents/AGENT-READY-APIS.md).

## Protect Your Endpoints (Express Middleware)

The fastest way to gate your API — one line:

```typescript
import { ValironSDK, createValironGate } from "@valiron/sdk";

const valiron = new ValironSDK({ chain: "monad" });

// Protect all routes under /api/paid — blocks untrusted agents automatically
app.use("/api/paid", createValironGate({ sdk: valiron }));
```

Reads `x-agent-id` from the request header. Returns 403 if the agent is untrusted. Customize with `extractAgentId`, `onAllow`, `onDeny`, `minScore`, and `cacheTtlMs`.

For full middleware options, see [SDK-REFERENCE.md](https://valiron.co/docs/agents/SDK-REFERENCE.md).

## Trust Tiers

Valiron assigns each agent a Moody's-style rating based on behavioral evaluation:

| Tier | Meaning | What you should do |
|------|---------|-------------------|
| AAA | Prime | Allow — full production access |
| AA | High grade | Allow — full production access |
| A | Upper medium | Allow — full production access |
| BAA | Medium grade | Allow with throttling |
| BA | Speculative | Allow with throttling |
| B | Highly speculative | Sandbox — evaluate further |
| CAA | Substantial risk | Block or sandbox only |
| CA | Extremely speculative | Block or sandbox only |
| C | Default risk | Block or sandbox only |

For scoring factors, see [TRUST-MODEL.md](https://valiron.co/docs/agents/TRUST-MODEL.md).

## What Valiron Evaluates

Agents hitting your endpoints are scored on:

- **Rate-limit compliance** — do they respect 429s and Retry-After?
- **Auth behavior** — do they stop on 401/403 or hammer?
- **Scope compliance** — do they stay within authorized paths?
- **Injection safety** — do they forward tainted/malicious payloads?
- **Session isolation** — do they leak data between contexts?
- **Request patterns** — are requests reasonable or burst-heavy?
- **Payment handling** — do they handle 402 correctly?

## HTTP API (Quick Reference)

```bash
# Check an agent's trust profile
GET /operator/agent/{agentId}?chain={chain}

# Gate decision (allow/deny)
POST /operator/gate/{agentId}

# Trigger sandbox evaluation (on-chain)
POST /operator/trigger-sandbox/{agentId}

# Trigger sandbox evaluation (key-based)
POST /operator/trigger-sandbox-key/{agentAddress}

# Resolve wallet to agent
GET /operator/resolve-wallet/{wallet}?chain={chain}

# Behavioral snapshot hash
GET /operator/agent/{agentId}/snapshot

# Health check
GET /operator/health
```

For full request/response schemas, see [API-REFERENCE.md](https://valiron.co/docs/agents/API-REFERENCE.md).

## Contracts

### EVM (same address on all 41 chains)

- Identity Registry: `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`
- Reputation Registry: `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63`

### Solana

- Identity Registry: `8oo4dC4JvBLwy5tGgiH3WwK4B9PWxL9Z4XjA2jzkQMbQ`
- Reputation Registry (ATOM): `AToMw53aiPQ8j7iHVb4fGt6nzUNxUhcPc3tbPBZuzVVb`

For on-chain identity details (ARF format, reading/writing data), see [IDENTITY.md](https://valiron.co/docs/agents/IDENTITY.md).

## Supported Chains

**EVM:** ethereum, monad, arbitrum, base, avalanche, celo, polygon, linea, abstract, bsc, gnosis, goat, mantle, megaeth, metis, optimism, scroll, skale_base, soneium, taiko, xlayer — plus testnets.

**Solana:** Use `chain: "solana"`. Agent IDs are base-58 Metaplex Core asset pubkeys or sequential integers.

For full chain list and configuration, see [CHAINS.md](https://valiron.co/docs/agents/CHAINS.md).

## Everything You Can Do

| Action | Method | Endpoint |
|--------|--------|----------|
| **Gate your endpoint** | `createValironGate()` | Express middleware |
| **Allow/deny decision** | `gate()` | `POST /operator/gate/{id}` |
| **Check trust route** | `checkAgent()` | `GET /operator/agent/{id}` |
| **Full trust profile** | `getAgentProfile()` | `GET /operator/agent/{id}` |
| **Sandbox evaluation** | `triggerSandboxTest()` | `POST /operator/trigger-sandbox/{id}` |
| **Key agent sandbox** | `triggerKeyAgentSandbox()` | `POST /operator/trigger-sandbox-key/{address}` |
| **Wallet lookup** | `getWalletProfile()` | `GET /operator/wallet/{wallet}` |
| **Resolve wallet → agent** | `resolveWallet()` | `GET /operator/resolve-wallet/{wallet}` |
| **Behavioral snapshot** | `getAgentSnapshot()` | `GET /operator/agent/{id}/snapshot` |
| **Liveness (Solana)** | — | `GET /operator/agent/{id}/liveness?chain=solana` |
| **Register webhook** | — | `POST /operator/webhooks/register` |
| **Create agent-ready wrapper** | Dashboard/API | `POST /operator/endpoints` |
| **Call agent-ready wrapper** | — | `ALL /wrap/{operatorId}/{path}` |

For SDK method signatures, types, and examples, see [SDK-REFERENCE.md](https://valiron.co/docs/agents/SDK-REFERENCE.md).
