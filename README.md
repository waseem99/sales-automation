# Codistan Sales Automation

Internal prospect-acquisition and opportunity-management platform for Codistan.

## Product priorities

1. Continuously discover new prospects and current opportunities from public sources.
2. Enrich them with company, evidence, decision-maker, and public contact details.
3. Manage outreach, replies, meetings, proposals, and outcomes in one protected dashboard.
4. Use compulsory BD feedback and outcomes to improve future source selection.

## Prospect Desk

The default route provides:

- Daily public-source prospect discovery through Vercel Cron.
- Manual **Run discovery now** action.
- Neon Postgres persistence.
- Company website and public contact extraction.
- Live opportunity, demand signal, and partnership-target classification.
- Deduplication and source evidence.
- Codistan service/profile routing and portfolio matching.
- Human-reviewed outreach drafts.
- Owner, status, comments, outreach, reply, meeting, and proposal tracking.
- Compulsory structured BD feedback.
- Source-learning and discovery-run reporting.
- Daily HTML email with a CSV attachment for newly discovered prospects.

The previous Upwork/LinkedIn/manual Lead Desk remains at `/lead-desk`.

## Free-first discovery sources

- Bing public RSS search results using focused queries.
- RemoteOK public feed.
- Configured public Greenhouse boards.
- Configured public Lever sites.
- Configured public RSS and RFP feeds.
- Official company Home, About, Team, Leadership, Contact, Services, Careers, Work, and Portfolio pages.

The system does not log in to LinkedIn, bypass CAPTCHAs, automate direct messages, or submit proposals.

## Vercel production setup

1. Import this GitHub repository into Vercel.
2. Add a Neon Postgres integration/database to the project.
3. Confirm Vercel created `DATABASE_URL`.
4. Add the remaining environment variables from `config/prospect.env.example`.
5. Deploy.
6. Log in and run one manual discovery pass.
7. Confirm the daily Cron Job and internal email digest.

Detailed instructions: [`docs/VERCEL_DEPLOYMENT.md`](docs/VERCEL_DEPLOYMENT.md)

The scheduled route is:

```text
/api/cron/prospect-discovery
```

The schedule in `vercel.json` is `0 4 * * *`, which targets the 04:00 UTC hour each day.

## Existing-domain email

A subdomain is not required. Use the outgoing SMTP credentials of an existing mailbox on the current domain:

```text
PROSPECT_DIGEST_TO
PROSPECT_DIGEST_FROM
SMTP_HOST
SMTP_PORT
SMTP_SECURE
SMTP_USER
SMTP_PASSWORD
```

Multiple internal recipients may be comma-separated in `PROSPECT_DIGEST_TO`. No digest is sent when no new prospects are found.

## Required production variables

```text
DATABASE_URL
ADMIN_PASSWORD
SESSION_SECRET
CRON_SECRET
```

Never commit real values or share them in chat.

## Optional discovery configuration

```text
PROSPECT_SEARCH_QUERIES
PROSPECT_GREENHOUSE_BOARDS
PROSPECT_LEVER_SITES
PROSPECT_RSS_FEEDS
PROSPECT_MAX_CANDIDATES
PROSPECT_MAX_SEARCH_QUERIES
```

The Vercel defaults process up to 15 candidates and 10 search queries per run to remain lean.

## Local development

```bash
pnpm install
pnpm dev
```

Open `http://localhost:3000`. The local development password is `codistan-dev-password`; override it with `ADMIN_PASSWORD`.

Run one discovery pass locally:

```bash
pnpm prospects:run
```

## BD feedback loop

Every new prospect starts with feedback pending. BD records:

- Relevance from 1–5.
- Contact accuracy.
- Source quality.
- Whether to increase, keep, reduce, or stop using the source.
- Corrected service category where needed.
- A reason explaining the result.

A prospect cannot be marked won, lost, or rejected until this feedback is complete. Future discovery runs use this history, together with replies and wins, to adjust source priority.

## Existing integrations

- Upwork email/text parsing.
- Read-only Gmail OAuth and worker foundations.
- LinkedIn/Sales Navigator signal parsing.
- Lead scoring and routing.
- Portfolio matching.
- Human-approved proposal/outreach drafting.
- Slack alerts and analytics foundations.

Upwork API marketplace monitoring remains pending API approval.

## Safety rules

- Use public or authorized sources only.
- Preserve evidence URLs and discovery timestamps.
- Do not treat a partnership target as a confirmed buyer.
- Do not auto-contact prospects.
- Keep all proposals and outreach human-approved.
- Do not share passwords, cookies, OAuth secrets, or SMTP credentials.

## Documentation

- [`docs/VERCEL_DEPLOYMENT.md`](docs/VERCEL_DEPLOYMENT.md)
- [`docs/PROSPECT_DISCOVERY_DASHBOARD.md`](docs/PROSPECT_DISCOVERY_DASHBOARD.md)
- [`docs/REPO_CLEANUP_PLAN.md`](docs/REPO_CLEANUP_PLAN.md)
- [`docs/GMAIL_INGESTION.md`](docs/GMAIL_INGESTION.md)
- [`docs/QUALIFIED_LEAD_ENGINE.md`](docs/QUALIFIED_LEAD_ENGINE.md)
