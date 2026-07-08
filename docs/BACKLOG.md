# Codistan Sales Automation — Product Backlog

## 1. Product Goal

Build an internal AI-powered opportunity intelligence system for Codistan that can continuously find, qualify, score, route, and prepare responses for high-value sales opportunities.

The first version focuses on:

1. Upwork opportunities.
2. LinkedIn/Sales Navigator warm leads.
3. Partner/collaboration prospects.
4. Solution-led prospecting campaigns.
5. Codistan portfolio/profile matching.
6. Human-approved proposal and outreach drafting.

The system should not be limited to a fixed daily count such as "top 10 jobs" or "top 5 leads". Instead, it should use qualification thresholds and urgency rules.

---

## 2. Key Product Correction

Timing matters heavily for warm opportunities.

### Upwork

For fresh Upwork jobs, early response can materially improve visibility and chances of receiving a client view/interview. Therefore, the system should check for new qualifying jobs on a frequent cadence, initially every 30 minutes.

### LinkedIn

For warm LinkedIn signals, such as someone posting that they are looking for a developer, AI agency, website team, automation expert, AR/3D team, or outsourcing partner, speed also matters. The system should capture and alert on these signals quickly.

### Cold / partner prospecting

Cold partner/account prospecting does not need 30-minute urgency. It can run daily or weekly, because the buyer has not posted an immediate need.

---

## 3. Source Cadence Rules

| Source | Lead Type | Cadence | Action Type |
|---|---|---:|---|
| Upwork | Fresh job post | Every 30 minutes | Urgent score + alert if qualified |
| Upwork | Saved job digest/email | Every 30 minutes | Parse + score |
| LinkedIn/Sales Navigator | Warm lead signal/post | Every 30 minutes where available | Urgent score + alert if qualified |
| LinkedIn/Sales Navigator | Saved account/lead alert | Every 1-4 hours or email-driven | Score + route |
| Partner prospecting | Cold B2B account discovery | Daily/weekly | Queue for review |
| Solution campaign | Airline/refund/banking prospect list | Daily/weekly | Enrich + queue |
| Manual submission | User submits URL/lead | Immediate | Score + route |

---

## 4. Qualification Thresholds

The product should not output a fixed count. It should output every opportunity above the relevant threshold.

| Lead Type | Hot Alert | Qualified Queue | Nurture / Watch | Reject |
|---|---:|---:|---:|---:|
| Upwork job | 80+ | 65-79 | 50-64 | <50 |
| LinkedIn warm signal | 75+ | 60-74 | 45-59 | <45 |
| Partner prospect | 80+ | 65-79 | 50-64 | <50 |
| Solution-led prospect | 80+ | 65-79 | 50-64 | <50 |

### Urgency rules

- Upwork job posted within the last 60 minutes and score >= 75 should trigger an urgent alert.
- Upwork job score >= 85 should trigger an urgent alert regardless of exact posting age, unless proposals are already too high or budget is weak.
- LinkedIn warm post within the last 2 hours and score >= 70 should trigger an urgent alert.
- LinkedIn warm post score >= 80 should trigger an urgent alert even if older, provided the signal is still relevant.
- Cold partner prospects should not interrupt the team unless score >= 90 or there is a direct buying trigger.

---

## 5. Non-Negotiable Compliance Rules

The system must avoid risky behavior that can damage profiles or accounts.

- No unauthorized Upwork scraping.
- No Upwork auto-bidding without human approval.
- No LinkedIn scraping bot.
- No LinkedIn auto-DM bot.
- No fake account workflow.
- No account-sharing workflow.
- No automatic sending of proposals/messages unless explicitly enabled later with compliance review.
- Human must approve final bid/outreach.
- Store source URL, evidence, and reasoning for every recommendation.

---

## 6. Lead Object Data Model

Every captured opportunity should be normalized into one lead object.

### Required fields

