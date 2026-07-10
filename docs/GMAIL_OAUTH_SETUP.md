# Gmail Read-Only OAuth Setup

This setup connects the mailbox that receives Upwork job-alert emails to Codistan Lead Desk. The application requests only the Gmail read-only scope and does not send, archive, delete, label, or mark messages as read.

## 1. Prepare Google Cloud

In a Google Cloud project:

1. Enable the Gmail API.
2. Configure the OAuth consent screen for the users who will authorize the mailbox.
3. Create an OAuth client ID with application type **Web application**.
4. Add this exact authorized redirect URI:

```text
http://127.0.0.1:53682/oauth/callback
```

A different localhost port or path is supported, but it must match `GMAIL_OAUTH_REDIRECT_URI` exactly.

## 2. Add the OAuth client locally

Create an ignored `.env.local` file in the repository root with only the client details initially:

```bash
GMAIL_CLIENT_ID=your-client-id.apps.googleusercontent.com
GMAIL_CLIENT_SECRET=your-client-secret
GMAIL_OAUTH_REDIRECT_URI=http://127.0.0.1:53682/oauth/callback
GMAIL_OAUTH_OUTPUT_FILE=.env.local
# Optional
GMAIL_OAUTH_LOGIN_HINT=mailbox-that-receives-alerts@example.com
```

`.env.local` is ignored by git. Do not paste these values into `.env.example`, source code, issues, pull requests, or chat messages.

## 3. Authorize the mailbox

From the repository root, run:

```bash
pnpm authorize:gmail
```

The command will:

1. Build the monorepo.
2. Start a temporary callback listener on `127.0.0.1`.
3. Print a Google authorization URL.
4. Request only `https://www.googleapis.com/auth/gmail.readonly`.
5. Validate the OAuth callback state and PKCE challenge.
6. Exchange the authorization code for an offline refresh token.
7. Validate the connected mailbox using the Gmail profile endpoint.
8. Write the refresh token into `.env.local` without printing it.
9. Restrict the local environment file to owner-only permissions where supported.

Open the printed URL in a browser, select the Gmail mailbox receiving the Upwork alerts, approve the read-only permission, and return to the terminal. The browser callback page confirms completion.

The sanitized terminal result shows the connected mailbox and the output file, but never the client secret, access token, or refresh token.

## 4. Confirm the generated configuration

After authorization, `.env.local` contains:

```bash
GMAIL_CLIENT_ID=...
GMAIL_CLIENT_SECRET=...
GMAIL_REFRESH_TOKEN=...
GMAIL_USER_ID=me
```

Add the remaining operating settings to the same file:

```bash
GMAIL_QUERY=(from:(upwork.com) OR subject:(Upwork)) (job OR opportunity OR alert)
GMAIL_NEWER_THAN_DAYS=2
GMAIL_MAX_RESULTS=50
LEAD_STORE_FILE=.data/leads.json
PORTFOLIO_FILE=/absolute/path/to/codistan-portfolio.json
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...
APP_BASE_URL=https://your-lead-desk.example.com
```

The Gmail authorization, ingestion, and worker commands automatically load `.env` followed by `.env.local`. Existing process or deployment environment variables take precedence.

## 5. Test one ingestion cycle

Run:

```bash
pnpm ingest:gmail
```

Confirm the output shows:

- the expected Gmail query;
- processed messages;
- captured and duplicate leads;
- hot and qualified leads;
- Slack delivery results when configured;
- no Gmail write operations.

## 6. Start continuous qualification

Run:

```bash
pnpm worker:gmail
```

The worker checks immediately and then every 30 minutes by default. It retries failed cycles, prevents overlapping local workers, persists lead and alert dedupe state, and records last-success/failure metrics.

## Security and revocation

- Keep the OAuth client secret and refresh token in a deployment secret store or ignored local file only.
- Use a dedicated operational mailbox or dedicated alert label where practical.
- Keep the OAuth scope read-only.
- Revoke the Google app grant and rotate the client secret if a refresh token or client secret is exposed.
- Do not run multiple writers against the current local JSON store; move to PostgreSQL before horizontal scaling.

## Troubleshooting

### Redirect URI mismatch

Confirm the URI configured in Google Cloud exactly matches `GMAIL_OAUTH_REDIRECT_URI`, including protocol, IP/hostname, port, and path.

### No refresh token returned

The command requests offline access and forces the consent screen. If Google still does not return a refresh token, revoke the existing grant for this OAuth client and authorize again.

### Callback does not complete

Run the command on a machine where the browser can reach the configured localhost callback. Confirm the selected port is available and local security software is not blocking it.

### Wrong mailbox connected

Revoke the grant, set `GMAIL_OAUTH_LOGIN_HINT` to the correct mailbox, and run `pnpm authorize:gmail` again.
