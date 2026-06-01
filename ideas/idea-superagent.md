---
id: idea-superagent
title: "Superagent"
one_liner: "Red teaming for AI agents: open-source security that guards agents against prompt injection, malicious tool calls, and data leaks."
source_company: "Superagent"
source_urls:
  - https://superagent.sh/
  - https://www.ycombinator.com/companies/superagent
distilled_at: 2026-06-01
distilled_by: idea-distiller@v1
team:
  - "Alan Zabihi"
  - "Ismail Pelaseyed"
---

## Problem
Teams shipping AI agents to production often try to "system-prompt their way to
security," which fails against real attacks. Prompt injections, malicious tool
calls, harmful outputs, and customer-data leaks slip past static filters.

## Solution
Superagent runs specialized attack agents that red-team production AI for data
leaks, harmful outputs, and unwanted actions, then produce structured safety
reports. Its core SuperagentLM model reasons about inputs and outputs rather than
relying on static rules, integrating at inference providers, agent frameworks, and
CI/CD.

## Market
Companies deploying AI agents into production who need runtime guardrails and
security/compliance evidence to close enterprise sales. The base is growing with
agent adoption.

## Team
Alan Zabihi (CEO, co-founder) and Ismail Pelaseyed (CTO, co-founder); Pelaseyed
previously built an open-source AI-agent framework. Further public background on
the founders is limited.

## Traction
YC W24 company; the platform is open-source. No public revenue or user figures
were found.

## The Ask
Adoption by engineering teams shipping agentic products who need runtime guardrails
and red-team coverage.
