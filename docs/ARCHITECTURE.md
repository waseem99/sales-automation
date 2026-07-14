# Production Architecture

## Product boundary

Codistan Sales Automation is an internal opportunity-intelligence and business-development workspace. Its production objective is to:

1. Discover closeable public opportunities and formal tenders.
2. Retain source evidence and public contact routes.
3. Qualify, score and route each opportunity to the correct team member.
4. Prepare human-reviewed outreach and reply guidance.
5. Track outreach, replies, meetings, proposals, feedback and outcomes.
6. Learn from source quality and commercial outcomes.

The application does not scrape authenticated LinkedIn or Upwork pages, automate LinkedIn messages, submit Upwork proposals, submit tenders, or contact prospects without the configured approval and safety controls.

## Authoritative runtime

There is one production application path:

```text
Vercel
  api/dashboard.ts
    api/dashboard-runtime.ts
      @sales-automation/web/prospect-handler
        Neon Postgres
```

Public application routes:

- `/prospects` — scoped Prospect Desk.
- `/tenders` — formal Tender & RFP Pipeline.
- `/login` — internal account login.
- `/health` — non-secret configuration health.

Scheduled routes:

- `/api/cron/prospect-discovery` — daily public prospect discovery.
- `/api/tender-discovery` — tender refresh every six hours.
- `/api/cron/outreach` — guarded hourly SMTP/IMAP cycle.

The retired Local MVP Lead Desk, duplicate `api/index.ts` runtime, Render/Docker production path, and local Gmail/Slack worker are not part of the production system.

## Core packages

### Domain and qualification

- `packages/shared` — shared lead, status, feedback and portfolio types.
- `packages/scoring` — opportunity scoring.
- `packages/routing` — profile/service routing.
- `packages/portfolio-matching` — proof and case-study matching.
- `packages/drafting` — human-reviewed draft generation.
- `packages/alerts` — alert planning and delivery primitives used by evaluation.
- `packages/evaluator` — orchestrates scoring, routing, proof matching, drafting and alert eligibility.
- `packages/engagement-guidance` — qualification audit and inbound-reply guidance.

### Acquisition and persistence

- `packages/prospect-discovery` — public prospect discovery, PPRA/EPADS, CanadaBuys, UNGM, private/nonprofit tender search, enrichment, deduplication, assignment and digests.
- `packages/storage` — repository contract plus in-memory/local development implementations.
- `packages/neon-state` — production Neon persistence, scoped pagination, aggregates and run locks.
- `packages/fixtures` — approved starter records and temporary portfolio fixtures. Production portfolio replacement remains a tracked backlog item.

### Application and communication

- `apps/web` — Prospect Desk rendering, scoped access, activity, qualification and local development server.
- `packages/outreach-email` — guarded SMTP/IMAP outreach, follow-ups, bounce/reply processing and suppression.
- `api/` — Vercel entry points only.

### Retained future source foundation

- `packages/parsers` and `packages/ingestion` contain tested, compliant parsing and normalization for manually supplied Upwork/LinkedIn/Sales Navigator material. They are intentionally not exposed as a parallel dashboard or autonomous worker. Future integration must write into Neon through the Prospect Desk architecture and preserve human approval.

## Access model

- Admin and Waseem: all company leads and global operations.
- Talha: Talha-team scope.
- Jawad, Moiz, Subaina, Danish, Hiba and Bilal: assigned scope according to the central dashboard access rules.
- Formal tenders and RFPs route to Jawad.

Authorization is enforced in the server/runtime and database queries; it is not only a UI filter.

## Data model and persistence

Neon stores complete serialized prospect records and discovery runs. The repository contract remains the domain boundary so qualification and tests can run without a live database.

Important production tables are initialized by the Neon package. All mutations must preserve:

- Source/evidence URLs.
- Created and updated timestamps.
- Owner and activity audit history.
- Feedback and outcome history.
- Suppression and delivery audit state.

## Outreach safety

Live sending is allowed only when all of these gates pass:

```text
OUTREACH_SENDING_ENABLED=true
OUTREACH_DNS_READY=true
OUTREACH_DRY_RUN=false
OUTREACH_RAMP_STARTED_AT=<valid timestamp>
SALES_MAILBOX_PASSWORD=<configured secret>
```

The shared sender is `sales@codistan.org`. Reply-To is the assigned owner. The assigned owner and `waseem@codistan.org` are copied according to the outreach policy.

Do not change these gates merely to make a test email send. SPF, DKIM, DMARC, sender alignment and Gmail/Microsoft inbox-placement tests must pass first.

## Change rules

- Add new acquisition sources through `packages/prospect-discovery` or the retained compliant parser/ingestion boundary.
- Add production routes through `api/dashboard-runtime.ts` or a dedicated protected Vercel function.
- Do not create another dashboard, auth stack, database adapter or worker unless the current boundary cannot support the requirement.
- Source adapters must have false-positive regression tests using real failure examples.
- All lead mutations must be scoped and persisted through Neon helpers.
- External communication remains human-approved unless the formal safety policy and production gates explicitly permit it.