- `id`
- `source`
- `source_url`
- `source_type`
- `lead_type`
- `title`
- `description`
- `company_name`
- `contact_name`
- `contact_role`
- `country`
- `region`
- `industry`
- `service_category`
- `budget_signal`
- `timeline_signal`
- `posted_at`
- `captured_at`
- `freshness_minutes`
- `raw_payload`
- `qualification_score`
- `score_breakdown`
- `qualification_status`
- `urgency_status`
- `recommended_profile`
- `recommended_portfolio_items`
- `recommended_next_action`
- `draft_message`
- `red_flags`
- `owner`
- `pipeline_status`
- `outcome`
- `created_at`
- `updated_at`

### Lead type enum

- `upwork_job`
- `linkedin_warm_post`
- `linkedin_sales_nav_alert`
- `partner_prospect`
- `solution_led_prospect`
- `manual_lead`
- `future_source`

### Pipeline status enum

- `new`
- `scored`
- `hot_alert_sent`
- `needs_human_review`
- `approved_to_contact`
- `draft_ready`
- `sent_manually`
- `replied`
- `meeting_booked`
- `proposal_sent`
- `won`
- `lost`
- `rejected`
- `archived`

---

# EPIC 01 — Product Foundation and Repo Setup

## Goal

Create the technical foundation for the internal lead intelligence product.

## Tasks

### 01.01 Define product configuration structure

Create a config-driven structure for:

- Source cadences.
- Qualification thresholds.
- Service categories.
- Profile routing rules.
- Portfolio matching tags.
- Alert channels.
- Rejection rules.

Acceptance criteria:

- Config can be edited without changing core code.
- Default thresholds match this backlog.
- Separate config exists for Upwork, LinkedIn, partner, and solution-led campaigns.

### 01.02 Create project folder structure

Suggested structure:

```txt
/apps
  /web
  /worker
  /api
/packages
  /db
  /ai
  /scoring
  /integrations
  /shared
/docs
/scripts
```

Acceptance criteria:

- Repo has clear folders for web app, worker jobs, integrations, shared types, AI prompts, and docs.
- README explains local setup.

### 01.03 Select MVP stack

Recommended MVP stack:

- Next.js for dashboard.
- Node.js/TypeScript for API and workers.
- PostgreSQL/Supabase for database.
- pgvector for portfolio/lead similarity.
- n8n or internal cron workers for scheduled ingestion.
- OpenAI/Claude/Gemini abstraction layer.

Acceptance criteria:

- Stack decision is documented.
- Environment variables are documented.
- Local dev setup can run without production secrets.

### 01.04 Add environment and secret management

Acceptance criteria:

- `.env.example` exists.
- No real secrets committed.
- Required secrets are documented.
- Separate dev/staging/prod values can be supported.

---

# EPIC 02 — Upwork Opportunity Ingestion

## Goal

Capture Upwork opportunities frequently and safely, without relying on unauthorized scraping.

## Key rule

Upwork warm jobs should be checked every 30 minutes because early application matters.

## Tasks

### 02.01 Define allowed Upwork ingestion methods

Supported methods for MVP:

- Upwork job alert emails.
- Upwork saved search emails/digests.
- Manual job URL submission.
- Recommended jobs email parsing.
- Official Upwork API only if approved and available.

Acceptance criteria:

- System has source adapters for email/manual ingestion.
- Official API adapter is optional and feature-flagged.
- Unauthorized scraping is explicitly not implemented.

### 02.02 Create Upwork email parser

Parse incoming job alert/digest emails.

Extract:

- Job title.
- Job URL.
- Description snippet.
- Budget/hourly signal.
- Skills.
- Client country if available.
- Posted time if available.
- Email received time.

Acceptance criteria:

- Parser handles multiple jobs in one digest.
- Duplicate job URLs are ignored.
- Captured jobs are inserted into the normalized lead table.

### 02.03 Create manual Upwork job submission form/API

Users should be able to paste a job URL and optional notes.

Acceptance criteria:

- Manual submission immediately creates/updates a lead record.
- System marks source as `manual_lead` or `upwork_job`.
- Manual submissions run scoring immediately.

### 02.04 Create 30-minute Upwork ingestion worker

Acceptance criteria:

- Worker runs every 30 minutes.
- Worker processes new Upwork emails/jobs.
- Worker deduplicates jobs.
- Worker triggers scoring after capture.
- Worker logs success/failure.

### 02.05 Add Upwork red flag detection

