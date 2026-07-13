# cPanel Outreach Engine

## Mail infrastructure

The implementation is configured for GreenGeeks implicit TLS:

- SMTP: `sgp200.greengeeks.net:465`
- IMAP: `sgp200.greengeeks.net:993`
- Hosting account limit: 300 messages/hour
- Sending IP: shared

The application deliberately operates far below the hosting limit. It uses a gradual daily ramp, per-mailbox limits, per-recipient-domain limits and recipient-local business hours.

## DNS gate

Cloudflare is authoritative for `codistan.org`. The DKIM and DMARC records shown by cPanel must therefore exist in Cloudflare DNS. Installing the suggested DKIM record only inside cPanel is not sufficient.

Before live sending:

1. Add or verify the cPanel-provided DKIM TXT value at `default._domainkey` in Cloudflare.
2. Verify there is exactly one SPF TXT record for the root domain.
3. Verify the DMARC TXT record at `_dmarc` is visible publicly.
4. Re-run cPanel Email Deliverability and confirm the DKIM/DMARC warnings have cleared.
5. Send a test to external Gmail and Microsoft mailboxes and inspect authentication results.

Keep these gates until the checks pass:

```text
OUTREACH_SENDING_ENABLED=false
OUTREACH_DNS_READY=false
OUTREACH_DRY_RUN=true
```

## Vercel mailbox secrets

Create encrypted Vercel environment variables for the five mailbox passwords:

```text
TALHA_MAILBOX_PASSWORD
JAWAD_MAILBOX_PASSWORD
MOIZ_MAILBOX_PASSWORD
SUBAINA_MAILBOX_PASSWORD
DANISH_MAILBOX_PASSWORD
```

Do not commit or send the values through GitHub or chat.

## Shared connection settings

```text
OUTREACH_SMTP_HOST=sgp200.greengeeks.net
OUTREACH_SMTP_PORT=465
OUTREACH_SMTP_SECURE=true
OUTREACH_IMAP_HOST=sgp200.greengeeks.net
OUTREACH_IMAP_PORT=993
OUTREACH_IMAP_SECURE=true
OUTREACH_SENDER_EMAILS=talha.bashir@codistan.org,jawad.jutt@codistan.org
OUTREACH_ALERT_EMAILS=waseem@codistan.org,sales@codistan.org
OUTREACH_UNSUBSCRIBE_EMAIL=sales@codistan.org
OUTREACH_REPLY_POLLING_ENABLED=true
OUTREACH_ALERTS_ENABLED=true
```

All five configured mailboxes are polled for replies. Talha and Jawad remain the launch senders unless `OUTREACH_SENDER_EMAILS` is changed after warm-up.

## Warm-up controls

Set the ramp start only when DNS and test delivery are healthy:

```text
OUTREACH_RAMP_STARTED_AT=2026-07-15T00:00:00+05:00
OUTREACH_DAILY_LIMIT=50
OUTREACH_MAX_PER_CYCLE=10
OUTREACH_MAX_PER_MAILBOX_PER_CYCLE=5
OUTREACH_MAX_PER_RECIPIENT_DOMAIN_PER_CYCLE=2
OUTREACH_LOCAL_START_HOUR=9
OUTREACH_LOCAL_END_HOUR=16
```

The built-in ramp is:

- days 1–3: 10 messages/day across the domain
- days 4–6: 20/day
- days 7–10: 40/day
- thereafter: 50/day

The configured daily limit cannot exceed 100.

## Live activation

After DNS and external test messages pass:

```text
OUTREACH_DNS_READY=true
OUTREACH_DRY_RUN=false
OUTREACH_SENDING_ENABLED=true
```

All three conditions plus a valid ramp start and at least one configured active sender are required before SMTP delivery occurs.

## Background processing

Vercel calls `/api/cron/outreach` hourly. Each cycle:

1. polls all configured inboxes through IMAP
2. matches replies to sent prospect messages
3. classifies replies and prepares formal response guidance
4. stops sequences on reply, opt-out, bounce or rejection as applicable
5. alerts the assigned owner, `waseem@codistan.org` and `sales@codistan.org`
6. plans and sends only due, qualified messages within the recipient’s local business hours
7. persists all activity and deduplication records to Neon

Pricing, legal, contractual, security, compliance, complaint and ambiguous responses remain human-approved. The engine never sends the suggested reply automatically.
