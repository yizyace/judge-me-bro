---
id: superagent
title: "Superagent"
one_liner: "Red teaming for AI agents — an open-source platform that protects AI agents from prompt injections, malicious tool calls, harmful outputs, and customer-data leaks."
team:
  - "Alan Zabihi — CEO, co-founder"
  - "Ismail Pelaseyed — CTO, co-founder; prior open-source AI-agent framework builder"
links:
  - https://superagent.sh/
  - https://www.ycombinator.com/companies/superagent
batch: W24
source_urls:
  - https://www.ycombinator.com/companies/superagent
---

## Problem
Teams shipping AI agents to production try to "system-prompt their way to security,"
which fails against real attacks. Prompt injections, malicious tool calls, harmful
outputs, and customer-data leaks all slip past static filters.

## Solution
Superagent runs specialized attack agents that red-team production AI for data
leaks, harmful outputs, and unwanted actions, then produce structured safety
reports. Its core SuperagentLM model reasons about inputs and outputs rather than
relying on static rules, and integrates at inference providers, agent frameworks,
and CI/CD.

## Market
The rapidly growing base of companies deploying AI agents into production who need
runtime guardrails and security/compliance evidence to close enterprise sales.

## Ask
Adoption by engineering teams shipping agentic products who need runtime guardrails
and red-team coverage.
