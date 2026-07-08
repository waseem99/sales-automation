# Sprint 1 — Foundation and First Useful Lead Loop

## Sprint Goal

Build the first useful internal loop:

Safe input source → normalized lead object → dedupe → score → urgency/status → profile recommendation → portfolio match → recommended human action → human-approved draft → hot alert plan → durable local storage → dashboard-ready lead review model → controller/API actions → route-level access control → lightweight rendered dashboard shell.

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
9. Manual lead input CLI. ✅
10. Basic Upwork email/manual parsing model. ✅
11. Human-readable lead score explanation. ✅

### P1 — Should Have

1. Draft generator interface. ✅
2. Hot alert interface. ✅
3. In-memory or local DB proof-of-concept. ✅
4. Sample leads for scoring tests. ✅
5. Basic parser/evaluator smoke tests. ✅
6. GitHub Actions CI. ✅
7. Dashboard-ready list/detail/saved-view model. ✅
8. Dashboard controller/API layer. ✅
9. Lightweight rendered dashboard shell. ✅
10. Durable local JSON repository. ✅
11. Safe ingestion orchestration with dedupe and immediate evaluation. ✅
12. Cadence-aware ingestion worker runner. ✅
13. HTTP route binding for dashboard, ingestion, and reviewer actions. ✅
14. Role/permission foundation with route-level enforcement. ✅

### P2 — Later

1. Full interactive dashboard UI components/forms.
2. Production database-backed repository.
3. Real authentication/session integration.
4. Gmail integration.
5. Sales Navigator alert parser hardening.
6. Enrichment providers.
7. Analytics.

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

### `@sales-automation/access-control`

Role and permission foundation:

- Roles: admin, founder, BD manager, reviewer, read-only.
- Permission checks for viewing opportunities, ingesting leads, updating status, assigning owner, adding notes, marking alerts, viewing private portfolio, managing settings, managing compliance rules, and managing users.
- Shared helpers for checking and asserting permissions.
- Route-level enforcement in the web adapter.

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
- Uses safer whole-word keyword matching to avoid false positives.

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
- Generates human-approved drafts.
- Builds a hot alert plan.
- Returns recommended next human action.

### `@sales-automation/cli`

Manual lead evaluation CLI:

- Evaluates bundled sample leads.
- Evaluates pasted/manual lead JSON files.
- Returns score, urgency, red flags, recommended profile, matched portfolio, draft outputs, alert plan, and next action.

### `@sales-automation/parsers`

Basic parser layer:

- Parses simple Upwork job alert/digest style email text.
- Extracts title, URL, budget signal, posted/freshness signal, service category, and normalized lead object.
- Parses safe manual/alert-text LinkedIn warm signals.

### `@sales-automation/ingestion`

Safe ingestion orchestration layer:

- Ingests safe Upwork email parser outputs.
- Ingests safe LinkedIn/manual signal parser outputs.
- Ingests manual lead batches.
- Deduplicates by normalized source URL or lead ID.
- Triggers immediate evaluation after capture.
- Saves evaluated leads to the configured repository.
- Returns captured/skipped counts and alert eligibility.
- Does not scrape or send anything externally.

### `@sales-automation/workers`

Cadence-aware worker runner:

- Runs configured safe ingestion sources only when due.
- Supports 30-minute Upwork and LinkedIn warm source checks.
- Tracks last-run state by source ID.
- Skips disabled and not-yet-due sources.
- Does not contain scraping, sending, or credential logic.

### `@sales-automation/drafting`

Human-approved draft generator:

- Generates Upwork proposals.
- Generates LinkedIn comment and DM variants.
- Generates partner outreach drafts.
- Generates solution-led outreach drafts.
- Never sends externally.
- References only public/anonymized proof.

### `@sales-automation/alerts`

Hot alert planner:

- Determines alert eligibility.
- Supports dashboard/log/email/slack/WhatsApp channel planning.
- Defaults safely to log/dashboard when channels are not configured.
- Includes dedupe keys.
- Does not send externally.

### `@sales-automation/storage`

Repository layer:

- Stores leads and latest evaluations.
- Supports status updates.
- Supports owner assignment.
- Supports notes.
- Tracks alert dedupe keys.
- Maintains an audit log for key actions.
- Provides `InMemoryLeadRepository` for tests/dev.
- Provides `LocalJsonLeadRepository` for durable MVP/local persistence.
- Auto-creates local JSON storage file when missing.
- Reloads saved records across repository instances.
- Throws clear errors for invalid local JSON/schema.

### `@sales-automation/dashboard`

Dashboard-ready model layer:

- Builds opportunity list rows.
- Supports filters by source, lead type, score, urgency, profile, owner, status, and service category.
- Supports saved views like Hot Upwork Now, Hot LinkedIn Warm Posts, AI Automation Leads, Partner Prospects, Solution-Led Prospects, Needs Human Review, and Overdue Hot Leads.
- Builds lead detail payloads with evidence, score breakdown, red flags, profile reasoning, portfolio matches, drafts, notes, and audit log.
- Exposes allowed status transitions for reviewer actions.
- Calculates summary counts and SLA overdue state.

### `@sales-automation/api`

Dashboard controller/API layer:

- Lists opportunities using dashboard filters and saved views.
- Returns dashboard summary metrics.
- Returns lead detail payloads.
- Supports status updates with safe transition enforcement.
- Supports owner assignment.
- Supports notes.
- Supports alert-sent dedupe marking.
- Validates missing records and invalid empty inputs.

### `@sales-automation/web`

Lightweight rendered dashboard and HTTP adapter:

- Renders a static HTML dashboard preview without heavy UI dependencies.
- Shows summary metrics, lead list, selected lead detail, allowed status actions, and notes.
- Exposes lightweight HTTP routes for health, dashboard, summary, opportunity list/detail, safe ingestion, status updates, owner assignment, notes, and alert dedupe.
- Uses `LocalJsonLeadRepository` in dev mode.
- Enforces route-level permissions through `@sales-automation/access-control`.
- Escapes dynamic content to avoid raw HTML/script injection in rendered lead data.

---

## Sprint 1 Remaining Implementation Order

1. Add real authentication/session integration.
2. Add Gmail ingestion adapter later.
3. Add Sales Navigator / LinkedIn alert adapter hardening.
4. Add production alert delivery adapters.
5. Add production database-backed repository.
6. Add interactive frontend forms/components.

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
- Human-approved draft output.
- Alert eligibility and alert plan.
- Safe ingestion with dedupe and immediate evaluation.
- Cadence-aware worker runner for 30-minute source checks.
- Durable local storage for evaluated leads.
- Dashboard-ready list/detail state.
- Controller/API actions for status, owner, notes, and alert dedupe.
- Route-level permission enforcement.
- Lightweight dashboard HTML preview and HTTP API.

---

## Safety Rules

- No unauthorized scraping.
- No auto-bidding.
- No auto-DM.
- No fake-account workflow.
- Human approval before any external communication.
- Every recommendation should include reasoning.
