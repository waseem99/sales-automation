# Follow-up and Outcome Tracking

## Objective

Make the BD pipeline measurable after a lead is reviewed. The system should help the team track follow-up dates, final outcomes, and reasons for won/lost/rejected leads without automating outreach.

## Fields to track

For each lead or prospect:

- next follow-up date
- follow-up note
- outcome status
- outcome reason
- outcome recorded date

## Operating rules

- A follow-up date is an internal reminder only.
- Outcome notes should be short and factual.
- Rejected/lost/won reasons should improve future scoring and BD quality review.
- No email, LinkedIn message, Upwork proposal, or external outreach should be sent automatically.

## Suggested statuses

- `sent_manually` → follow-up date required
- `replied` → meeting/proposal next step
- `meeting_booked` → proposal next step
- `proposal_sent` → follow-up date required
- `won` → outcome reason required
- `lost` → outcome reason required
- `rejected` → outcome reason required

## Later automation boundary

A future reminder digest can surface due follow-ups, but it must remain internal-only until approved by a human.