# Prospect Discovery Dashboard

## Purpose

The Prospect Desk is the canonical internal workspace for discovering, qualifying, assigning and managing Codistan business opportunities.

It combines:

- Current public prospect discovery.
- Formal Tender & RFP discovery.
- Public company/contact enrichment.
- Qualification, service routing and proof matching.
- Automatic owner assignment.
- Human-reviewed outreach and reply guidance.
- Pipeline, follow-up, feedback and outcome management.

## Production architecture

```text
Vercel dashboard functions
        ↓
Scoped Prospect Desk runtime
        ↓
Neon Postgres
        ↑
Daily prospect cron + six-hour tender cron
        ↓
Public and official sources
```

The production dashboards are:

- `/prospects`
- `/tenders`

The previous `/lead-desk` application has been retired.

## General prospect discovery

The general discovery engine uses:

- Focused public search/RSS queries.
- RemoteOK only for general job/demand-signal collection, not tender qualification.
- Configured public Greenhouse and Lever sources.
- Configured public RSS feeds.
- Official company Home, About, Team, Leadership, Contact, Services, Careers, Work and Portfolio pages.

The recent-opportunity action prioritizes signals within 48 hours and accepts qualifying dated opportunities up to 78 hours old.

## Tender and RFP discovery

The formal procurement pipeline uses:

- Pakistan PPRA/EPADS.
- CanadaBuys.
- UNGM.
- Pakistan and Canadian private/nonprofit public notices.

A tender must pass source, procurement-intent, software-service, language and expiry validation before it is stored. Dictionaries, tutorials, blogs, social pages, job boards and unrelated keyword matches are rejected.

Formal procurement records include deadline, eligibility, local-presence/consortium signals, risk flags, closeability score and bid recommendation. They route to Jawad.

## Qualification and routing

Every accepted opportunity is evaluated for:

- Active requirement or current demand signal.
- Codistan service fit.
- Public contact route and decision-maker quality.
- Commercial and timing signals.
- Relevant approved proof.
- Geography, industry and compliance risk.

The assignment engine routes tenders, partnerships, direct-client work, strategic opportunities and general outreach according to the central team policy.

The dashboard recommends a compliant first channel:

- Email.
- LinkedIn manual outreach.
- WhatsApp to a verified public business number.
- Official contact form.
- Upwork manual proposal.
- Tender portal/procurement email.
- Research first.

## Access and management

- Admin and Waseem see all company leads.
- Talha sees his team scope.
- Other accounts see their assigned scope.
- Global imports, discovery, assignment and source synchronization are restricted.
- Authorization is enforced server-side and in Neon queries.

Available management actions include:

- Search, filtering and pagination.
- Owner and service-plan updates.
- Pipeline status and follow-up scheduling.
- Team activity logging.
- Qualification audit and first-outreach draft.
- Inbound-reply analysis.
- Compulsory structured feedback.

Won, lost and rejected statuses require completed feedback.

## Learning loop

Source/query priority uses completed BD feedback and outcomes:

- High relevance, accurate contacts, replies, meetings, proposals, wins and “increase” recommendations raise priority.
- Poor relevance, bad contacts, rejection and “reduce/stop” recommendations lower priority.

This is transparent rule-based learning. It does not claim autonomous model training without sufficient real outcome data.

## Scheduled jobs

```text
/api/cron/prospect-discovery   daily
/api/tender-discovery          every six hours
/api/cron/outreach             hourly, guarded
```

Named Neon locks prevent overlapping runs.

## Outreach safety

All outreach remains human-reviewed. Live SMTP sending is unavailable unless every safety gate passes. See `docs/ARCHITECTURE.md` and `docs/VERCEL_DEPLOYMENT.md`.

## Current next priorities

- Replace temporary portfolio fixtures with an approved production catalog.
- Integrate authorized manual Upwork/LinkedIn input into this dashboard and Neon.
- Improve closeability ranking and commercial outcome reporting.
- Improve source health, deliverability and CI observability.
