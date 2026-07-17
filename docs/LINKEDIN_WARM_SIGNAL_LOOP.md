# LinkedIn and Sales Navigator automatic discovery loop

## Purpose

Automatically discover target companies, decision-maker profiles and recent buyer-side LinkedIn signals without requiring the team to copy and paste prospects into Prospect Desk.

The production loop uses native LinkedIn and Sales Navigator alerts plus public-web enrichment. It does not send LinkedIn messages or take any external sales action.

## Automatic sources

- Native Sales Navigator saved lead-search alerts.
- Native Sales Navigator saved account-search alerts.
- Sales Navigator lead and account alerts.
- Native LinkedIn notifications containing genuine buyer posts.
- Public search-engine snippets pointing directly to LinkedIn posts or activity URLs.
- Optional manual intake remains available only as a fallback; it is not required for the automatic loop.

The system does not reuse LinkedIn session cookies, crawl authenticated Sales Navigator pages, install a LinkedIn browser extension, send connection requests, send InMails, comment, follow, apply or bid.

## One-time Sales Navigator setup

Create and save lead/account searches for Codistan's approved target markets, decision-maker roles, company types and service themes. Enable native email alerts for each saved search and deliver those alerts to the configured signal mailbox.

This is a one-time configuration task. After the alerts are active, no prospect copying or profile pasting is required.

Recommended saved-search families:

- software, SaaS and digital-product decision makers;
- AI, automation, RAG and voice-AI leaders;
- cybersecurity and compliance buyers;
- agencies and studios needing delivery partners;
- AR, VR, 3D, Unity and Unreal decision makers;
- companies showing growth, funding, hiring or transformation signals.

## Dedicated signal mailbox

Automatic email intake requires a mailbox used only for LinkedIn and Sales Navigator signals. Do not reuse an outreach or reply mailbox because the reply worker may mark unrelated messages as seen.

Required configuration names:

```text
LINKEDIN_SIGNAL_MAILBOX_EMAIL
LINKEDIN_SIGNAL_MAILBOX_PASSWORD
```

Optional configuration names:

```text
LINKEDIN_SIGNAL_IMAP_HOST
LINKEDIN_SIGNAL_IMAP_PORT
LINKEDIN_SIGNAL_IMAP_SECURE
LINKEDIN_SIGNAL_IMAP_FOLDER
LINKEDIN_SIGNAL_MAX_MESSAGES
```

Native LinkedIn/Sales Navigator alerts are read directly. A manually forwarded message is accepted only when it comes from a Codistan address, has a forwarded subject and retains LinkedIn evidence.

## Two automatic qualification paths

### 1. Target-account research

Saved lead/account searches commonly identify a relevant person or company without proving an active buying requirement. These alerts are not rejected.

The system automatically:

1. recognizes the saved-search, lead-alert or account-alert format;
2. extracts LinkedIn profile, company, Sales Navigator lead and Sales Navigator account URLs;
3. extracts visible person, role, company and location context;
4. deduplicates by normalized target URL;
5. creates a cold prospect in `needs_research`;
6. searches for the official company website;
7. runs public company/contact enrichment;
8. evaluates and assigns the prospect to a BD owner;
9. records the exact evidence and recommended verification action.

A target-account record cannot become outreach-ready solely because Sales Navigator surfaced it. The person, current role, company fit and legitimate outreach basis must still be reviewed.

### 2. Warm buyer signals

Alerts containing an actual buyer requirement continue through the warm-signal quality gate.

Hard rejections include:

- employee vacancies and candidate applications;
- service-provider self-promotion;
- articles, tutorials, newsletters and educational content without buyer intent;
- individual, unpaid or clearly unrealistic requests;
- stale posts;
- public-index results without verifiable LinkedIn post evidence.

Warm-signal scoring evaluates explicit requirement, freshness, service fit, company credibility, buyer influence, evidence route, geography, approved proof and source reliability.

Bands:

- `priority_a`: strongest immediate buyer signals;
- `priority_b`: qualified buyer signals requiring normal review;
- `research`: target accounts, incomplete evidence and public-index results;
- `reject`: invalid or commercially unsuitable signals.

## Public-index research

The scheduled worker can run service-specific public searches using `site:linkedin.com/posts` queries. It stores only the search title, snippet and original LinkedIn URL. It does not fetch the LinkedIn page.

Every public-index record remains Research until a person opens and verifies the original post.

Configuration names:

```text
LINKEDIN_PUBLIC_INDEX_ENABLED
LINKEDIN_PUBLIC_INDEX_MAX_QUERIES
LINKEDIN_PUBLIC_INDEX_QUERIES
```

Custom queries can be separated by new lines or `||`.

## Processing loop

The `/api/cron/linkedin-signals` worker runs every 30 minutes:

1. Read unseen LinkedIn and Sales Navigator messages from the dedicated mailbox.
2. Collect enabled public-index LinkedIn post snippets.
3. Separate saved-search research alerts from genuine buyer-post signals.
4. Extract and normalize person, company, lead, account and post URLs.
5. Deduplicate by URL, message ID and content fingerprint.
6. Store target accounts as `needs_research` and qualified posts in their appropriate signal band.
7. Discover the official company website where possible.
8. Run verified public company and contact enrichment.
9. Assign a BD owner.
10. Generate approved first-outreach guidance only for genuine contact-ready buyer signals.
11. Rescore records and expose them in Prospect Desk.
12. Send an internal Priority A alert only when SMTP is configured.
13. Persist source and run statistics for Operations.
14. Mark mailbox messages as seen only after persistence succeeds.
15. Never perform an external LinkedIn or sales action.

## Internal Priority A alerts

Optional configuration names:

```text
LINKEDIN_SIGNAL_ALERTS_ENABLED
LINKEDIN_SIGNAL_ALERT_TO
```

The worker uses the existing SMTP configuration. Missing SMTP configuration does not fail ingestion; Priority A records remain visible in `/priorities`.

## Source controls

Admin/Waseem can pause or restore these sources from `/operations`:

- `linkedin_signal_inbox`
- `linkedin_public_index`

Every source-control change requires an audited reason.

## Human review boundary

For Priority A/B signals:

1. Open the original LinkedIn evidence.
2. Confirm that the requirement is current and buyer-authored.
3. Confirm the person and company relationship.
4. Review public contact-enrichment evidence.
5. Select approved portfolio proof.
6. Prepare a brief human-reviewed response.
7. Record outreach, reply, meeting, proposal and win/loss outcomes.

For Sales Navigator research prospects:

1. Verify the current role and company.
2. Confirm a legitimate service-fit or warm-signal basis.
3. Complete missing public company/contact evidence.
4. Move the prospect forward only after human qualification.
