# Delivery and mailbox telemetry

## Purpose

Issue #87 requires provider-level outreach and mailbox failures to be visible without exposing message contents, credentials or private recipient data.

The existing hourly Vercel route `/api/cron/outreach` now records privacy-safe telemetry directly after its normal outreach cycle. The route, locking, sending gates, reply processing and response contract remain unchanged. Telemetry persistence is isolated so a telemetry failure cannot fail or alter the outreach response.

## Events

Persisted event types include:

- outreach-cycle completion;
- SMTP delivery, temporary deferral and permanent/unclassified failure;
- IMAP poll and IMAP failure;
- reply and bounce classification;
- suppression and alert processing;
- lock skips and worker failures.

## Privacy boundaries

Telemetry may retain:

- internal Codistan mailbox address;
- lead ID;
- external recipient **domain** only;
- classification, counters, response code or sanitized error summary;
- timestamps, duration and occurrence count.

Telemetry must not retain:

- message bodies;
- email subjects;
- recipient email addresses;
- reply text;
- credentials, cookies, tokens or authorization headers;
- raw MIME or provider payloads.

The storage sanitizer removes sensitive keys and redacts email addresses from permitted string summaries.

## Deduplication and rate limiting

Each operational condition is bucketed by event type, status, provider, worker, mailbox, lead, recipient domain and UTC hour. Repeated occurrences within the hour update one row and increment `occurrence_count` rather than generating repeated alerts.

Data older than 90 days is pruned after successful outreach telemetry processing.

## Workspace

Admin and Waseem can open `/delivery-health` to review:

- deliveries, deferrals and failures;
- successful and failed IMAP polls;
- replies, bounces and suppressions;
- worker and lock health;
- mailbox-level summaries;
- the latest privacy-safe events;
- stale reply polling and elevated failure-rate warnings.

The JSON representation is available from the same authenticated endpoint when HTML is not requested.

## Operating response

- Temporary deferrals should be monitored before changing sending volume.
- Permanent SMTP failures and bounces should be investigated by recipient domain and lead record.
- Suppressed prospects must remain excluded from planning.
- An enabled reply poller without a successful IMAP event for 24 hours requires immediate mailbox review.
- Repeated lock skips indicate overlapping or abnormally long outreach cycles.
- Telemetry persistence errors are logged but never alter the original outreach cycle response.
