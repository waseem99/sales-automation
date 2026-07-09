# Codistan Sales Automation

Internal opportunity intelligence platform for Codistan.

The objective is to identify, qualify, score, and route high-value opportunities from Upwork, LinkedIn/Sales Navigator, and future lead sources. The system should prioritize early action for warm opportunities, recommend the right Codistan profile/portfolio, and prepare human-approved outreach or proposal drafts.

## Current visible MVP

The current branch contains a runnable local MVP dashboard.

You can:

1. Start the local dashboard.
2. Open it in the browser.
3. Paste an Upwork job/email text or LinkedIn/Sales Navigator signal.
4. Click **Evaluate lead**.
5. See the lead scored, routed, matched with portfolio proof, drafted for human review, saved locally, and shown in the pipeline.

This is intentionally local/mock-first. It does **not** scrape, auto-bid, auto-DM, send email, modify Gmail, or contact prospects.

## Run locally

```bash
pnpm install
pnpm --filter @sales-automation/web dev
```

Then open:

```text
http://localhost:3000
```

The local dashboard uses:

```text
.data/leads.json
```

If you want to reset local data, stop the server and delete that file.

## Try the MVP flow

On the dashboard:

1. Use the **Upwork sample** or **LinkedIn sample** button.
2. Click **Evaluate lead**.
3. The result JSON will appear below the form.
4. The page reloads and the saved lead appears in the opportunity list.

The local form sends a dev-only session token:

```text
x-sales-automation-session: dev-founder-token
```

That token is created only in the local `apps/web/src/dev.ts` server. It is not a production auth system.

## Environment variables

Copy the example file when needed:

```bash
cp .env.example .env
```

Do not commit `.env`.

Credentials for Gmail, Slack, WhatsApp, enrichment providers, or future production services must stay in `.env` or deployment secrets. The current MVP works without those credentials.

## Core safety principles

Do not build an unsafe scraping or auto-spam tool. Build a compliant sales intelligence and decision-support system:

- Capture leads from approved/safe sources.
- Run warm lead checks frequently, initially every 30 minutes.
- Score leads using Codistan-specific qualification criteria.
- Alert humans when timing matters.
- Recommend profile, portfolio proof, positioning, and draft response.
- Keep final sending/bidding human-approved.

## What is implemented in this branch

- Monorepo workspace.
- Shared lead/profile/portfolio types.
- Upwork email/text parser.
- LinkedIn/Sales Navigator signal parser.
- Lead scoring.
- Profile routing.
- Portfolio matching.
- Human-approved draft generation.
- Safe alert planning and dry-run delivery adapters.
- Local JSON persistence.
- Dashboard list/detail models.
- Lightweight local web dashboard.
- Manual lead intake form.
- Read-only email source foundation.
- Auth/session foundation with read-only anonymous fallback.
- Enrichment policy and human-verification model.
- Analytics/calibration report foundation.

## What is not implemented yet

- Real Gmail API runtime wiring.
- Real LinkedIn/Sales Navigator API access.
- Real external Slack/WhatsApp/email alert delivery.
- Real enrichment provider integration.
- Production database.
- Production authentication provider.
- Full interactive frontend application beyond the lightweight MVP dashboard.

## Planning docs

- [`docs/BACKLOG.md`](docs/BACKLOG.md) — full epic and task backlog.
- [`docs/SPRINT_1.md`](docs/SPRINT_1.md) — current sprint implementation summary.

## Initial MVP focus

1. Upwork opportunity ingestion and scoring.
2. LinkedIn/Sales Navigator warm signal capture and scoring.
3. Codistan portfolio/profile matching.
4. Human-approved proposal/outreach draft generation.
5. Real-time alerting for high-score opportunities.
6. Dashboard and status tracking.
