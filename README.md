# Codistan Sales Automation

Internal opportunity-intelligence, tender-discovery and business-development workspace for Codistan.

## Current product

The production application is the **Prospect Desk**, operated with the Windows-first **TalentTrack Pilot** acquisition runtime. Together they discover public prospects and formal tenders, retain evidence, qualify opportunities, assign owners, recommend compliant next actions, prepare human-reviewed outreach, track manually completed contact actions, and measure commercial outcomes.

The authoritative TalentTrack release identity, component states, installer vocabulary and rollback policy are documented in [`docs/TALENTTRACK_RELEASE_BASELINE.md`](docs/TALENTTRACK_RELEASE_BASELINE.md). Optional local PostgreSQL operations are documented in [`docs/TALENTTRACK_LOCAL_POSTGRES.md`](docs/TALENTTRACK_LOCAL_POSTGRES.md).

## Production routes

Public and authentication routes:

- `/login` — internal account access.
- `/health` — non-secret runtime health.

Authenticated workspaces:

- `/prospects` — scoped Prospect Desk.
- `/priorities` — owner and team priority queue.
- `/leads/*` — source and procurement workspaces.
- `/services/*` — service-specific workspaces.
- `/lead-signals` — unified Upwork and LinkedIn signal intake.
- `/linkedin-signals` — LinkedIn and Sales Navigator signal review.
- `/tenders` — Pakistan, Canada and international Tender & RFP Pipeline.
- `/portfolio` — approved proof and case-study catalog.
- `/re-engagement` — previous-client and dormant-opportunity workspace.
- `/operations` — source quality and commercial operations controls.
- `/commercial-analytics` — real-event funnel analytics and management keep/change/stop calibration.
- `/delivery-health` — mailbox, outreach and automation health.

The old Local MVP Lead Desk and duplicate API runtime have been retired.

## Main capabilities

- Public prospect discovery and official company/contact enrichment.
- Approved Upwork, LinkedIn warm and Sales Navigator cold acquisition lanes.
- PPRA/EPADS, CanadaBuys, UNGM and private/nonprofit tender discovery.
- Strict source, procurement-intent, language and service validation.
- Scoring, qualification, owner assignment and recommended contact channel.
- Scoped PostgreSQL-backed dashboard access, filtering, pagination and metrics.
- Optional local PostgreSQL collector storage with one-time JSON import and JSON rollback shadow.
- BD tasks, follow-ups and evidence-grounded next-best-action.
- Exact outreach revision approval and immutable manual-send history.
- Qualification audit, portfolio proof and inbound-reply guidance.
- Explicit pipeline/proposal/won-value entry without currency conversion or inferred revenue.
- Management-reviewed source and campaign keep/change/stop decisions.

## Safety boundaries

The system does not scrape authenticated LinkedIn or Upwork pages, bypass platform controls, automate LinkedIn messages, submit Upwork proposals, submit tender bids, guess private contact details, or send live external outreach unless every formal safety gate is enabled.

TalentTrack Pilot keeps every external proposal, message, InMail, connection request, comment, reaction, follow and email human-controlled. Human review also remains required for pricing, legal, contractual, security, compliance and low-confidence responses.

## Technology

- TypeScript monorepo with pnpm workspaces.
- Python 3.12 Windows acquisition runtime.
- Node.js 22.
- Vercel serverless functions and Cron Jobs.
- PostgreSQL through the current Neon production boundary.
- Optional loopback-only PostgreSQL 16 container for local collector state.
- Server-rendered internal dashboard.
- Normal logged-in Chrome extensions for approved source capture.

## Developer setup

```bash
pnpm install --no-frozen-lockfile
cp .env.example .env.local
pnpm dev
```

Open `http://localhost:3000`.

Required checks:

```bash
pnpm typecheck
pnpm test
pnpm build
```

Deployment-sensitive checks:

```bash
pnpm test:protected-routes
pnpm deploy:check
```

## TalentTrack Windows setup

From `workers\acquisition`, run:

```text
START-HERE-TALENTTRACK.cmd
```

State and captured records remain under:

```text
%LOCALAPPDATA%\Codistan\Acquisition
```

Use `CHECK-TALENTTRACK.cmd`, `DIAGNOSE-TALENTTRACK.cmd` and `ROLLBACK-TALENTTRACK.cmd` for health, safe diagnostics and state-preserving rollback.

JSONL remains the default local collector store. After Docker Desktop is installed, `ENABLE-TALENTTRACK-POSTGRES.cmd` can make local PostgreSQL authoritative while preserving a continuously updated JSON rollback shadow. Use the dedicated Check, Backup and Restore commands rather than deleting the container volume or secret file.

## Production configuration

Use `.env.example` as the authoritative list of variable names. Real values belong in deployment or local secret stores and must never be committed.

Minimum production requirements:

```text
DATABASE_URL
ADMIN_PASSWORD
SESSION_SECRET
CRON_SECRET
```

Keep live-outreach values disabled until a separately approved release passes deliverability, security, compliance and commercial gates:

```text
OUTREACH_SENDING_ENABLED=false
OUTREACH_DNS_READY=false
OUTREACH_DRY_RUN=true
```

## Documentation

- [`docs/TALENTTRACK_RELEASE_BASELINE.md`](docs/TALENTTRACK_RELEASE_BASELINE.md)
- [`docs/TALENTTRACK_LOCAL_POSTGRES.md`](docs/TALENTTRACK_LOCAL_POSTGRES.md)
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- [`docs/PROTECTED_ROUTE_CONTRACT.md`](docs/PROTECTED_ROUTE_CONTRACT.md)
- [`docs/DEVELOPER_HANDOFF.md`](docs/DEVELOPER_HANDOFF.md)
- [`docs/CODEBASE_REVIEW.md`](docs/CODEBASE_REVIEW.md)
- [`docs/VERCEL_DEPLOYMENT.md`](docs/VERCEL_DEPLOYMENT.md)
- [`docs/PROSPECT_DISCOVERY_DASHBOARD.md`](docs/PROSPECT_DISCOVERY_DASHBOARD.md)

The open GitHub issues are the current product backlog. Historical Sprint/MVP documents are not authoritative.
