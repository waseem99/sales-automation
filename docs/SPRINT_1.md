# Sprint 1 — Foundation and First Useful Lead Loop

## Sprint Goal

Build the first useful internal loop:

Safe input source → normalized lead object → dedupe → score → urgency/status → profile recommendation → portfolio match → recommended human action → human-approved draft → hot alert plan → safe alert delivery decision → enrichment policy/verification → durable local storage → analytics/learning report → dashboard-ready lead review model → controller/API actions → session-aware route-level access control → lightweight rendered dashboard shell.

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
15. Analytics and scoring calibration foundation. ✅
16. Partner and solution-led prospect scoring foundation. ✅
17. Enrichment policy, cost-control, and human-verification foundation. ✅
18. Safe alert delivery adapter foundation. ✅
19. Read-only Gmail/email source adapter foundation. ✅
20. Hardened LinkedIn/Sales Navigator parser with extraction, confidence, and skip reasons. ✅
21. Auth/session adapter foundation with anonymous read-only default. ✅

### P2 — Later

1. Full interactive dashboard UI components/forms.
2. Production database-backed repository.
3. Real identity provider/session middleware integration.
4. Real Gmail API runtime wiring.
5. Real enrichment provider adapters/imports.
6. Admin scoring-weight adjustment UI/API.
7. Real external alert provider configuration.

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
- Sales Navigator alerts normalize separately as source `sales_navigator` and lead type `linkedin_sales_nav_alert`.
- Low-confidence LinkedIn/Sales Navigator signals move to human review instead of being treated as clean leads.

### Partner / Solution Prospecting

- Daily or weekly cadence.
- Partner priority if score is 80+.
- Partner urgent only if score is 90+ or strong direct buying/overflow/partnership trigger exists.
- Solution-led priority if score is 80+.
- Solution-led urgent if score is 85+ with strong observed pain signal.

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

### `@sales-automation/auth`

Auth/session foundation:

- Defines authenticated user model with ID, email/name, role, and active flag.
- Defines session adapter interface for future real auth providers.
- Provides `StaticSessionAdapter` for tests and local/dev use.
- Resolves bearer tokens and `x-sales-automation-session` headers.
- Defaults anonymous/no-session access to `read_only`.
- Falls inactive users back to the safe default role.
- Formats actor identity for audit usage.
- Powers `/api/session` and session-aware web route permissions.

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

Parser layer:

- Parses simple Upwork job alert/digest style email text.
- Extracts Upwork title, URL, budget signal, posted/freshness signal, service category, and normalized lead object.
- Parses safe manual/alert-text LinkedIn warm signals.
- Detects Sales Navigator saved-search/lead alerts.
- Distinguishes LinkedIn notification, manual post, Sales Navigator alert, and unknown source types.
- Extracts LinkedIn/source URL, contact name, contact role, company name, freshness minutes, and timeline signal.
- Produces parser confidence and diagnostic reasons.
- Produces skip reasons for low-confidence, newsletter/digest, and non-actionable signals.
- Normalizes Sales Navigator alerts as source `sales_navigator` and lead type `linkedin_sales_nav_alert`.

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

### `@sales-automation/email-sources`

Read-only Gmail/email source foundation:

- Defines safe email source adapter interface for Gmail, IMAP, manual email import, and mock sources.
- Enforces read-only adapter contract.
- Defines Gmail-style query model with query terms, label, recency, and max result controls.
- Classifies Upwork job-alert emails.
- Classifies LinkedIn and Sales Navigator lead-signal emails.
- Hands supported messages into the existing ingestion pipeline.
- Preserves existing dedupe, scoring, repository save, and alert eligibility behavior.
- Skips unsupported emails with no side effects.
- Does not send, archive, delete, label, or modify emails.

### `@sales-automation/workers`

Cadence-aware worker runner:

- Runs configured safe ingestion sources only when due.
- Supports 30-minute Upwork and LinkedIn warm source checks.
- Tracks last-run state by source ID.
- Skips disabled and not-yet-due sources.
- Does not contain scraping, sending, or credential logic.

### `@sales-automation/prospecting`

Partner and solution-led prospecting foundation:

- Defines partner target types and buying triggers.
- Scores partner prospects across ICP fit, trigger strength, service gap, commercial potential, and portfolio/proof fit.
- Provides partner recommended angle and next action.
- Converts partner prospects into normalized lead objects.
- Defines solution campaign catalog for airline refund automation, banking private intelligence, enterprise AI automation, and B2B website intelligence.
- Scores solution-led prospects across ICP fit, pain trigger strength, service gap, commercial potential, and campaign proof fit.
- Converts solution-led prospects into normalized lead objects.
- Does not scrape, enrich, or send outreach automatically.

### `@sales-automation/enrichment`

Enrichment policy and verification foundation:

- Defines allowed enrichment providers such as manual research, company website, Google search, LinkedIn manual review, Sales Navigator manual review, paid data provider, and CRM import.
- Defines enrichment fields for company, contact, business email, LinkedIn URLs, phone, and CRM account IDs.
- Blocks enrichment for rejected leads.
- Disables paid enrichment by default.
- Guards paid enrichment with minimum score, allowed qualification statuses, and monthly budget checks.
- Captures evidence with field, value, provider, source URL, confidence, cost, verification status, verifier, timestamp, and notes.
- Requires human verification before outreach readiness.
- Produces enrichment summary with verified fields, rejected fields, review-needed fields, paid cost, verified business email, and outreach-ready flag.
- Stores enrichment evidence/summary through audit metadata for the local MVP.
- Does not call external vendors, scrape, or send outreach.

### `@sales-automation/drafting`

Human-approved draft generator:

- Generates Upwork proposals.
- Generates LinkedIn comment and DM variants.
- Generates partner outreach drafts.
- Generates solution-led outreach drafts.
- Never sends externally.
- References only public/anonymized proof.

### `@sales-automation/alerts`

Hot alert planner and safe delivery foundation:

- Determines alert eligibility.
- Supports dashboard/log/email/slack/WhatsApp channel planning.
- Defaults safely to log/dashboard channels when channels are not configured.
- Includes alert dedupe keys.
- Provides safe delivery adapter interface.
- Dry-runs delivery by default.
- Suppresses duplicate alerts before delivery using prior dedupe keys.
- Provides safe log and dashboard adapters.
- Provides email, Slack, and WhatsApp placeholder adapters that skip instead of sending when not configured.
- Converts adapter exceptions into failed delivery records.
- Does not contact prospects or clients.

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

### `@sales-automation/analytics`

Analytics and learning-loop foundation:

- Builds funnel metrics for captured, scored, hot, qualified, approved, sent, replied, meeting booked, proposal sent, won, lost, rejected, and archived leads.
- Calculates win, reply, meeting, proposal, loss, and rejection rates.
- Breaks down metrics by source, service category, recommended profile, and owner.
- Records win/loss/rejection reasons in audit metadata.
- Builds scoring calibration reports with average scores, false positives, false negatives, and score-band outcomes.
- Avoids counting rejected leads as outreach/reply/meeting/proposal progress.

### `@sales-automation/dashboard`

Dashboard-ready model layer:

- Builds opportunity list rows.
- Supports filters by source, lead type, score, urgency, profile, owner, status, and service category.
- Supports saved views like Hot Upwork Now, Hot LinkedIn Warm Posts, AI Automation Leads, AR/3D Leads, Partner Prospects, Solution-Led Prospects, Needs Human Review, and Overdue Hot Leads.
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
- Exposes lightweight HTTP routes for health, session, dashboard, summary, opportunity list/detail, safe ingestion, status updates, owner assignment, notes, and alert dedupe.
- Uses `LocalJsonLeadRepository` in dev mode.
- Resolves route actor/role from `@sales-automation/auth` when a session adapter is configured.
- Defaults anonymous/no-session access to read-only.
- Enforces route-level permissions through `@sales-automation/access-control`.
- Escapes dynamic content to avoid raw HTML/script injection in rendered lead data.

---

## Sprint 1 Remaining Implementation Order

1. Add real identity provider/session middleware integration.
2. Add real Gmail API runtime wiring.
3. Add enrichment UI/API and real provider adapters/imports.
4. Add real external alert provider configuration.
5. Add production database-backed repository.
6. Add interactive frontend forms/components.
7. Add admin scoring-weight adjustment UI/API.

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
- Safe alert delivery decision with dedupe and dry-run default.
- Hardened LinkedIn/Sales Navigator parser output with confidence, extraction, and skip reasons.
- Safe Gmail/email source classification and read-only ingestion handoff.
- Safe ingestion with dedupe and immediate evaluation.
- Partner and solution-led prospect scoring and lead normalization.
- Enrichment policy/cost-control decision and human-verification evidence model.
- Session-aware route permissions with anonymous read-only fallback.
- Cadence-aware worker runner for 30-minute source checks.
- Durable local storage for evaluated leads.
- Analytics and calibration reporting foundation.
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
- Anonymous/no-session access must default to read-only.
- Inactive users must fall back to safe default permissions.
- Email source adapters must remain read-only unless explicitly reviewed and changed later.
- No email sending, archiving, deleting, labeling, or modifying from ingestion adapters.
- Low-confidence LinkedIn/Sales Navigator signals must remain human-reviewed.
- No paid enrichment unless explicitly enabled and within score/status/budget policy.
- No outreach-ready contact data without human verification.
- No external alert delivery unless a real provider adapter is explicitly configured.
- Human approval before any external communication.
- Every recommendation should include reasoning.
