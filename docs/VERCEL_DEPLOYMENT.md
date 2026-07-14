# Vercel Deployment Handbook

## 1. Project setup

1. Import `waseem99/sales-automation` into Vercel.
2. Keep the repository root as the project root.
3. Connect the project to Neon Postgres.
4. Confirm `DATABASE_URL` is available in every environment that will be used.
5. Add the variables listed in `.env.example`.
6. Deploy from `main`.

Vercel uses `vercel.json` and the root `package.json`. Node.js 22 and pnpm 9.15.9 are fixed by the repository.

## 2. Required secrets

```text
DATABASE_URL
ADMIN_PASSWORD
SESSION_SECRET
CRON_SECRET
```

Use separate long random values for `SESSION_SECRET` and `CRON_SECRET`. Do not reuse a dashboard password.

## 3. Dashboard accounts

An account is enabled only when its corresponding variable is set:

```text
WASEEM_DASHBOARD_PASSWORD
TALHA_DASHBOARD_PASSWORD
JAWAD_DASHBOARD_PASSWORD
MOIZ_DASHBOARD_PASSWORD
SUBAINA_DASHBOARD_PASSWORD
DANISH_DASHBOARD_PASSWORD
HIBA_DASHBOARD_PASSWORD
BILAL_DASHBOARD_PASSWORD
```

Access model:

- Admin and Waseem: all company leads and global operations.
- Talha: Talha-team scope.
- Other configured BD accounts: assigned scope.

Use `/health` to verify account-configuration booleans without exposing passwords.

## 4. Portfolio library

Set:

```text
PORTFOLIO_LIBRARY_URL
```

The URL must point to the approved read-only portfolio/case-study library. Do not place private file contents or credentials in environment variables.

## 5. Prospect discovery

Recommended initial values:

```text
PROSPECT_MAX_CANDIDATES=15
PROSPECT_MAX_SEARCH_QUERIES=10
PROSPECT_BING_RSS_ENABLED=true
PROSPECT_REMOTEOK_ENABLED=true
```

Optional configured lists:

```text
PROSPECT_SEARCH_QUERIES
PROSPECT_GREENHOUSE_BOARDS
PROSPECT_LEVER_SITES
PROSPECT_RSS_FEEDS
```

The daily cron route is:

```text
/api/cron/prospect-discovery
```

## 6. Tender and RFP discovery

Recommended values:

```text
TENDER_MAX_CANDIDATES=80
TENDER_PPRA_ENABLED=true
TENDER_CANADABUYS_ENABLED=true
TENDER_UNGM_ENABLED=true
TENDER_PRIVATE_NONPROFIT_ENABLED=true
```

The protected manual/cron route is:

```text
/api/tender-discovery
```

It runs every six hours. Open `/tenders` as Admin or Waseem to trigger a manual refresh.

## 7. Internal prospect digest

Configure the shared sales mailbox:

```text
PROSPECT_DIGEST_TO
PROSPECT_DIGEST_FROM
PROSPECT_DIGEST_SUBJECT_PREFIX
SMTP_HOST
SMTP_PORT
SMTP_SECURE
SMTP_USER
SMTP_PASSWORD
```

Recommended identity:

```text
SMTP_USER=sales@codistan.org
PROSPECT_DIGEST_FROM=Codistan Prospect Desk <sales@codistan.org>
```

A digest is skipped when no new prospects are found.

## 8. Guarded outreach mailbox

Configure:

```text
SALES_MAILBOX_PASSWORD
SALES_OUTREACH_SIGNATURE
OUTREACH_SENDER_EMAILS=sales@codistan.org
OUTREACH_ALERT_EMAILS=waseem@codistan.org,sales@codistan.org
OUTREACH_SMTP_HOST
OUTREACH_SMTP_PORT=465
OUTREACH_IMAP_HOST
OUTREACH_IMAP_PORT=993
```

Outbound routing is:

- From: `sales@codistan.org`
- Reply-To: assigned owner
- CC: assigned owner and `waseem@codistan.org`

## 9. Deliverability gates

Keep these values until SPF, DKIM, DMARC, sender alignment and Gmail/Microsoft inbox-placement tests pass:

```text
OUTREACH_SENDING_ENABLED=false
OUTREACH_DNS_READY=false
OUTREACH_DRY_RUN=true
OUTREACH_RAMP_STARTED_AT=
```

Do not enable live sending merely because SMTP authentication succeeds. A message reaching spam is not a successful deliverability test.

When all checks pass, set a valid ramp start and begin with the policy-defined low daily volume. Monitor bounces, deferrals, complaints and replies before increasing volume.

## 10. Production verification

After each deployment:

1. Open `/health` and verify database, account and session configuration.
2. Open `/login` and test Admin/Waseem access.
3. Verify one own-scope team account.
4. Open `/prospects` and confirm scoped totals, filtering and pagination.
5. Open a prospect and run the lead audit.
6. Open `/tenders` and confirm strict source validation and Jawad routing.
7. Confirm Cron Jobs are visible in Vercel.
8. Keep outreach gates disabled unless the deliverability checklist has been completed.

The build runs TypeScript plus production smoke suites before Vercel creates the deployment.

## 11. Troubleshooting

### `DATABASE_URL is required`

Reconnect Neon or add the correct production connection string, then redeploy.

### A dashboard account cannot log in

Confirm the exact `*_DASHBOARD_PASSWORD` variable exists in the same Vercel environment as the URL being tested. Redeploy after changing variables.

### Dashboard actions return 403

The account lacks permission for a global operation or another owner's lead. Test with Admin/Waseem only when the action is intentionally global.

### Discovery or tender refresh returns 500

Inspect the Vercel function log for the reported phase and source error. Do not weaken validation to make a noisy source pass.

### Email reaches spam

Keep live outreach disabled. Verify SPF, DKIM, DMARC, return-path/from alignment and provider reputation before further sending.

### GitHub Actions fails with no steps

This repository has experienced runner failures before checkout. An empty job is not a code result. Use the Vercel build or a local `pnpm deploy:check` while the GitHub runner issue is investigated.
