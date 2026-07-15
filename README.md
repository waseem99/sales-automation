# Codistan Sales Automation

Internal opportunity-intelligence, tender-discovery and business-development workspace for Codistan.

## Current product

The production application is the **Prospect Desk**. It discovers public prospects and formal tenders, rejects weak sources, retains evidence, qualifies opportunities, assigns owners, recommends compliant next actions, prepares human-reviewed guidance, and tracks outcomes.

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
- `/delivery-health` — mailbox, outreach and automation health.

The old Local MVP Lead Desk and duplicate API runtime have been retired.

## Main capabilities

- Public prospect discovery and official company/contact enrichment.
- 78-hour recent-opportunity refresh.
- PPRA/EPADS, CanadaBuys, UNGM and private/nonprofit tender discovery.
- Strict source, procurement-intent, language and service validation.
- Scoring, qualification, automatic owner assignment and recommended contact channel.
- Scoped Neon-backed dashboard access, filtering, pagination and full-scope metrics.
- Qualification audit, first-outreach draft and inbound-reply guidance.
- Feedback, follow-up, activity, meeting, proposal and outcome tracking.
- Guarded SMTP/IMAP outreach through `sales@codistan.org`.

## Safety boundaries

The system does not scrape authenticated LinkedIn or Upwork pages, bypass platform controls, automate LinkedIn messages, submit Upwork proposals, submit tender bids, guess private contact details, or send live external outreach unless every formal safety gate is enabled.

Human review remains required for outreach, proposals, bids, pricing, legal, contractual, security, compliance and low-confidence responses.

## Technology

- TypeScript monorepo with pnpm workspaces.
- Node.js 22.
- Vercel serverless functions and Cron Jobs.
- Neon Postgres.
- Server-rendered internal dashboard.
- SMTP/IMAP through the configured Codistan mailbox provider.

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

## Production configuration

Use `.env.example` as the authoritative list of variable names. Real values belong in Vercel secrets and must never be committed.

Minimum production requirements:

```text
DATABASE_URL
ADMIN_PASSWORD
SESSION_SECRET
CRON_SECRET
```

Keep these values until deliverability verification is complete:

```text
OUTREACH_SENDING_ENABLED=false
OUTREACH_DNS_READY=false
OUTREACH_DRY_RUN=true
```

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- [`docs/PROTECTED_ROUTE_CONTRACT.md`](docs/PROTECTED_ROUTE_CONTRACT.md)
- [`docs/DEVELOPER_HANDOFF.md`](docs/DEVELOPER_HANDOFF.md)
- [`docs/CODEBASE_REVIEW.md`](docs/CODEBASE_REVIEW.md)
- [`docs/VERCEL_DEPLOYMENT.md`](docs/VERCEL_DEPLOYMENT.md)
- [`docs/PROSPECT_DISCOVERY_DASHBOARD.md`](docs/PROSPECT_DISCOVERY_DASHBOARD.md)

The open GitHub issues are the current product backlog. Historical Sprint/MVP documents are not authoritative.