Red flags:

- Very low budget.
- Vague one-line scope.
- Too many proposals already, if available.
- Unrealistic deadline.
- Client asks for free work.
- Work does not match Codistan strengths.
- Compliance risk.
- US-only mismatch risk.

Acceptance criteria:

- Red flags are stored in lead record.
- Red flags reduce score.
- Severe red flags can auto-reject.

### 02.06 Create Upwork source freshness logic

Acceptance criteria:

- System calculates `freshness_minutes`.
- Fresh jobs are prioritized.
- Job age affects urgency score.
- Hot jobs can alert immediately.

---

# EPIC 03 — LinkedIn and Sales Navigator Warm Signal Ingestion

## Goal

Capture LinkedIn warm leads and Sales Navigator signals safely and quickly.

## Key rule

LinkedIn warm demand signals should be checked frequently where possible, ideally every 30 minutes through safe sources such as alerts/emails/manual capture.

## Tasks

### 03.01 Define safe LinkedIn ingestion methods

Supported MVP methods:

- Sales Navigator saved search alerts.
- Sales Navigator email alerts.
- Manual LinkedIn post/profile URL submission.
- Team-submitted screenshots/notes.
- Public web search results where allowed.
- CRM/manual import later.

Acceptance criteria:

- No LinkedIn scraping bot is implemented.
- No auto-DM is implemented.
- Manual/human-approved interaction remains the default.

### 03.02 Create LinkedIn warm lead parser

Extract:

- Person name.
- Role/title.
- Company.
- Post text or signal summary.
- Source URL.
- Signal type.
- Posted/captured time.
- Service need.
- Urgency clues.

Acceptance criteria:

- Parser supports manually pasted post text.
- Parser supports alert email text.
- System stores the original evidence.

### 03.03 Define LinkedIn signal taxonomy

Signal types:

- `looking_for_developer`
- `looking_for_ai_partner`
- `looking_for_website_team`
- `looking_for_automation_help`
- `looking_for_ar_3d_team`
- `agency_needs_delivery_partner`
- `hiring_engineering_team`
- `funding_or_growth_signal`
- `solution_relevant_pain`
- `other`

Acceptance criteria:

- Every LinkedIn lead gets a signal type.
- Signal type affects scoring and recommended action.

### 03.04 Create 30-minute warm signal check

Acceptance criteria:

- Worker checks new LinkedIn/Sales Navigator alert inputs every 30 minutes where available.
- New warm leads are scored immediately.
- High-score warm leads trigger alert.

### 03.05 Create LinkedIn warm lead urgency rules

Acceptance criteria:

- Post age <= 2 hours increases urgency.
- Direct buying language increases urgency.
- Founder/decision-maker posts increase urgency.
- Warm mutual connection signal increases urgency.

---

# EPIC 04 — Partner and Outsourcing Prospecting

## Goal

Identify companies that can become Codistan’s recurring white-label or outsourced delivery partners.

## Target accounts

- US software companies.
- Digital agencies.
- AI consultants.
- Web design agencies.
- Marketing agencies needing technical execution.
- Product studios.
- Cybersecurity consultants needing implementation support.
- Salesforce/HubSpot/ERP consultants.

## Tasks

### 04.01 Define partner ICP

Acceptance criteria:

- ICP includes geography, company size, services, buyer roles, and budget signals.
- ICP supports multiple segments: agency partner, software partner, AI consultant partner, enterprise implementation partner.

### 04.02 Build partner prospect data model

Fields:

- Company name.
- Website.
- Country.
- Industry.
- Team size.
- Services offered.
- Gaps Codistan can fill.
- Decision makers.
- Best outreach angle.
- Score.
- Status.

Acceptance criteria:

- Partner prospects use same lead pipeline where possible.
- Partner-specific fields are supported.

### 04.03 Create partner scoring model

Scoring factors:

- Fit with Codistan delivery strengths.
- Likelihood of outsourcing.
- Company size.
- Geography.
- Service gap.
- Decision-maker availability.
- Proof/portfolio match.
- Recurring revenue potential.

Acceptance criteria:

