# Sales Navigator automatic discovery — release checklist

## Release rule

Do not merge or deploy solely because the pull request is mergeable. Release only after an executable build/test gate and one real native Sales Navigator alert have passed.

## 1. Repository validation

- [ ] GitHub Actions can allocate a runner and display job steps.
- [ ] `LinkedIn Sales Navigator CI` completes successfully.
- [ ] Workspace build passes on Node.js 22 and pnpm 9.15.9.
- [ ] Vercel runtime type-check passes.
- [ ] Unified mailbox tests pass.
- [ ] Sales Navigator research tests pass.
- [ ] Existing Prospect Desk runtime-contract tests pass.
- [ ] PR remains free of LinkedIn cookies, credentials and exported mailbox content.

## 2. Production configuration

Configure a dedicated lead-signal mailbox. Do not use the normal outreach/reply mailbox.

Required:

```text
LEAD_SIGNAL_MAILBOX_EMAIL
LEAD_SIGNAL_MAILBOX_PASSWORD
```

Recommended explicit settings:

```text
LEAD_SIGNAL_IMAP_HOST
LEAD_SIGNAL_IMAP_PORT=993
LEAD_SIGNAL_IMAP_SECURE=true
LEAD_SIGNAL_IMAP_FOLDER=INBOX
LEAD_SIGNAL_MAX_MESSAGES_PER_SOURCE=40
```

Confirm these existing settings are available:

```text
DATABASE_URL
CRON_SECRET
```

Optional internal Priority A alerting:

```text
LEAD_SIGNAL_ALERTS_ENABLED=true
LEAD_SIGNAL_ALERT_TO=waseem@codistan.org,sales@codistan.org
OUTREACH_SMTP_HOST
OUTREACH_SMTP_PORT
OUTREACH_SMTP_SECURE
SMTP_USER
SMTP_PASSWORD
```

## 3. Source controls

In Operations confirm:

- [ ] `linkedin_signal_inbox` is enabled.
- [ ] `linkedin_public_index` is enabled only when public-index research is intended.
- [ ] Old Chromium/Playwright LinkedIn tasks do not exist.
- [ ] No automatic connection, InMail, follow or comment action is enabled.

## 4. Initial Sales Navigator pilot

Start with one lead search and one account search for AI/software decision makers.

Suggested target characteristics:

- decision makers in technology, product, operations or executive leadership;
- commercially relevant companies rather than recruiters or individual job seekers;
- target geographies approved by Codistan;
- company size and industry suitable for Codistan's delivery capacity;
- keywords around AI automation, SaaS, workflow automation, RAG, internal platforms or digital transformation.

Enable native Sales Navigator email alerts and deliver them to the dedicated lead-signal mailbox.

## 5. First real-alert acceptance test

For the first native alert, verify all of the following:

- [ ] The cron reads the email once.
- [ ] The person or account URL is retained and canonicalized.
- [ ] Name, role, company and location are extracted where present.
- [ ] The record is created as `sales_navigator_cold_prospect`.
- [ ] The pipeline status is `needs_research`.
- [ ] The official company website is discovered when reliable evidence exists.
- [ ] Public contact enrichment runs without inventing contact details.
- [ ] An owner is assigned.
- [ ] The same alert is deduplicated on a second run.
- [ ] A genuine LinkedIn buyer post remains in Priority A/B warm-signal qualification rather than the cold-research route.
- [ ] No LinkedIn message, connection request, follow, comment or application occurs.
- [ ] The mailbox message is marked read only after persistence succeeds.

## 6. Pilot quality review

Review the first 20 created records before adding more saved searches.

Measure:

- correct person/company identification;
- correct current role;
- correct official website;
- commercially relevant service fit;
- duplicate rate;
- irrelevant recruiter/job-seeker rate;
- false warm-signal rate;
- enrichment evidence quality;
- owner-routing accuracy.

Do not widen search volume until the sample is acceptable.

## 7. Rollback

If the worker creates poor or incorrect records:

1. Disable `linkedin_signal_inbox` in Operations with an audited reason.
2. Leave existing records in `needs_research`; do not contact them.
3. Preserve the source emails for parser review.
4. Revert the release commit or redeploy the previous production revision.
5. Correct fixtures and qualification logic before restoring the source.

Rollback must not require changing the LinkedIn or Sales Navigator password because no login credential is used by the worker.
