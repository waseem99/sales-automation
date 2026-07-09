# Manual Lead Input Format

The first MVP supports evaluating a manually pasted lead through JSON.

Use this when a BD/founder sees an Upwork job, LinkedIn post, Sales Navigator alert, or partner opportunity and wants an immediate score.

## Required fields

```ts
{
  id: string;
  source: 'manual' | 'upwork' | 'linkedin' | 'sales_navigator' | 'partner_research' | 'solution_campaign';
  leadType: 'manual_lead' | 'upwork_job' | 'linkedin_warm_post' | 'linkedin_sales_nav_alert' | 'partner_prospect' | 'solution_led_prospect';
  title: string;
  description: string;
  serviceCategory: ServiceCategory;
  capturedAt: string;
  pipelineStatus: 'new';
  createdAt: string;
  updatedAt: string;
}
```

## Useful optional fields

```ts
{
  sourceUrl?: string;
  companyName?: string;
  contactName?: string;
  contactRole?: string;
  country?: string;
  region?: string;
  industry?: string;
  budgetSignal?: string;
  timelineSignal?: string;
  postedAt?: string;
  freshnessMinutes?: number;
}
```

## Example

```json
{
  "id": "manual-lead-001",
  "source": "manual",
  "leadType": "manual_lead",
  "title": "Need AI workflow automation for support operations",
  "description": "Founder is looking for an AI automation partner to classify support tickets, route cases, and create internal status updates.",
  "contactRole": "Founder",
  "country": "United States",
  "region": "North America",
  "industry": "enterprise",
  "serviceCategory": "ai_automation",
  "budgetSignal": "Long-term automation partner",
  "timelineSignal": "Start soon",
  "capturedAt": "2026-07-08T18:30:00.000Z",
  "freshnessMinutes": 45,
  "pipelineStatus": "new",
  "createdAt": "2026-07-08T18:30:00.000Z",
  "updatedAt": "2026-07-08T18:30:00.000Z"
}
```

## Run evaluation

```bash
pnpm evaluate:json ./lead.json
```

## Output

The CLI returns:

- Score.
- Status.
- Urgency.
- Score breakdown.
- Red flags.
- Recommended profile.
- Portfolio matches.
- Recommended next action.
- Explanation.

## Important

This only prepares internal recommendations. It does not send messages, submit proposals, or perform external outreach.
