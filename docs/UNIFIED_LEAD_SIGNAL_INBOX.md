# Unified lead-signal inbox

## Purpose

Use one controlled alert mailbox for Upwork saved-search alerts, LinkedIn notifications, Sales Navigator alerts and approved manual forwards while keeping source parsing, quality rules and acknowledgement isolated.

The shared mailbox is an alert-intake mailbox only. It must not be used as the prospect-reply mailbox.

## Configuration

Required:

```text
LEAD_SIGNAL_MAILBOX_EMAIL
LEAD_SIGNAL_MAILBOX_PASSWORD
```

Optional:

```text
LEAD_SIGNAL_IMAP_HOST
LEAD_SIGNAL_IMAP_PORT=993
LEAD_SIGNAL_IMAP_SECURE=true
LEAD_SIGNAL_IMAP_FOLDER=INBOX
LEAD_SIGNAL_MAX_MESSAGES_PER_SOURCE=40
LEAD_SIGNAL_APPROVED_FORWARDERS=waseem@codistan.org,talha.bashir@codistan.org,sales@codistan.org
LEAD_SIGNAL_UPWORK_SENDERS=donotreply@upwork.com
```

The existing `LINKEDIN_SIGNAL_MAILBOX_*` and `OUTREACH_IMAP_*` values remain fallback configuration for backward compatibility. The unified worker never falls back to the outreach reply mailbox email or password.

## Source isolation

The 30-minute worker performs separate unread IMAP searches for:

- approved Upwork sender addresses;
- native LinkedIn sender domains;
- each approved internal forwarder.

Results are merged by UID only after the separate searches complete. A large number of Upwork messages therefore cannot prevent LinkedIn or Sales Navigator messages from being inspected.

Only messages that match a supported source are parsed. Only messages whose resulting lead batch has been persisted successfully are marked read.

## Approved forwarding

A manually forwarded alert is accepted only when:

- the sender appears in `LEAD_SIGNAL_APPROVED_FORWARDERS`;
- the subject begins with `Fwd:` or `Fw:`;
- the body contains a supported LinkedIn post/activity URL or Upwork job URL.

Unapproved forwarded messages remain untouched.

## Upwork quality controls

Optional thresholds:

```text
UPWORK_MIN_FIXED_BUDGET_USD=500
UPWORK_MIN_HOURLY_RATE_USD=15
UPWORK_MAX_AGE_HOURS=168
```

The Upwork score evaluates:

- service fit;
- fixed or hourly budget fit;
- posting freshness;
- payment verification, prior spend and hire rate when present;
- project clarity;
- original Upwork evidence URL;
- matching approved portfolio proof.

Hard rejections include:

- permanent employee roles;
- unpaid, free, student or no-budget work;
- fixed budgets or hourly rates below configured minimums;
- stale alerts;
- unsupported services;
- missing or invalid Upwork job URLs.

Missing budget or client-history data produces research reasons rather than invented facts.

## LinkedIn and Sales Navigator

LinkedIn-specific safeguards remain unchanged:

- no authenticated LinkedIn or Sales Navigator scraping;
- no session-cookie reuse or browser automation;
- public-index snippets remain research-only until the original post is opened and verified;
- no connection request, InMail, message, comment or application is automated.

## Processing sequence

The existing `/api/cron/linkedin-signals` route now performs the unified cycle every 30 minutes:

1. Load source controls.
2. Search the shared inbox separately by source.
3. Parse Upwork and LinkedIn messages independently.
4. Apply source-specific hard rejections and scoring.
5. Deduplicate by source URL, message evidence and lead ID.
6. Assign an owner.
7. Add approved first-outreach guidance.
8. Run public contact enrichment only when an official company website exists.
9. Recalculate closeability.
10. Persist leads and the discovery run to Neon.
11. Mark accepted inbox messages read.
12. Send an internal Priority A alert when SMTP is configured.
13. Never perform an external application or message.

## Workspaces

- `/lead-signals`: combined Upwork, LinkedIn and Sales Navigator intake/review.
- `/linkedin-signals`: retained for LinkedIn-specific manual intake compatibility.
- `/priorities`: owner-scoped Priority A/B action queue.
- `/operations`: source performance and pause/resume controls.

## Source controls

The operations workspace includes:

- `upwork_saved_search_inbox`;
- `linkedin_signal_inbox`;
- `linkedin_public_index`.

Pausing one source does not pause the others.

## Human responsibilities

Before pursuing a Priority A/B signal, the owner must open the original source, confirm it is active, verify missing buyer/client information, choose approved proof and review the proposed response. Upwork proposals and LinkedIn outreach remain entirely human-controlled.
