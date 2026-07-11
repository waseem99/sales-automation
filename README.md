# Codistan Sales Automation

Internal prospect-acquisition and opportunity-management platform for Codistan.

## Product priorities

1. Continuously discover new prospects and current opportunities from public sources.
2. Enrich them with official company, evidence, decision-maker, and public contact details.
3. Manage outreach, responses, meetings, proposals, and outcomes in one protected dashboard.
4. Use historical source and outcome data to improve future discovery.

## Current system

### Prospect Desk

The default web route is a password-protected Prospect Desk that provides:

- Daily public-source prospect discovery.
- Manual **Run discovery now** action.
- Evidence and freshness status.
- Company website and public contact extraction.
- Signal classification: live opportunity, recent demand signal, or partnership target.
- Deduplication.
- Codistan service/profile routing and portfolio matching.
- Human-reviewed outreach drafts.
- Owner, status, comments, outreach, response, meeting, and proposal tracking.
- Source-performance and discovery-run reporting.
- HTML email digest with attached CSV for newly discovered prospects.

The previous Upwork/LinkedIn/manual Lead Desk remains available at:

```text
/lead-desk
```

## Free-first discovery sources

The first release supports:

- Bing public RSS search results using focused opportunity and partnership queries.
- RemoteOK's public feed.
- Configured public Greenhouse boards.
- Configured public Lever sites.
- Configured public RSS/RFP feeds.
- Official company Home, About, Team, Leadership, Contact, Services, Careers, Work, and Portfolio pages.

The system does not log in to LinkedIn, bypass CAPTCHAs, automate direct messages, or submit proposals.

## Run locally

```bash
pnpm install
pnpm dev
```

Open:

```text
http://localhost:3000
```

Development login password:

```text
codistan-dev-password
```

Override it locally with `ADMIN_PASSWORD`. Production requires both `ADMIN_PASSWORD` and a strong `SESSION_SECRET`.

## Discovery commands

Run one discovery pass:

```bash
pnpm prospects:run
```

Run the continuous worker:

```bash
pnpm worker:prospects
```

The production web service can run discovery automatically every 24 hours using:

```text
PROSPECT_WORKER_ENABLED=true
PROSPECT_RUN_INTERVAL_HOURS=24
PROSPECT_RUN_ON_START=true
```

## Persistence

Current lean deployment uses persistent JSON files:

```text
LOCAL_LEAD_STORE_PATH=.data/leads.json
PROSPECT_RUN_STORE_PATH=.data/prospect-runs.json
```

The repository interfaces are structured so PostgreSQL can replace JSON persistence later without rewriting the acquisition and dashboard workflows.

## Email digest

Configure SMTP and recipient settings in the deployment secret manager:

```text
PROSPECT_DIGEST_TO
PROSPECT_DIGEST_FROM
SMTP_HOST
SMTP_PORT
SMTP_SECURE
SMTP_USER
SMTP_PASSWORD
```

No digest is sent when a run finds no new prospects.

## Optional source configuration

```text
PROSPECT_SEARCH_QUERIES
PROSPECT_GREENHOUSE_BOARDS
PROSPECT_LEVER_SITES
PROSPECT_RSS_FEEDS
PROSPECT_MAX_CANDIDATES
PROSPECT_MAX_SEARCH_QUERIES
```

Lists may be comma, semicolon, or newline separated.

## Existing opportunity integrations

The repository also contains:

- Upwork email/text parsing.
- Read-only Gmail OAuth and ingestion worker foundations.
- LinkedIn/Sales Navigator signal parsing.
- Lead scoring and routing.
- Portfolio matching.
- Human-approved proposal/outreach drafting.
- Slack alert delivery.
- Audit and analytics foundations.

Upwork API marketplace monitoring remains pending API approval.

## Production deployment

The recommended deployment is the existing Docker service on Render, Railway, Fly.io, or another persistent Node host.

Required production secrets:

```text
ADMIN_PASSWORD
SESSION_SECRET
```

The included `render.yaml` configures persistent storage and the 24-hour discovery worker. Real passwords, SMTP credentials, OAuth credentials, and API keys must never be committed.

## Safety rules

- Use public or authorized sources only.
- Preserve evidence URLs and discovery timestamps.
- Do not treat a general partnership target as an active buyer.
- Do not auto-contact prospects.
- Keep all proposals, emails, LinkedIn messages, and commercial decisions human-approved.
- Do not share account passwords, browser cookies, or platform credentials.

## Documentation

- [`docs/PROSPECT_DISCOVERY_DASHBOARD.md`](docs/PROSPECT_DISCOVERY_DASHBOARD.md)
- [`docs/REPO_CLEANUP_PLAN.md`](docs/REPO_CLEANUP_PLAN.md)
- [`docs/PRODUCTION_DEPLOYMENT.md`](docs/PRODUCTION_DEPLOYMENT.md)
- [`docs/GMAIL_INGESTION.md`](docs/GMAIL_INGESTION.md)
- [`docs/QUALIFIED_LEAD_ENGINE.md`](docs/QUALIFIED_LEAD_ENGINE.md)
