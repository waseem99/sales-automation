# Codistan Sales Automation

Internal opportunity-intelligence, tender-discovery and business-development workspace for Codistan.

## Current product

The production application is the **Prospect Desk**. It is designed to:

1. Discover current public prospects and formal procurement opportunities.
2. Reject weak, irrelevant and untrusted sources before they enter the pipeline.
3. Retain evidence, buyer context and public contact routes.
4. Score and qualify opportunities against Codistan services.
5. Assign work to the relevant BD owner.
6. Recommend the best compliant contact channel and next action.
7. Prepare human-reviewed first-outreach and reply guidance.
8. Track feedback, outreach, replies, meetings, proposals and outcomes.
9. Improve source selection from real BD results.

## Production routes

- `/prospects` — scoped Prospect Desk.
- `/tenders` — Pakistan, Canada and international Tender & RFP Pipeline.
- `/login` — internal account access.
- `/health` — non-secret runtime health.

The old Local MVP Lead Desk and duplicate API runtime have been retired.

## Main capabilities

### Prospect discovery

- Focused public search/RSS collection.
- Public Greenhouse and Lever sources where configured.
- Official company website and contact-page enrichment.
- 78-hour recent-opportunity refresh.
- Deduplication and retained source evidence.
- Automatic role-aware assignment.
- Recommended email, LinkedIn, WhatsApp, contact-form, tender-portal or research-first approach.

### Tender and RFP intelligence

- Pakistan PPRA/EPADS.
- CanadaBuys.
- UNGM.
- Pakistan/Canada private and nonprofit RFP searches.
- Strict source-host, procurement-intent, language and software-service validation.
- Deadline, eligibility, local-presence and consortium signals.
- Closeability scoring and bid recommendation.
- Automatic Jawad assignment.

### Prospect management

- Scoped access by signed-in account.
- Neon-backed filtering, pagination and full-scope metrics.
- Owner, status, follow-up, service plan and activity management.
- Compulsory BD feedback before won/lost/rejected status.
- Qualification audit and human-reviewed draft generation.
- Inbound-reply classification and recommended response guidance.

### Guarded email operations

- Shared sender: `sales@codistan.org`.
- Reply-To: assigned owner.
- CC: assigned owner and `waseem@codistan.org`.
- SMTP/IMAP reply and bounce processing.
- Follow-up and suppression controls.
- Live sending disabled unless all DNS, dry-run, ramp and mailbox gates pass.

## Safety boundaries

The system does not:

- Scrape authenticated LinkedIn or Upwork pages.
- Bypass CAPTCHAs or platform controls.
- Automate LinkedIn messages.
- Submit Upwork proposals.
- Submit tender bids.
- Guess private contact details.
- Send live external outreach unless the formal production gates are enabled.

Human review remains required for outreach, proposals, bids, pricing, legal, contractual, security, compliance and low-confidence responses.

## Technology

- TypeScript monorepo with pnpm workspaces.
- Node.js 22.
- Vercel serverless functions and Cron Jobs.
- Neon Postgres.
- Server-rendered internal dashboard.
- SMTP/IMAP through the configured Codistan mailbox provider.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for package and request-flow details.

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

Deployment-sensitive check:

```bash
pnpm deploy:check
```

See [`docs/DEVELOPER_HANDOFF.md`](docs/DEVELOPER_HANDOFF.md) before making structural changes.

## Production configuration

Use `.env.example` as the authoritative list of variable names. Real values belong in Vercel secrets and must never be committed.

Minimum production requirements:

```text
DATABASE_URL
ADMIN_PASSWORD
SESSION_SECRET
CRON_SECRET
```

Each enabled dashboard account also requires its own `*_DASHBOARD_PASSWORD` variable.

Keep these values until deliverability verification is complete:

```text
OUTREACH_SENDING_ENABLED=false
OUTREACH_DNS_READY=false
OUTREACH_DRY_RUN=true
```

Deployment instructions: [`docs/VERCEL_DEPLOYMENT.md`](docs/VERCEL_DEPLOYMENT.md).

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- [`docs/DEVELOPER_HANDOFF.md`](docs/DEVELOPER_HANDOFF.md)
- [`docs/VERCEL_DEPLOYMENT.md`](docs/VERCEL_DEPLOYMENT.md)
- [`docs/PROSPECT_DISCOVERY_DASHBOARD.md`](docs/PROSPECT_DISCOVERY_DASHBOARD.md)

The open GitHub issues are the current product backlog. Historical Sprint/MVP documents are not authoritative.
