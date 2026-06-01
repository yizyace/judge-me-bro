---
id: idea-003
title: "MeetCap — one-click meeting recaps pasted into your chat"
one_liner: "A bot that drops a tidy 3-bullet summary and action items into your team chat the moment a video call ends."
team:
  - "Tomás Vidal"
  - "Grace Liu"
links:
  demo: "https://meetcap.io/demo"
---

## Problem

After a video call, somebody has to remember what was decided and who owns what,
and often nobody does. It's a small but genuine papercut: action items evaporate,
and the person who took notes resents it. People do feel this — but it's a mild,
intermittent annoyance, not an urgent budgeted problem. Most teams already cope
with it via a shared doc or by just... remembering.

## Solution

MeetCap joins your Zoom/Meet call as a participant, transcribes it, and the
second the call ends it posts a clean recap to the linked Slack or Teams channel:
three summary bullets, a list of decisions, and action items with owners. No
dashboard to check, no doc to open — it meets people where they already are.
It's a tidy, well-scoped piece of UX. The trouble is that it's a *thin* slice:
the hard part (transcription + summarization) is a commodity API call, the
recap-to-chat step is a few hundred lines, and Zoom, Google Meet, Otter, Fireflies,
and every notetaker already ship a version of exactly this — often for free as a
checkbox in a product the customer already pays for. There's no obvious moat, no
data flywheel, and nothing a platform couldn't absorb in a sprint.

## Market

The "meeting notes" space is real but is rapidly becoming a free feature of the
meeting platforms themselves. Standalone willingness-to-pay is low precisely
because the bundled options are good enough. We'd be selling a $5/user add-on
into a slot the platforms are actively filling for $0. Even at generous
penetration this reads as a small lifestyle product, not a venture-scale market —
a feature in search of a company.

## Team

Tomás and Grace are solid full-stack engineers who built the whole thing in a
weekend, which is itself the tell: a weekend-buildable product is a weekend-
buildable product for everyone, including the incumbents. Neither has gone to
market before, and there's no domain edge in transcription, summarization
quality, or distribution that would let this outrun a platform's built-in
feature.

## Traction & ask

A few hundred signups from a Product Hunt launch, a couple dozen weekly active
users, no revenue yet, and a flat (slightly declining) usage curve after the
launch bump as people realize Zoom already does this. We're not raising; we're
mostly looking for feedback on whether there's a real company here. Our own
honest read is that this is a nice feature, not a defensible business.
