# Sprint 1 — Foundation and First Useful Lead Loop

## Sprint Goal

Build the first useful internal loop:

Manual or Upwork lead input → normalized lead object → score → urgency/status → profile recommendation → portfolio match → recommended human action → proposal draft next → alert next.

This sprint should prove that Codistan can evaluate an opportunity quickly and consistently without relying on fixed daily limits.

---

## Sprint 1 Priorities

### P0 — Must Have

1. Monorepo foundation. ✅
2. Shared lead/profile/portfolio data types. ✅
3. Config-driven thresholds and source cadences. ✅
4. Initial lead scoring engine. ✅
5. Profile routing engine. ✅
6. Tag-based portfolio matching engine. ✅
7. Sample fixtures for leads and portfolio items. ✅
8. End-to-end evaluator. ✅
9. Manual lead input API or CLI.
10. Basic Upwork email/manual parsing model.
11. Human-readable lead score explanation. ✅

### P1 — Should Have

1. Draft generator interface.
2. Hot alert interface.
3. In-memory or local DB proof-of-concept.
4. Sample leads for scoring tests. ✅

### P2 — Later

1. Full dashboard.
2. Gmail integration.
3. Sales Navigator alert parser.
4. Enrichment providers.
5. Analytics.

---

## Current Branch

`sprint-1-foundation`

---

## Source Timing Rules

### Upwork

- Check every 30 minutes.
- Hot if score is 80+.
- Also urgent if score is 75+ and job freshness is <= 60 minutes.

### LinkedIn Warm Leads

- Check every 30 minutes where source input is available.
- Hot if score is 75+.
- Also urgent if score is 70+ and post freshness is <= 2 hours.

### Partner / Solution Prospecting

- Daily or weekly cadence.
- Not treated as urgent unless score is very high or there is a direct buying signal.

---

## Current Implemented Packages

### `@sales-automation/shared`

Contains shared types and config:

- Lead source/type.
- Service categories.
- Qualification status.
- Urgency status.
- Pipeline status.
- Codistan profile types.
- Portfolio item schema.
- Score breakdown schema.
- Qualification thresholds.
- Cadence rules.

### `@sales-automation/scoring`

Initial scoring engine:

- Service fit.
- Buyer quality.
- Budget/ROI.
- Timing/freshness.
- Portfolio proof match.
- Competition/access risk.
- Compliance safety.
- Red flag penalties.

### `@sales-automation/routing`

Profile routing engine:

- Recommends primary profile.
- Suggests secondary profiles.
- Flags profile/compliance risk.
- Handles partner and solution-led identities.

### `@sales-automation/portfolio-matching`

Tag-based portfolio matcher:

- Matches lead text to portfolio tags.
- Scores service category fit.
- Prioritizes public/anonymized proof.
- Returns top matching portfolio items.

### `@sales-automation/fixtures`

Sample test data:

- Upwork RAG job.
- LinkedIn AI warm post.
- Partner agency prospect.
- Low-budget red-flag Upwork lead.
- Initial sample portfolio items.

### `@sales-automation/evaluator`

End-to-end evaluation layer:

- Detects red flags.
- Runs portfolio matching.
- Runs scoring.
- Runs profile routing.
- Returns recommended next human action.

---

## Sprint 1 Remaining Implementation Order

1. Add manual lead input API or CLI.
2. Add sample evaluation runner.
3. Add scoring/evaluator tests.
4. Add basic Upwork email parser.
5. Add draft generator interface.
6. Add hot alert interface.

---

## Exit Criteria

By the end of Sprint 1, a user should be able to input a lead/job and get:

- Score out of 100.
- Status: hot, qualified, nurture, or rejected.
- Urgency: urgent, normal, or low.
- Score breakdown.
- Red flags.
- Recommended next action.
- Recommended profile.
- Matching portfolio proof.

---

## Safety Rules

- No unauthorized scraping.
- No auto-bidding.
- No auto-DM.
- No fake-account workflow.
- Human approval before any external communication.
- Every recommendation should include reasoning.
