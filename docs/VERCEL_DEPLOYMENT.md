# Vercel Deployment Handbook

## 1. Import the repository

1. Open Vercel.
2. Choose **Add New → Project**.
3. Import `waseem99/sales-automation`.
4. Keep the project root as the repository root.
5. Vercel will use `vercel.json` and the root `package.json`.

Do not deploy until the database and required variables are configured.

## 2. Connect Neon Postgres

1. Open the Vercel project.
2. Go to **Storage** or **Marketplace**.
3. Add a Neon Postgres database.
4. Connect it to this project and all required environments.
5. Confirm that `DATABASE_URL` appears under **Settings → Environment Variables**.

The application creates its initial tables automatically on the first database-backed request:

```text
prospect_records
prospect_discovery_runs
prospect_run_locks
```

No SQL needs to be pasted manually for the first release.

## 3. Add dashboard and cron secrets

Add these in **Vercel → Project → Settings → Environment Variables**:

```text
ADMIN_PASSWORD
SESSION_SECRET
CRON_SECRET
DASHBOARD_ACTOR
```

Guidance:

- `ADMIN_PASSWORD`: the fixed password used by the internal BD team.
- `SESSION_SECRET`: a separate long random value, at least 32 characters.
- `CRON_SECRET`: another separate long random value.
- `DASHBOARD_ACTOR`: an internal identifier such as `bd-team@codistan.org`.

Do not reuse the admin password as either secret.

## 4. Configure the existing-domain mailbox

A new subdomain is not required. Create or choose one mailbox on the current domain, then obtain its outgoing SMTP settings from the email provider.

Add:

```text
PROSPECT_DIGEST_TO
PROSPECT_DIGEST_FROM
SMTP_HOST
SMTP_PORT
SMTP_SECURE
SMTP_USER
SMTP_PASSWORD
```

Example format only:

```text
PROSPECT_DIGEST_FROM=Codistan Prospect Desk <prospects@your-current-domain>
PROSPECT_DIGEST_TO=bdlead@your-current-domain,manager@your-current-domain
SMTP_PORT=587
SMTP_SECURE=false
```

Use the real SMTP host, username, and password only inside Vercel. Do not add them to GitHub or share them in chat.

Typical settings:

- Port `587` with `SMTP_SECURE=false` for STARTTLS.
- Port `465` with `SMTP_SECURE=true` for implicit TLS.

Use the exact settings supplied by the mailbox provider. Port 25 should not be used.

## 5. Configure discovery limits

Recommended initial values:

```text
PROSPECT_MAX_CANDIDATES=15
PROSPECT_MAX_SEARCH_QUERIES=10
PROSPECT_BING_RSS_ENABLED=true
PROSPECT_REMOTEOK_ENABLED=true
```

Optional lists:

```text
PROSPECT_SEARCH_QUERIES
PROSPECT_GREENHOUSE_BOARDS
PROSPECT_LEVER_SITES
PROSPECT_RSS_FEEDS
```

Lists can be comma, semicolon, or newline separated.

## 6. Deploy

1. Trigger a production deployment from Vercel.
2. Wait for the build to complete.
3. Open the production URL.
4. Confirm that `/login` loads.
5. Log in with `ADMIN_PASSWORD`.

## 7. Run the first discovery pass

1. Open the dashboard.
2. Select **Run discovery now**.
3. Wait for the result message.
4. Confirm that new prospects appear.
5. Open one prospect and verify the evidence link, company website, contact route, service match, and draft.
6. Confirm that the internal digest arrives with the CSV attachment.

A failed email does not remove prospects from the dashboard. The discovery run records the email error for review.

## 8. Verify the daily cron

The repository schedules:

```text
0 4 * * *
```

This requests one run during the 04:00 UTC hour each day. Vercel sends `CRON_SECRET` automatically as a bearer token.

Check **Vercel → Project → Cron Jobs** after deployment and confirm `/api/cron/prospect-discovery` is listed.

The cron route uses a Neon database lock so overlapping runs are skipped instead of creating duplicate work.

## 9. BD operating rules

For every prospect:

1. Assign an owner.
2. Record outreach and channel used.
3. Record the actual reply, objection, or meeting outcome.
4. Complete the required feedback:
   - Relevance 1–5.
   - Contact accuracy.
   - Source quality.
   - Increase, keep, reduce, or stop using the source.
   - Correct service category where needed.
   - Explanation.
5. Update the pipeline status.

Won, lost, and rejected statuses are blocked until the required feedback is completed.

## 10. What the system learns

Future discovery runs use completed feedback and outcomes to adjust source priority:

- High relevance, replies, meetings, wins, and **increase** recommendations raise priority.
- Low relevance, rejection, poor contact accuracy, and **reduce/stop** recommendations lower priority.

This first release learns at source/query level. More advanced model training can be added after enough real BD feedback exists.

## Troubleshooting

### Dashboard says `DATABASE_URL is required`

Reconnect Neon to the Vercel project or add the Neon connection string as `DATABASE_URL`.

### Login works but dashboard actions fail

Confirm the Neon integration is available to the Production environment and redeploy after changing variables.

### Cron returns unauthorized

Confirm `CRON_SECRET` exists in Vercel and redeploy. Do not call the route manually without the bearer header.

### Email fails

Check the mailbox provider's SMTP host, port, encryption mode, username, password, and whether SMTP access is enabled. Try port 465 with secure mode when the provider does not support STARTTLS on 587.

### No email arrives

No digest is sent when a run finds no new prospects. Check the dashboard's latest discovery record and email status.
