# Verified Public Contact Enrichment

The protected production runner is available at `/api/contact-enrichment` for Admin and Waseem.

## What it verifies

The verifier checks public HTML pages only and may retain:

- an official company website;
- a same-domain public business email;
- an official same-domain contact form;
- a public professional-profile link published by the company;
- a named buyer and role when both appear together in public page evidence;
- the evidence URLs and verification timestamp.

It rejects personal email providers such as Gmail, Yahoo, Hotmail and Outlook as verified business routes. It also rejects no-reply, privacy, abuse and webmaster addresses.

## Contact readiness

- `ready`: official website plus a verified business email or official contact form;
- `partial`: some credible company, buyer or contact evidence exists but a full route is missing;
- `research_required`: the available public evidence is insufficient.

Missing information is stored as a research gap. No company domain, buyer authority, email address or role is invented.

## Operation

Open `/api/contact-enrichment` while signed in as Admin/Waseem.

- Leave Lead ID blank to run a bounded backfill.
- Enter a Lead ID to verify one record.
- Maximum batch size is 50 records.

Updated records are rescored in place and no duplicate prospect is created.

The endpoint also accepts authorized JSON requests and CRON-secret authorization for controlled external scheduling. It is not configured as an additional Vercel cron in this release.

## Exclusions

- authenticated LinkedIn, Sales Navigator or Upwork scraping;
- guessing email patterns;
- purchasing or importing third-party private contact databases;
- treating personal email addresses as verified business contacts;
- tender records, which retain their formal procurement contact and submission workflow.
