# Prospect Discovery Dashboard

## Product priority

1. Continuously discover new external prospects from public sources.
2. Store evidence, company details, decision-makers, and public contact routes.
3. Let BD manage outreach, responses, meetings, proposals, and outcomes from one protected dashboard.
4. Require structured feedback and use it to improve future source priority.

## Production architecture

```text
Vercel dashboard and API functions
        ↓
Neon Postgres
        ↑
Vercel daily Cron
        ↓
Public discovery sources and company websites
        ↓
Existing-domain SMTP mailbox
        ↓
Daily internal BD digest and CSV
```

The original Lead Desk remains available at `/lead-desk`. The Prospect Desk is the default route.

## Daily discovery sources

The lean release uses sources that do not require paid data-provider APIs:

- Bing public RSS searches using focused opportunity and partnership queries.
- RemoteOK public feed.
- Configured public Greenhouse boards.
- Configured public Lever sites.
- Configured public RSS and RFP feeds.
- Official company Home, About, Team, Leadership, Contact, Services, Careers, Work, and Portfolio pages.

The system does not log in to LinkedIn, bypass access controls, solve CAPTCHAs, or automatically contact prospects.

## Discovery process

```text
Daily Vercel Cron
→ acquire Neon run lock
→ collect current source results
→ remove stale and duplicate items
→ resolve official company websites
→ crawl public company/contact pages
→ extract public contacts and decision-makers
→ classify opportunity, demand signal, or partnership target
→ evaluate and match Codistan proof
→ save to Neon
→ email the new-prospect digest and CSV
→ release run lock
```

Only records meeting minimum quality requirements are stored. General partnership targets require an active company website and a usable public contact route or named decision-maker.

## Required Vercel settings

```text
DATABASE_URL
ADMIN_PASSWORD
SESSION_SECRET
CRON_SECRET
DASHBOARD_ACTOR
PROSPECT_DIGEST_TO
PROSPECT_DIGEST_FROM
SMTP_HOST
SMTP_PORT
SMTP_SECURE
SMTP_USER
SMTP_PASSWORD
```

An existing mailbox on the current domain can be used. No new subdomain is required.

Recommended lean limits:

```text
PROSPECT_MAX_CANDIDATES=15
PROSPECT_MAX_SEARCH_QUERIES=10
```

Optional source lists:

```text
PROSPECT_SEARCH_QUERIES
PROSPECT_GREENHOUSE_BOARDS
PROSPECT_LEVER_SITES
PROSPECT_RSS_FEEDS
```

## Dashboard functions

- Fixed admin-password login using an HTTP-only signed session cookie.
- New-today, live-opportunity, contacted, replied, meeting, won, and feedback-pending metrics.
- Search and filtering by pipeline, signal, and feedback status.
- Company, contact, evidence, source, service match, proof, and draft details.
- Owner assignment and pipeline management.
- Structured comments, outreach, replies, meetings, and proposal activities.
- Compulsory BD feedback.
- Source-learning table using ratings, replies, and wins.
- Discovery-run and email-delivery history.
- Manual **Run discovery now** action.

All external outreach remains human-approved.

## Compulsory feedback

Every new prospect starts as feedback pending. BD must record:

- Relevance rating from 1–5.
- Contact accuracy.
- Source quality.
- Increase, keep, reduce, or stop using the source.
- Corrected service category where needed.
- Explanation.

Won, lost, and rejected statuses are blocked until feedback is complete.

Future discovery ordering uses:

- Positive relevance ratings.
- Replies, meetings, proposals, and wins.
- Increase/keep recommendations.
- Rejection, poor source quality, and reduce/stop recommendations.

The first release learns at source/query level. It does not claim autonomous model training before enough real feedback exists.

## Persistence

Neon stores complete prospect records as JSONB while preserving the existing repository interfaces. It also stores discovery runs and a distributed cron lock.

Tables are created automatically:

```text
prospect_records
prospect_discovery_runs
prospect_run_locks
```

## Cleanup applied

- Removed the obsolete Render deployment configuration.
- Replaced production JSON-file persistence with Neon.
- Replaced the in-process production timer with Vercel Cron.
- Kept local JSON development support.
- Reused evaluator, routing, portfolio, drafting, audit, and dashboard packages.
- Kept secrets in Vercel environment variables.
- Kept the legacy Lead Desk for Upwork/Gmail workflows.

## Next phase after live validation

1. Replace sample portfolio fixtures with approved production portfolio data.
2. Measure source precision using at least several weeks of BD feedback.
3. Disable consistently poor queries automatically.
4. Add more free and paid acquisition sources based on measured performance.
5. Add individual BD accounts only when one shared admin login becomes limiting.
