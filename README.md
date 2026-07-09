# Codistan Sales Automation

Internal opportunity intelligence platform for Codistan.

The objective is to identify, qualify, score, and route high-value opportunities from Upwork, LinkedIn/Sales Navigator, and future lead sources. The system should prioritize early action for warm opportunities, recommend the right Codistan profile/portfolio, and prepare human-approved outreach or proposal drafts.

## Current visible MVP

The `main` branch now contains a runnable local MVP dashboard.

You can:

1. Start the local dashboard.
2. Open it in the browser.
3. Paste an Upwork job/email text or LinkedIn/Sales Navigator signal.
4. Click **Evaluate lead**.
5. See the lead scored, routed, matched with portfolio proof, drafted for human review, saved locally, and shown in the pipeline.
6. Click a lead card to review details.
7. Update the internal status, assign an owner, add notes, copy a draft for manual review, and inspect source evidence.

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

To reset local data, use the **Reset local data** button in the dashboard or stop the server and delete the file manually:

```bash
rm -f .data/leads.json
```

The reset action only clears the local JSON demo store. It does not touch Gmail, LinkedIn, Upwork, CRM data, or any external system.

## Try the MVP flow

On the dashboard:

1. Use the **Upwork sample** or **LinkedIn sample** button.
2. Click **Evaluate lead**.
3. The result JSON will appear below the form.
4. The page reloads and the saved lead appears in the opportunity list.
5. Use saved-view chips or the search/filter bar to narrow the list.
6. Click a lead card to inspect score, recommended profile, portfolio proof, draft preview, source evidence, and red flags.
7. Use the internal-only status, owner, and notes controls to simulate BD review.
8. Use **Copy draft for manual review** to copy the generated draft. Nothing is sent automatically.

The local form sends a dev-only session token:

```text
x-sales-automation-session: dev-founder-token
```

That token is created only in the local `apps/web/src/dev.ts` server. It is not a production auth system.

## Demo screenshots

Screenshots should be added after running the MVP locally. Do not fabricate screenshots.

Recommended capture list:

1. Dashboard landing with summary cards.
2. Manual intake form with Upwork sample.
3. Evaluated result JSON after clicking **Evaluate lead**.
4. Opportunity list with saved-view chips and search/filter bar.
5. Lead detail panel with score, profile routing, source evidence, draft preview, portfolio proof, red flags, owner, status, and notes.
6. Copy-draft confirmation and reset local data flow.

Suggested folder:

```text
docs/assets/demo/
```

Suggested filenames:

```text
01-dashboard-landing.png
02-evaluate-lead.png
03-opportunity-list.png
04-lead-detail.png
05-review-actions.png
```

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

## What is implemented

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
- Saved-view chips and search/filter bar.
- Clickable lead detail view.
- Internal status, owner, and notes actions.
- Copy draft for manual review.
- Source evidence panel.
- Local data reset action.
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
- [`docs/DEMO_READINESS.md`](docs/DEMO_READINESS.md) — demo verification checklist and screenshot plan.

## Initial MVP focus

1. Upwork opportunity ingestion and scoring.
2. LinkedIn/Sales Navigator warm signal capture and scoring.
3. Codistan portfolio/profile matching.
4. Human-approved proposal/outreach draft generation.
5. Real-time alerting for high-score opportunities.
6. Dashboard and status tracking.
