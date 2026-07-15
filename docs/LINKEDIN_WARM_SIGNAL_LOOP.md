# LinkedIn warm signal inbox and quality loop

## Purpose

Capture recent buyer-side LinkedIn and Sales Navigator requests without scraping authenticated LinkedIn sessions or automating external actions.

## Approved sources

- Native LinkedIn and Sales Navigator alert emails delivered to a dedicated signal mailbox.
- LinkedIn post text and URLs pasted by Admin/Waseem at `/linkedin-signals`.
- Public search-engine snippets that point directly to LinkedIn post or activity URLs.

The system does not log into LinkedIn, reuse session cookies, crawl Sales Navigator pages, run a browser extension, send connection requests, send InMails, comment, apply or bid.

## Dedicated signal mailbox

Automatic email intake requires a mailbox used only for LinkedIn signals. Do not reuse an outreach or reply mailbox because the reply worker can mark unmatched messages as seen.

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

A manually forwarded message is accepted only when it comes from a Codistan address, has a forwarded subject and contains a LinkedIn post or activity URL.

## Public-index research

The scheduled worker runs service-specific public searches using `site:linkedin.com/posts` queries. It stores only the search title, snippet and original LinkedIn URL. It does not fetch the LinkedIn page.

Every public-index record is forced into the Research band and must be opened and verified by a person before contact readiness.

Configuration names:

```text
LINKEDIN_PUBLIC_INDEX_ENABLED
LINKEDIN_PUBLIC_INDEX_MAX_QUERIES
LINKEDIN_PUBLIC_INDEX_QUERIES
```

Custom queries can be separated by new lines or `||`.

## Quality gate

Hard rejections include:

- employee vacancies and candidate applications;
- service-provider self-promotion;
- articles, tutorials, newsletters and educational content without buyer intent;
- no active buyer or project requirement;
- individual, unpaid or clearly unrealistic requests;
- posts older than 30 days;
- public-index results that do not point to a LinkedIn post or activity URL.

The warm-signal score evaluates explicit requirement, freshness, service fit, company credibility, buyer influence, original evidence route, geography, approved proof and source reliability.

Bands:

- `priority_a`: 85–100;
- `priority_b`: 75–84;
- `research`: 60–74, plus every public-index result;
- `reject`: below 60 or any hard rejection.

## Processing loop

The `/api/cron/linkedin-signals` worker runs every 30 minutes:

1. Read unseen messages from the dedicated signal mailbox.
2. Collect public-index LinkedIn post snippets.
3. Normalize post URLs and message IDs.
4. Reject invalid signals with reason codes.
5. Deduplicate by URL, message ID and content fingerprint.
6. Evaluate and store accepted signals.
7. Assign a BD owner.
8. Generate approved first-outreach guidance.
9. Run verified public company and contact enrichment.
10. Rescore the record and expose it in `/priorities`.
11. Send an internal Priority A alert only when SMTP is configured.
12. Persist source and run statistics for `/operations`.
13. Never perform an external LinkedIn or sales action.

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

Every source-control change requires an audited reason. Disabling one source does not disable manual intake at `/linkedin-signals`.

## Human operating procedure

For Priority A/B signals:

1. Open the original LinkedIn post.
2. Confirm the requirement is still active and buyer-authored.
3. Confirm the person and company relationship.
4. Review contact-enrichment evidence.
5. Select approved portfolio proof.
6. Prepare a brief human-reviewed response.
7. Record outreach, reply, meeting, proposal and win/loss outcomes.

Public-index signals remain Research until the original post and buyer relationship are verified.