- Partner prospects receive 0-100 score.
- Score >= 80 triggers priority review.
- Score 65-79 goes to partner queue.

### 04.04 Create partner outreach draft generator

Acceptance criteria:

- Drafts are partnership-oriented, not generic sales pitches.
- Message clearly says Codistan can work as a white-label/offshore delivery partner.
- Draft includes relevant service proof.
- Draft avoids spammy wording.

---

# EPIC 05 — Solution-Led Prospecting Campaigns

## Goal

Support campaigns for Codistan-owned/reusable solutions, such as airline refund automation and private intelligence for banking/financial institutions.

## Initial campaigns

1. Airline refund automation.
2. Private intelligence for banking/financial institutions.
3. AI automation for enterprises.
4. Website intelligence layer for B2B companies.

## Tasks

### 05.01 Create solution catalog

Each solution should include:

- Name.
- Target industry.
- Buyer personas.
- Pain points.
- Benefits.
- Proof/assets.
- Required qualification criteria.
- Exclusion criteria.

Acceptance criteria:

- At least 2 initial solutions are supported.
- Solution catalog is editable.

### 05.02 Define airline refund automation ICP

Target personas:

- Head of Customer Experience.
- Refund Operations.
- Digital Transformation.
- Operations Director.
- CIO/CTO.
- Travel tech partner.

Acceptance criteria:

- ICP includes airline size, geography, pain signals, and outreach angle.

### 05.03 Define banking/private intelligence ICP

Target personas:

- Risk.
- Compliance.
- Fraud.
- Intelligence.
- AML.
- Enterprise Security.
- Strategy.

Acceptance criteria:

- ICP includes regulated-sector sensitivity.
- Outreach language is professional and risk-aware.

### 05.04 Create solution-to-prospect matching logic

Acceptance criteria:

- System can recommend a solution campaign for a lead/account.
- System explains why the solution is relevant.
- System suggests the right first message.

---

# EPIC 06 — Lead Scoring and Qualification Engine

## Goal

Score every opportunity using Codistan-specific winning criteria.

## Core score categories

| Category | Default Weight |
|---|---:|
| Service fit | 25 |
| Buyer quality | 20 |
| Budget/ROI | 15 |
| Timing/urgency | 15 |
| Portfolio proof match | 15 |
| Competition/access risk | 5 |
| Compliance safety | 5 |

Total: 100

## Tasks

### 06.01 Implement scoring config

Acceptance criteria:

- Weights are configurable by source.
- Different scoring profiles exist for Upwork, LinkedIn warm leads, partner prospects, and solution-led prospects.

### 06.02 Implement service fit scoring

High service fit:

- AI automation.
- RAG/document intelligence.
- AI SaaS MVP.
- Next.js/Python full-stack AI.
- Voice AI/agentic workflows.
- AR/3D/Unity/Unreal.
- Cybersecurity/compliance-heavy software.

Acceptance criteria:

- Lead receives a service category.
- Service fit score is stored with explanation.

### 06.03 Implement buyer quality scoring

Buyer quality signals:

- Founder/CEO/CTO/director.
- Funded company.
- Established company.
- Verified payment/spend history where available.
- Clear decision-making authority.
- Strong company website.
- Active hiring/growth.

Acceptance criteria:

- Buyer quality score is stored with evidence.

### 06.04 Implement budget/ROI scoring

Acceptance criteria:

- System identifies explicit and implicit budget signals.
- Strong budgets increase score.
- Low-budget jobs are penalized.
- Enterprise/recurring potential increases score.

### 06.05 Implement timing score

Acceptance criteria:

- Fresh Upwork jobs get timing boost.
- Fresh LinkedIn warm posts get timing boost.
- Cold prospects do not over-prioritize timing unless direct trigger exists.

### 06.06 Implement portfolio proof match score

Acceptance criteria:

- Score increases when matching portfolio exists.
- Score decreases when no proof exists.
- System returns top matching proof items.

### 06.07 Implement red flag and rejection rules

Auto-reject examples:

- Score below threshold.
- Severe compliance risk.
- Extreme low budget.
- Poor fit with Codistan services.
- Suspicious or unethical ask.

Acceptance criteria:

