# Developer Quickstart

## 1. Install dependencies

```bash
pnpm install
```

## 2. Typecheck all packages

```bash
pnpm typecheck
```

## 3. Run tests

```bash
pnpm test
```

## 4. Evaluate bundled sample lead

```bash
pnpm evaluate:sample
```

Or evaluate a specific sample lead:

```bash
pnpm evaluate:sample lead-upwork-rag-001
pnpm evaluate:sample lead-linkedin-ai-001
pnpm evaluate:sample lead-partner-agency-001
pnpm evaluate:sample lead-upwork-lowbudget-001
```

## 5. Evaluate a pasted/manual lead JSON

Create a file named `lead.json`:

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

Run:

```bash
pnpm evaluate:json ./lead.json
```

## 6. Expected evaluation output

The CLI prints JSON with:

- Lead ID and title.
- Score.
- Qualification status.
- Urgency.
- Score breakdown.
- Red flags.
- Recommended profile.
- Matched portfolio proof.
- Recommended next action.
- Explanation.

## Current safety defaults

The platform is not allowed to auto-send outreach or auto-submit Upwork proposals.

```env
AUTO_SEND_OUTREACH=false
AUTO_SUBMIT_UPWORK_PROPOSALS=false
```
