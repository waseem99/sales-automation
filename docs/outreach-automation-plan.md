# Codistan Automated Outreach Rollout

## Confirmed operating model

- Email provider: cPanel-hosted mailboxes.
- Approval model: fully automatic only after a prospect passes qualification and compliance gates.
- Primary senders for launch: `talha.bashir@codistan.org` and `jawad.jutt@codistan.org`.
- Secondary senders after warm-up: `moiz.khalid@codistan.org`, `subainaaamir@codistan.org`, and `danishkhalid@codistan.org` once their sender profiles and mailbox connections are approved.
- Target steady-state volume: 50–100 new outbound messages per business day across the domain, not per mailbox.
- Sending window: recipient-local business hours.
- Reply notifications: Prospect Desk plus email notification.
- Equal administrator access for all configured dashboard users.
- Commercial-email footer address: Codistan Ventures Building, Plot No. 15, I-11/3, Islamabad 44000, Pakistan.

## Why Talha and Jawad are the launch senders

Talha and Jawad are already the original BD users and should own the initial reply flow. Starting with two accountable senders keeps replies, meetings and follow-ups easier to manage while the infrastructure is being validated. The other three accounts remain full dashboard administrators and become additional senders only after deliverability is stable and their signatures, SMTP/IMAP credentials and reply ownership are confirmed.

## Safety gates before the first automatic send

Automatic sending remains disabled until all of the following are configured and verified:

1. cPanel secure SMTP and IMAP settings for the active sender mailboxes.
2. SPF, DKIM and DMARC records for codistan.org.
3. Valid forward and reverse DNS for the sending host/IP where controlled by the hosting provider.
4. Approved sender identities, titles and signatures.
5. Approved public case-study and sales-material library.
6. Working unsubscribe endpoint and suppression list.
7. Bounce and reply ingestion through IMAP.
8. Duplicate-send prevention and per-domain rate controls.
9. Geographic and industry filters applied to company location and business category.
10. Reply-alert recipients confirmed.

Passwords, mailbox credentials and DNS credentials must be stored only as Vercel encrypted environment variables. They must not be committed to GitHub.

## Dashboard password environment variables

The application already reads these Vercel environment variables:

- `TALHA_DASHBOARD_PASSWORD`
- `JAWAD_DASHBOARD_PASSWORD`
- `MOIZ_DASHBOARD_PASSWORD`
- `SUBAINA_DASHBOARD_PASSWORD`
- `DANISH_DASHBOARD_PASSWORD`

The fixed private values must be entered directly in Vercel for Production and Preview, then the latest deployment must be redeployed.

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
- current cPanel hourly and daily send limits
- whether the host uses a shared or dedicated outgoing IP
- whether the host requires a different server hostname matching its TLS certificate

## Recommended volume ramp

The requested steady-state range is 50–100 messages per day across all sender accounts. Do not begin at that level on a cPanel/shared-IP setup.

- Days 1–3: 10 new messages/day total
- Days 4–6: 20 new messages/day total
- Days 7–10: 40 new messages/day total
- Day 11 onward: 50 new messages/day
- Increase toward 100 only when authentication passes, SMTP deferrals remain low, bounces remain controlled, complaint levels remain low and domain/IP reputation is stable

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

Preferred markets:

- United States
- Pakistan

Exclude:

- companies headquartered or primarily operating in Israel
- companies headquartered or primarily operating in India
- gambling
- adult businesses
- cryptocurrency

Pakistan must remain eligible and should not be blocked.

## Company-size and commercial qualification

Do not reject companies on employee count alone. A small AI or software company can be commercially valuable despite having a very small team.

Use this qualification model:

- Companies with 10 or more employees may pass the size gate when the remaining fit, evidence and contact requirements are met.
- Companies with 2–9 employees may pass only when at least two strong commercial signals are verified.
- One-person companies are rejected by default unless there is a verified live opportunity plus clear evidence of budget or revenue.

Strong commercial signals include:

- funding or investment within the last 24 months
- credible revenue or paid-product evidence
- recognised enterprise or government clients
- active hiring for relevant roles
- a recent expansion, partnership or contract
- an established high-ticket service business
- a clear live opportunity or active partner programme
- public evidence of budget or procurement

## Qualification gate

A prospect may enter automatic outreach only when:

- official company website is active
- company passes the commercial qualification model
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