- Rejection reason is stored.
- Human can override rejection.

### 06.08 Store score explanation

Acceptance criteria:

- Every score includes explainable breakdown.
- Human can see why a lead was qualified or rejected.

---

# EPIC 07 — Codistan Profile Routing Engine

## Goal

Recommend which Codistan/Upwork profile or sales identity should pursue each opportunity.

## Initial profiles

- US AI/full-stack profile.
- Waseem AI/founder-led profile.
- AR/3D/animation profile.
- Cybersecurity/compliance profile.
- Codistan company/partner identity.
- Solution-led campaign identity.

## Tasks

### 07.01 Define profile capability matrix

Acceptance criteria:

- Each profile has services, proof tags, geography limitations, compliance notes, and best-use cases.

### 07.02 Implement profile recommendation logic

Acceptance criteria:

- Every qualified lead receives one recommended profile.
- System can suggest secondary profile if useful.
- System explains why that profile was selected.

### 07.03 Add profile conflict/risk detection

Acceptance criteria:

- System flags profile mismatch.
- System flags US-only/compliance ambiguity.
- System recommends human review when risk exists.

---

# EPIC 08 — Portfolio Matching Engine

## Goal

Match each opportunity to Codistan’s most relevant portfolio, proof, case studies, screenshots, links, or anonymized examples.

## Tasks

### 08.01 Create portfolio item schema

Fields:

- Project name.
- Client/industry.
- Public/private/anonymized.
- Service category.
- Tech stack.
- Problem solved.
- Business outcome.
- Portfolio URL/assets.
- Screenshots/deck links.
- Tags.
- Best profile to use.
- Best pitch angle.

Acceptance criteria:

- Portfolio items can be added/edited.
- Confidentiality level is tracked.

### 08.02 Import initial portfolio library

Initial categories:

- AI/RAG/automation.
- Full-stack SaaS/MVP.
- Cybersecurity/compliance.
- AR/3D/animation.
- Websites/portals.
- Enterprise systems.

Acceptance criteria:

- At least 20 portfolio items can be added in structured format.
- Each portfolio item has tags.

### 08.03 Implement semantic matching

Acceptance criteria:

- Lead description is matched against portfolio tags and embeddings.
- System returns top 3 portfolio items.
- System explains match rationale.

### 08.04 Add proof quality scoring

Acceptance criteria:

- Public live links score higher.
- Highly relevant anonymized proof still scores positively.
- Weak/no proof reduces opportunity score.

---

# EPIC 09 — AI Proposal and Outreach Drafting

## Goal

Generate high-quality human-approved drafts for Upwork proposals, LinkedIn replies, partner outreach, and solution-led outreach.

## Tasks

### 09.01 Create Upwork proposal draft generator

Draft should include:

- Personalized opening.
- Understanding of client problem.
- Similar work proof.
- Suggested approach.
- Relevant questions.
- Suggested next step.
- Optional price/milestone guidance.

Acceptance criteria:

- Draft references only approved portfolio proof.
- Draft is specific to job description.
- Draft avoids generic agency spam.
- Draft is never auto-submitted.

### 09.02 Create LinkedIn warm reply generator

Draft should include:

- Short natural message.
- Reference to their post/signal.
- Relevant proof.
- Low-friction CTA.

Acceptance criteria:

- Draft is short enough for LinkedIn.
- Draft does not sound automated.
- Draft can generate comment + DM variants.

### 09.03 Create partner outreach generator

Acceptance criteria:

- Draft positions Codistan as white-label/offshore delivery partner.
- Draft is customized by agency/company type.
- Draft includes delivery strengths.
- Draft includes a simple collaboration CTA.

### 09.04 Create solution-led outreach generator

Acceptance criteria:

- Draft focuses on industry pain and business outcome.
- Draft avoids overclaiming.
- Draft asks for discovery/validation, not immediate hard sell.

### 09.05 Add human approval workflow

Acceptance criteria:

- Draft status starts as `draft_ready`.
- Human can approve/reject/edit.
- Final sent status is manually updated or integrated later.

---

# EPIC 10 — Alerts, Routing, and SLA Management

## Goal

Make sure hot opportunities reach the right human quickly.

