# Codistan Automated Outreach Rollout

## Confirmed operating model

- Email provider: cPanel-hosted mailboxes.
- Approval model: fully automatic after a prospect passes qualification and compliance gates.
- Target steady-state volume: 50–100 new outbound messages per business day across the domain, not per mailbox.
- Sending window: recipient-local business hours.
- Reply notifications: Prospect Desk plus email notification.
- Equal administrator access for all configured dashboard users.

## Safety gates before the first automatic send

Automatic sending remains disabled until all of the following are configured and verified:

1. Exact Codistan physical postal address or valid registered PO box for the commercial-email footer.
2. cPanel secure SMTP and IMAP settings for every sender mailbox.
3. SPF, DKIM and DMARC records for codistan.org.
4. Valid forward and reverse DNS for the sending host/IP where controlled by the hosting provider.
5. Approved sender identities, titles and signatures.
6. Approved public case-study and sales-material library.
7. Working unsubscribe endpoint and suppression list.
8. Bounce and reply ingestion through IMAP.
9. Duplicate-send prevention and per-domain rate controls.
10. Geographic and industry filters applied to company location and business category.

Passwords, mailbox credentials and DNS credentials must be stored only as Vercel encrypted environment variables. They must not be committed to GitHub.

## Sender configuration to collect

For every sender:

- full display name
- job title
- sending mailbox
- phone/WhatsApp number, if approved for the signature
- LinkedIn profile, if approved
- final plain-text signature
- services they are best positioned to represent
- countries/time zones they can handle for replies and calls

## cPanel connection information

Collect the values shown in cPanel under Email Accounts → Connect Devices:

- incoming IMAP server hostname
- IMAP SSL port, normally 993
- outgoing SMTP server hostname
- SMTP SSL port, normally 465
- full mailbox username
- whether the host requires a different server hostname matching its TLS certificate

## Recommended volume ramp

The requested steady-state range is 50–100 messages per day across all sender accounts. Do not begin at that level on a cPanel/shared-IP setup.

- Days 1–3: 10 new messages/day total
- Days 4–6: 20 new messages/day total
- Days 7–10: 35–40 new messages/day total
- Thereafter: 50 new messages/day, increasing toward 100 only when authentication passes, SMTP deferrals remain low, bounces remain controlled and no reputation warning appears

Messages should be distributed evenly across configured mailboxes and sent at a consistent rate rather than in bursts.

## Follow-up sequence

Use a four-touch sequence, stopping immediately after any reply, opt-out, hard bounce or manual rejection.

1. Day 0 — personalised introduction based on one verified company signal and one relevant Codistan service.
2. Day 3 — one relevant case study or proof point; no attachment unless requested.
3. Day 7 — a specific low-risk pilot, delivery-pod or white-label collaboration idea.
4. Day 14 — polite close-the-loop message asking whether to send examples, revisit later or stop contact.

One clear call to action per email. Do not use false “Re:” or “Fwd:” subjects.

## Targeting rules

Apply exclusions at the company/entity level, not based on an individual person’s ethnicity or nationality.

Exclude:

- companies headquartered or primarily operating in excluded countries once the final country list is confirmed
- Pakistan-based companies unless the owner later removes that exclusion
- gambling
- adult businesses
- cryptocurrency
- companies below the agreed minimum size threshold

Until the contradictory Pakistan instruction is resolved, the system should target the United States and other approved non-excluded markets, while excluding Pakistan-based prospects.

## Qualification gate

A prospect may enter automatic outreach only when:

- official company website is active
- company size passes the minimum threshold
- country and industry pass filters
- business email is verified or obtained from an official company source
- evidence and reason for outreach are current
- one Codistan service is clearly matched
- one approved proof asset is available
- personalised message passes quality checks
- recipient is not on the suppression list
- no prior outreach exists for the same person/company/service within the configured cooling period

## Required system components

- per-mailbox SMTP sending
- IMAP reply and bounce ingestion
- recipient-local-time scheduler
- automatic personalised draft generation
- compliance and qualification gate
- follow-up scheduler
- suppression and unsubscribe management
- automatic stop-on-reply
- dashboard and email notifications
- delivery, reply, meeting, proposal and outcome analytics
- domain/mailbox throttling and pause controls
