# Gmail Read-Only Lead Ingestion

This is the fastest safe path from real Upwork alert emails to qualified leads in Codistan Lead Desk.

## What it does

1. Reads matching Gmail messages through the Gmail REST API.
2. Uses only `messages.list` and `messages.get` with the `gmail.readonly` OAuth scope.
3. Extracts plain-text or HTML email content without changing the mailbox.
4. Classifies Upwork and LinkedIn/Sales Navigator signals.
5. Normalizes and deduplicates opportunities.
6. Scores, routes, matches portfolio proof, and generates a human-review draft.
7. Persists results in the current local JSON lead store.
8. Prints newly captured hot and qualified leads as JSON.

It does **not** send email, archive messages, add labels, mark messages as read, auto-submit Upwork proposals, or auto-DM prospects.

## Required inputs

### Gmail authorization

Use one of these methods:

- Preferred for recurring runs: `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, and `GMAIL_REFRESH_TOKEN` authorized only for `https://www.googleapis.com/auth/gmail.readonly`.
- Temporary testing: `GMAIL_ACCESS_TOKEN`. This expires quickly and should never be committed.

The connected mailbox should receive Upwork saved-search or job-alert emails. A dedicated label such as `Lead Alerts` is recommended but optional.

### Approved portfolio proof

Set `PORTFOLIO_FILE` to a JSON array of approved Codistan portfolio items. Without it, messages are still captured and scored, but proof matching is intentionally weaker.

Each item follows this structure:

```json
[
  {
    "id": "private-ai-chatbot",
    "projectName": "Private AI Chatbot",
    "industry": "enterprise",
    "confidentiality": "public",
    "serviceCategories": ["rag_document_intelligence", "ai_automation"],
    "techStack": ["OpenAI", "RAG", "Azure", "Node.js"],
    "problemSolved": "Enabled secure question answering over internal organizational documents.",
    "businessOutcome": "Reduced manual knowledge lookup and improved response consistency.",
    "assetUrls": ["https://securechatai.com/"],
    "tags": ["rag", "private ai", "chatbot", "document intelligence", "azure"],
    "bestProfiles": ["waseem_ai_founder_profile", "us_ai_fullstack_profile"],
    "bestPitchAngle": "Use as proof for secure RAG, document intelligence, and enterprise AI opportunities."
  }
]
```

Only include proof that the BD team is permitted to reference. Keep confidential projects `private` or `anonymized`, and leave `INCLUDE_PRIVATE_PORTFOLIO=false` unless internal use is explicitly approved.

## Configuration

Copy `.env.example` into your environment and set at minimum:

```bash
GMAIL_CLIENT_ID=...
GMAIL_CLIENT_SECRET=...
GMAIL_REFRESH_TOKEN=...
PORTFOLIO_FILE=/absolute/path/to/codistan-portfolio.json
LEAD_STORE_FILE=.data/leads.json
```

Default Gmail filter:

```text
(from:(upwork.com) OR subject:(Upwork)) (job OR opportunity OR alert)
```

Useful optional settings:

```bash
GMAIL_LABEL=Lead Alerts
GMAIL_NEWER_THAN_DAYS=2
GMAIL_MAX_RESULTS=50
GMAIL_USER_ID=me
```

`GMAIL_QUERY` uses native Gmail search syntax, so it can be narrowed to specific saved searches, keywords, senders, or labels.

## Run once

Load the environment variables, then run:

```bash
pnpm ingest:gmail
```

The command builds the monorepo, reads Gmail, persists deduplicated leads, and prints a summary containing:

- messages processed;
- newly captured and duplicate leads;
- hot and qualified lead count;
- score, urgency, budget, service category, profile recommendation, proof match, next action, and draft for each qualified lead.

## Run every 30 minutes

Use the hosting platform's scheduled job or a cron job to execute the same command every 30 minutes. The existing source URL and lead ID dedupe prevents repeated alert emails from creating duplicate opportunities.

Example cron expression:

```text
*/30 * * * *
```

Do not run overlapping jobs against the same local JSON file. PostgreSQL-backed storage should replace the local file before multiple workers or web instances run concurrently.

## Immediate operating process

1. Run ingestion every 30 minutes.
2. Review only `hot` and `qualified` results first.
3. Confirm the job is still open and inspect client history on Upwork.
4. Confirm the recommended profile and approved portfolio proof.
5. Tailor the generated draft and submit manually.
6. Record sent, reply, meeting, proposal, won, lost, or rejected outcomes in the dashboard.

The success metric is qualified leads reviewed and proposed against quickly, followed by interviews and wins—not raw message volume.