## Tasks

### 10.01 Define alert thresholds

Acceptance criteria:

- Upwork hot alert: score >= 80, or score >= 75 with freshness <= 60 minutes.
- LinkedIn warm alert: score >= 75, or score >= 70 with post freshness <= 2 hours.
- Partner alert: score >= 90 or direct buying trigger.
- Solution-led alert: score >= 85 with strong buyer match.

### 10.02 Implement alert channels

Initial channels:

- Email.
- Slack/Discord/WhatsApp later.
- Dashboard notification.

Acceptance criteria:

- Alert contains lead summary, score, reason, recommended action, and link to draft.
- Alert is not sent for rejected leads.
- Duplicate alerts are suppressed.

### 10.03 Add owner assignment rules

Examples:

- AI Upwork jobs -> AI BD/founder.
- AR/3D leads -> Motion/3D team owner.
- Cyber leads -> security owner.
- Partner leads -> founder/partnership owner.

Acceptance criteria:

- Owner is assigned automatically where possible.
- Human can reassign.

### 10.04 Create SLA tracking

Acceptance criteria:

- Hot Upwork lead target review time: 15-30 minutes.
- Hot LinkedIn warm lead target review time: 30-60 minutes.
- Partner/cold lead target review time: 1-3 business days.
- Overdue leads are flagged.

---

# EPIC 11 — Dashboard and Pipeline Management

## Goal

Give the team one place to review, filter, qualify, and act on opportunities.

## Tasks

### 11.01 Build opportunity list view

Filters:

- Source.
- Lead type.
- Score range.
- Urgency.
- Profile recommendation.
- Service category.
- Owner.
- Status.
- Date captured.

Acceptance criteria:

- User can quickly see hot opportunities.
- No fixed limit; all threshold-qualified leads can be viewed.

### 11.02 Build lead detail page

Display:

- Original source/evidence.
- Lead summary.
- Score breakdown.
- Red flags.
- Recommended profile.
- Recommended portfolio.
- Draft message/proposal.
- Activity timeline.
- Status/outcome.

Acceptance criteria:

- Reviewer has enough context to approve or reject without opening multiple tools.

### 11.03 Add status update actions

Acceptance criteria:

- User can mark lead as approved, rejected, sent, replied, meeting booked, won, lost, archived.
- Status history is stored.

### 11.04 Add saved views

Saved views:

- Hot Upwork now.
- Hot LinkedIn warm posts.
- AI automation leads.
- AR/3D leads.
- Partner prospects.
- Solution-led prospects.
- Needs human review.
- Overdue hot leads.

Acceptance criteria:

- Saved views load with one click.

---

# EPIC 12 — Contact and Company Enrichment

## Goal

Enrich qualified leads only after they cross scoring thresholds to keep costs low.

## Tasks

### 12.01 Define enrichment policy

Acceptance criteria:

- No enrichment for rejected leads.
- Optional enrichment for qualified leads.
- Required enrichment for partner/solution prospects before outreach.
- Paid enrichment is only used after threshold.

### 12.02 Company enrichment

Fields:

- Website.
- Industry.
- Company size.
- Country.
- Services/products.
- Recent signals.
- Funding/hiring signal if available.

Acceptance criteria:

- Enrichment source is stored.
- Confidence level is stored.

### 12.03 Contact enrichment

Fields:

- Name.
- Role.
- LinkedIn URL.
- Business email where available and compliant.
- Outreach channel.

Acceptance criteria:

- System does not use unsafe scraping.
- Human can verify contact before outreach.

### 12.04 Cost controls

Acceptance criteria:

- Enrichment has monthly budget cap.
- Every paid enrichment event is logged.
- Admin can disable enrichment provider.

---

# EPIC 13 — Analytics and Learning Loop

## Goal

Improve lead qualification over time based on real outcomes.

## Tasks

### 13.01 Track outcome metrics

Metrics:

- Captured leads.
- Qualified leads.
- Hot alerts.
- Human-approved leads.
- Outreach sent.
- Replies.
- Meetings.
- Proposals.
- Wins.
- Lost/rejected reasons.
- Source conversion rate.

Acceptance criteria:

