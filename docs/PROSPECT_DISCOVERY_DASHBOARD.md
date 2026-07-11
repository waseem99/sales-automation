# Prospect Discovery Dashboard

## Product priority

1. Continuously discover new external prospects from public sources.
2. Store evidence, company details, decision-makers, and public contact routes.
3. Let the BD team manage outreach, responses, meetings, proposals, and outcomes from one protected dashboard.
4. Use source/reply/win history later to improve discovery queries and source selection.

## What is reused

The existing repository already contains reusable lead evaluation, scoring, profile routing, portfolio matching, drafting, local persistence, audit logging, and pipeline status handling. The new implementation keeps those packages and adds a dedicated public-source discovery package plus a protected Prospect Desk UI.

The original Lead Desk remains available at `/lead-desk` for Upwork, LinkedIn, and manual intake. The new default route `/` is the Prospect Desk.

## Daily discovery sources

The first lean release uses sources that do not require paid data-provider APIs:

- Bing public RSS search results using focused opportunity and partnership queries.
- RemoteOK's public machine-readable job feed.
- Configured public Greenhouse boards.
- Configured public Lever sites.
- Configured public RSS feeds, including RFP or industry feeds.
- Official company websites and public About, Team, Leadership, Contact, Services, Careers, Work, and Portfolio pages.

The worker does not log in to LinkedIn, bypass access controls, solve CAPTCHAs, or automatically contact prospects.

## Discovery process

```text
Every 24 hours
→ collect current source results
→ remove stale or irrelevant results
→ resolve the official company website
→ crawl public company/contact pages
→ extract public decision-maker and contact details
→ classify signal as live opportunity, demand signal, or partnership target
→ deduplicate against stored prospects
→ evaluate and match Codistan proof
→ save to the Prospect Desk
→ email the new-prospect digest and CSV
```

Only records meeting minimum quality requirements are stored. Partnership targets require an active company website and a usable public contact route or named decision-maker. Current opportunities can be stored with source evidence while contact enrichment continues.

## Commands

```bash
pnpm prospects:run
pnpm worker:prospects
pnpm dev
```

`pnpm prospects:run` executes one discovery pass. `pnpm worker:prospects` runs immediately and repeats according to `PROSPECT_RUN_INTERVAL_HOURS`. The production web service can run the same worker in-process with `PROSPECT_WORKER_ENABLED=true`.

## Required production settings

Set these only in the hosting secret manager:

```text
ADMIN_PASSWORD
SESSION_SECRET
PROSPECT_DIGEST_TO
PROSPECT_DIGEST_FROM
SMTP_HOST
SMTP_PORT
SMTP_SECURE
SMTP_USER
SMTP_PASSWORD
```

Core runtime values:

```text
LOCAL_LEAD_STORE_PATH=/data/leads.json
PROSPECT_RUN_STORE_PATH=/data/prospect-runs.json
PROSPECT_WORKER_ENABLED=true
PROSPECT_RUN_INTERVAL_HOURS=24
PROSPECT_RUN_ON_START=true
PROSPECT_MAX_CANDIDATES=50
```

Optional source lists:

```text
PROSPECT_SEARCH_QUERIES
PROSPECT_GREENHOUSE_BOARDS
PROSPECT_LEVER_SITES
PROSPECT_RSS_FEEDS
```

Lists may be comma, semicolon, or newline separated.

## Dashboard functions

The protected dashboard provides:

- Admin-password login using an HTTP-only signed session cookie.
- New-today, live-opportunity, partnership, contacted, replied, meeting, and won metrics.
- Search and filters by pipeline status and signal type.
- Company, contact, evidence, source, service match, portfolio proof, and draft details.
- Owner assignment and pipeline status management.
- Structured activity entry for comments, outreach, replies, meetings, and proposals.
- Audit history showing actor and time.
- Source-performance table based on contacted, replied, and won outcomes.
- Discovery-run history and a Run Discovery Now action.

All external outreach remains human-approved.

## Repository cleanup applied

- The existing dashboard/evaluation/storage packages remain the shared core.
- Public prospect discovery is isolated in `packages/prospect-discovery` rather than adding source-specific logic to the web app.
- The production entry point no longer seeds demo leads unless `SEED_SAMPLE_DATA=true`.
- The fixed development session token is no longer the default web-access mechanism.
- The default UI is now the prospect-focused dashboard; the old dashboard remains available for existing workflows.
- Discovery run history is stored separately from lead records.
- Production secrets are environment variables and are never committed.

## Next cleanup after initial production validation

After the first real prospect batches are reviewed:

1. Replace local JSON persistence with PostgreSQL while keeping repository interfaces stable.
2. Move the in-process scheduler to a dedicated worker service when traffic or discovery volume grows.
3. Replace sample portfolio data with the approved production portfolio file/database.
4. Remove stale demo-only documentation and Vercel preview workarounds after the Docker deployment is stable.
5. Add source-level precision metrics so low-value queries are disabled automatically.
