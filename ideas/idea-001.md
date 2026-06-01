---
id: idea-001
title: "Cascade — automated dependency-upgrade PRs that actually pass CI"
one_liner: "We ship green, mergeable dependency-upgrade pull requests for backend teams, fixing the breaking changes ourselves instead of just opening a PR and walking away."
team:
  - "Priya Nair"
  - "Daniel Okonkwo"
  - "Sofia Reyes"
links:
  demo: "https://cascade.dev/demo"
  repo: "https://github.com/cascade-dev/cascade"
  deck: "https://cascade.dev/deck.pdf"
---

## Problem

Every backend team lives with a backlog of out-of-date dependencies. Security
patches, framework majors, and transitive CVEs pile up because *upgrading is
work*: a version bump breaks the build, a deprecated API changes a signature, a
test starts flaking, and an engineer loses an afternoon. Dependabot and Renovate
opened the floodgates of upgrade PRs, but they stop at the bump — they don't fix
the breakage. So the PRs sit. In our interviews with 41 engineering teams, the
median open Dependabot PR was 63 days old, and 70% of teams admitted they merge
security upgrades late because "someone has to babysit the failures." This is a
real, frequent, painful problem that recurs every single week per repo.

## Solution

Cascade takes the upgrade the rest of the way. When a new version is available,
we open a branch, run the build, and when something breaks we *diff the
library's changelog and AST*, generate the codemod, apply it, and iterate until
CI is green — then hand you a small, reviewed, mergeable PR with a plain-English
summary of exactly what changed and why. The wedge is narrow and sharp: we only
claim a PR when we can make CI pass, so what lands in your queue is always
mergeable. That is the 10x difference from "here's a red PR, good luck." We run
on your CI, never see your source outside the sandboxed runner, and degrade
gracefully — if we can't get to green, we annotate the failure and stay out of
your way.

## Market

Every company with a backend has this problem; it compounds with repo count.
Bottom-up, there are ~4M professional backend developers worldwide; our wedge is
mid-market eng orgs (50–500 engineers) running 20+ active services, where the
upgrade tax is largest and a security-compliance mandate forces the issue. We
price per-repo, per-month, landing at roughly $30k–$120k ACV for that segment.
Renovate and Dependabot proved the top of the funnel exists and is enormous; we
monetize the part they leave undone. Expansion is natural: more repos, more
ecosystems (we start with Node + Python, then Go and Java).

## Team

Priya led the dependency-platform team at a 2,000-engineer fintech and shipped
the internal codemod tooling this is modeled on. Daniel built and sold static
analysis tooling (acquired by a DevTools company) and owns our AST/codemod
engine. Sofia ran developer relations at a popular OSS build tool and is driving
our bottom-up GTM. The three have shipped together before; this is the problem
they each independently hit and hated.

## Traction & ask

Live with 9 design-partner teams; in the last 30 days we auto-merged 220
upgrade PRs to green, including 38 security patches that had been open >30 days.
Two design partners converted to paid ($4.5k/mo combined) and one signed an
annual contract. Net dollar retention is meaningless at this size, but our
green-PR acceptance rate is 86% and climbing as the codemod library grows — a
real compounding moat. We're raising a $2.5M seed to expand language coverage
and convert the waitlist (140 teams). The sharpest open risk: can the codemod
quality hold as we move past Node/Python into ecosystems with weaker changelog
discipline? That's exactly what the round funds us to prove.