- Metrics are filterable by source, profile, service category, and date.

### 13.02 Add win/loss reason capture

Acceptance criteria:

- Human can record lost reason.
- Human can record won reason.
- Reasons are used to improve scoring assumptions.

### 13.03 Build scoring calibration report

Acceptance criteria:

- Report compares predicted score vs actual outcome.
- System identifies false positives and false negatives.
- PM can update scoring weights.

---

# EPIC 14 — Security, Permissions, and Audit Logs

## Goal

Protect sensitive profile, lead, client, and portfolio data.

## Tasks

### 14.01 Implement user roles

Roles:

- Admin.
- Founder.
- BD manager.
- Reviewer.
- Read-only.

Acceptance criteria:

- Sensitive settings are admin-only.
- Profile routing rules are restricted.
- Portfolio confidentiality is respected.

### 14.02 Add audit logs

Track:

- Lead created.
- Score generated.
- Draft generated.
- Status changed.
- Human approved/rejected.
- Alert sent.
- Enrichment performed.

Acceptance criteria:

- Audit logs are immutable from normal UI.
- Logs include user and timestamp.

### 14.03 Add data retention controls

Acceptance criteria:

- Old rejected leads can be archived.
- Sensitive contact info can be removed.
- Admin can delete lead records if needed.

---

# EPIC 15 — QA, Testing, and Observability

## Goal

Ensure the system is reliable enough for frequent sales operations.

## Tasks

### 15.01 Add unit tests for scoring

Acceptance criteria:

- Each scoring category has tests.
- Threshold behavior is tested.
- Red flag rejection is tested.

### 15.02 Add integration tests for ingestion

Acceptance criteria:

- Upwork email parser tests exist.
- LinkedIn alert/manual parser tests exist.
- Duplicate handling is tested.

### 15.03 Add AI output tests

Acceptance criteria:

- Draft generator does not hallucinate portfolio proof.
- Draft generator includes source-specific personalization.
- Draft generator respects compliance rules.

### 15.04 Add monitoring

Acceptance criteria:

- Worker failures are logged.
- Failed ingestion jobs retry.
- Alert failures are visible.
- Admin can see last successful run per source.

---

# Suggested MVP Milestones

## Milestone 1 — Foundation and Data Model

- Repo structure.
- Database schema.
- Config system.
- Manual lead submission.
- Basic dashboard shell.

## Milestone 2 — Upwork Warm Lead Engine

- Upwork email/manual ingestion.
- 30-minute worker.
- Scoring.
- Hot alerts.
- Draft Upwork proposal.

## Milestone 3 — LinkedIn Warm Lead Engine

- Manual/Sales Nav alert ingestion.
- Signal classification.
- 30-minute warm check.
- LinkedIn reply/comment draft.

## Milestone 4 — Portfolio/Profile Matching

- Portfolio library.
- Profile routing matrix.
- Semantic matching.
- Proof recommendation.

## Milestone 5 — Partner and Solution Prospecting

- Partner ICP.
- Solution catalog.
- Enrichment rules.
- Partner and solution outreach drafts.

## Milestone 6 — Analytics and Optimization

- Outcome tracking.
- Scoring calibration.
- Conversion reporting.
- SLA reporting.

---

# First Sprint Recommendation

## Sprint 1 focus

Build only what proves the core loop:

1. Manual lead submission.
2. Upwork email ingestion.
3. Normalized lead table.
4. Scoring engine v1.
5. Profile routing v1.
6. Portfolio matching v1 using tags first.
7. Upwork proposal draft v1.
8. Hot alert if score crosses threshold.

## Sprint 1 exit criteria

A team member can paste or capture a fresh Upwork job, and within one workflow the system returns:

- Score.
- Reasoning.
- Red flags.
- Recommended profile.
- Best portfolio proof.
- Suggested proposal draft.
- Urgency status.
- Human next action.

---

# Definition of Done

An epic/task is done only when:

- It works in the app or worker.
- It has clear acceptance criteria met.
- It has tests where relevant.
- It logs errors.
- It avoids unsafe scraping or automatic outreach.
- It stores evidence and reasoning.
- It supports human approval before external communication.
