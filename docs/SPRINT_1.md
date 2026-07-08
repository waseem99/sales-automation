# Sprint 1 — Foundation and First Useful Lead Loop

## Sprint Goal

Build the first useful internal loop:

Manual or Upwork lead input → normalized lead object → score → urgency/status → profile and portfolio matching next → proposal draft next → alert next.

This sprint should prove that Codistan can evaluate an opportunity quickly and consistently without relying on fixed daily limits.

---

## Sprint 1 Priorities

### P0 — Must Have

1. Monorepo foundation.
2. Shared lead/profile/portfolio data types.
3. Config-driven thresholds and source cadences.
4. Initial lead scoring engine.
5. Manual lead input API or CLI.
6. Basic Upwork email/manual parsing model.
7. First version of profile routing.
8. First version of portfolio matching using tags.
9. Human-readable lead score explanation.

### P1 — Should Have

1. Draft generator interface.
2. Hot alert interface.
3. In-memory or local DB proof-of-concept.
4. Sample leads for scoring tests.

### P2 — Later

1. Full dashboard.
2. Gmail integration.
3. Sales Navigator alert parser.
4. Enrichment providers.
5. Analytics.

---

## Current Branch

` sprint-1-foundation `

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

## Sprint 1 Implementation Order

1. Create repo and TypeScript workspace structure.
2. Define shared domain types.
3. Define config-driven thresholds and cadence rules.
4. Implement scoring engine.
5. Add sample fixtures.
6. Add tests for scoring behavior.
7. Add profile routing engine.
8. Add portfolio matching engine.
9. Add manual lead input interface.
10. Add draft generator interface.
11. Add alert interface.

---

## Exit Criteria

By the end of Sprint 1, a user should be able to input a lead/job and get:

- Score out of 100.
- Status: hot, qualified, nurture, or rejected.
- Urgency: urgent, normal, or low.
- Score breakdown.
- Red flags.
- Recommended next action.
- Recommended profile, once routing is added.
- Matching portfolio, once matching is added.

---

## Safety Rules

- No unauthorized scraping.
- No auto-bidding.
- No auto-DM.
- No fake-account workflow.
- Human approval before any external communication.
- Every recommendation should include reasoning.
