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
8. Sends internal Slack alerts for newly captured hot and qualified leads when configured.
9. Can run continuously every 30 minutes with retries, overlap protection, state, and JSONL run logs.

It does **not** send email, archive messages, add labels, mark messages as read, auto-submit Upwork proposals, auto-DM prospects, or contact any prospect through Slack. Slack is an internal Codistan BD notification channel only.

## Required inputs

### Gmail authorization

Use one of these methods:

- Preferred for recurring runs: `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, and `GMAIL_REFRESH_TOKEN` authorized only for `https://www.googleapis.com/auth/gmail.readonly`.
- Temporary testing: `GMAIL_ACCESS_TOKEN`. This expires quickly and should never be committed.

The connected mailbox should receive Upwork saved-search or job-alert emails. A dedicated label such as `Lead Alerts` is recommended but optional.

### Slack notification channel

Create a Slack incoming webhook for the internal BD channel and set:

```bash
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...
APP_BASE_URL=https://your-lead-desk.example.com
```

By default, Slack receives newly captured `hot` and `qualified` leads. Set `SLACK_ALERT_QUALIFIED=false` to restrict delivery to urgent/hot alert plans only.

The Slack alert includes:

- source and lead type;
- score, qualification, and urgency;
- recommended Codistan profile;
- proof-match count;
- red flags and next action;
- a source link when available;
- a direct Lead Desk link when `APP_BASE_URL` is configured.

A dedupe key is stored only after Slack confirms successful delivery. A repeated Gmail alert therefore does not generate repeated Slack notifications.

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

## Core configuration

Copy `.env.example` into your deployment environment and set at minimum:

```bash
GMAIL_CLIENT_ID=...
GMAIL_CLIENT_SECRET=...
GMAIL_REFRESH_TOKEN=...
PORTFOLIO_FILE=/absolute/path/to/codistan-portfolio.json
LEAD_STORE_FILE=.data/leads.json
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...
APP_BASE_URL=https://your-lead-desk.example.com
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
SLACK_ALERT_QUALIFIED=true
SLACK_ALERT_MAX_ATTEMPTS=3
SLACK_ALERT_RETRY_DELAY_MS=1000
```

`GMAIL_QUERY` uses native Gmail search syntax, so it can be narrowed to specific saved searches, keywords, senders, or labels.

## Run once

Load the environment variables, then run:

```bash
pnpm ingest:gmail
```

The command builds the monorepo, reads Gmail, persists deduplicated leads, attempts configured Slack alerts, and prints a summary containing:

- messages processed;
- newly captured and duplicate leads;
- hot and qualified lead count;
- successfully alerted lead count and alert failures;
- score, urgency, budget, service category, profile recommendation, proof match, next action, and draft for each qualified lead.

## Run continuously every 30 minutes

Use the built-in worker:

```bash
pnpm worker:gmail
```

Default worker settings:

```bash
GMAIL_WORKER_MODE=continuous
GMAIL_WORKER_INTERVAL_MINUTES=30
GMAIL_WORKER_MAX_ATTEMPTS=3
GMAIL_WORKER_RETRY_DELAY_MS=5000
GMAIL_WORKER_LOCK_STALE_MINUTES=90
WORKER_RUN_LOG_FILE=.data/gmail-worker-runs.jsonl
WORKER_STATE_FILE=.data/gmail-worker-state.json
WORKER_LOCK_FILE=.data/gmail-worker.lock
```

The worker:

- starts an ingestion cycle immediately;
- waits 30 minutes after each completed cycle;
- retries transient cycle failures with increasing delays;
- prevents two local workers from using the same JSON lead store concurrently;
- replaces abandoned stale locks after the configured stale window;
- records every cycle as one JSON object in the JSONL run log;
- atomically updates the latest worker state;
- keeps running after a failed cycle in continuous mode.

For a scheduler or platform cron job rather than a persistent worker, use:

```bash
GMAIL_WORKER_MODE=once pnpm worker:gmail
```

The command exits with a non-zero status when the cycle fails after all retries.

## Operational visibility

`WORKER_STATE_FILE` contains the latest source status:

- last attempt;
- last success;
- last failure;
- consecutive failure count;
- last error;
- latest message, capture, qualification, and alert metrics.

`WORKER_RUN_LOG_FILE` is append-only JSONL and can be shipped to the hosting platform's log service. It intentionally contains operating metrics and errors, not OAuth secrets or complete Gmail message bodies.

## Deployment note

The current worker uses the local JSON lead store. Run only one web/worker writer against that file and mount persistent storage. Move to PostgreSQL before horizontally scaling, running multiple worker replicas, or using ephemeral serverless filesystems.

## Immediate operating process

1. Keep the Gmail worker running every 30 minutes.
2. Review Slack alerts immediately, starting with urgent/hot leads.
3. Confirm the Upwork job is still open and inspect client history and proposal volume.
4. Confirm the recommended profile and approved portfolio proof.
5. Tailor the generated draft and submit manually.
6. Record sent, reply, meeting, proposal, won, lost, or rejected outcomes in the dashboard.
7. Review worker state if no lead checks have succeeded recently.

The success metric is qualified leads reviewed and proposed against quickly, followed by interviews and wins—not raw message volume.
