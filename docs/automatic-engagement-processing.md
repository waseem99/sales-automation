# Automatic Engagement Intelligence

This implementation turns the engagement framework into an executable part of the prospect lifecycle.

## Lead procurement and qualification

Every lead returned by a prospect-discovery run is immediately processed through the engagement-intelligence framework before it is handed to the BD team.

The automatic step:

- performs the 100-point qualification audit
- checks hard stops and compliance warnings
- records unresolved research gaps
- identifies the likely buyer and need hypothesis
- selects the Codistan service and proof angle
- prepares subject options and the first-outreach draft
- sets the next action
- moves clean qualified records to `draft_ready`
- keeps records with gaps or hard stops in `needs_human_review`
- saves the complete guidance in the lead timeline

The process is idempotent for normal use. A lead with an existing `guidance::first_outreach::` record is skipped unless a forced refresh is requested.

## Existing lead backfill

Authenticated users can run:

```http
POST /api/prospects/guidance/backfill
Content-Type: application/json

{}
```

To refresh every non-closed record deliberately:

```json
{ "force": true }
```

The response reports audited, skipped, priority, qualified, human-review, nurture and rejected totals.

## New discovery runs

`POST /api/prospects/run` now returns an `engagementAudit` object. Only new lead IDs from that discovery run are audited, so unrelated existing records are not rewritten.

## Reply post-processing

Whenever a team member logs an activity with `type: "response"`, the system automatically:

- saves the original reply
- classifies its intent
- extracts questions and objections
- measures buying-signal strength and urgency
- recommends the pipeline status and next action
- prepares a formal response draft
- identifies materials and a meeting agenda where relevant
- flags pricing, legal, security, compliance, discount, complaint and ambiguous cases for human approval
- stops follow-ups for unsubscribe, delivery failure and clear not-relevant replies
- stores the reply guidance in the lead timeline

The activity API response includes `replyGuidance` so future IMAP ingestion can use the same processing path without duplicating business logic.

## Human control

The system prepares guidance; it does not automatically send commercial commitments. Pricing, discounts, legal terms, delivery guarantees, security statements, compliance claims and complaints remain human-approved.
