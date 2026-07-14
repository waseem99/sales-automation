# Sales Operations Observability

The authenticated `/operations` workspace shows source quality, campaign/run health, deployment revision and outreach configuration without requiring routine access to Neon or provider consoles.

## Access

- Every authenticated team member may view operational health.
- Only Admin and Waseem may enable or disable discovery sources.
- Every source-control change requires a reason and stores the actor and timestamp in Neon.

## Source controls

Production controls cover:

- Bing RSS public search;
- RemoteOK;
- Greenhouse;
- Lever;
- approved generic RSS feeds;
- PPRA/EPADS;
- CanadaBuys;
- UNGM;
- private/nonprofit tender sources;
- expanded public tender sources.

Safe defaults keep RemoteOK, Greenhouse, Lever and unapproved generic RSS feeds disabled. A paused source remains paused in both scheduled and manual discovery runs. Tender controls also apply to the tender refresh endpoint.

## Commercial source performance

The operations workspace calculates, per source:

- total and active records;
- active-pipeline share;
- contact-ready records;
- replies, meetings, proposals, wins, losses and rejections;
- Priority A and Priority B counts;
- average BD relevance rating;
- accurate-contact count;
- increase, keep, reduce and stop recommendations.

Warnings appear when a source dominates the active queue, creates substantial volume without replies, or receives consistently weak BD feedback.

## Run health

Final discovery runs record:

- active campaigns;
- query count;
- checked and accepted candidates by source;
- source-specific errors;
- new and duplicate records;
- employee-vacancy rejection count;
- closeability rescore count;
- duration and completion status.

A source failure is shown separately from a successful source check that found zero candidates.

## Deployment and outreach configuration

The page shows the deployed Vercel commit, region and environment, plus configuration status for:

- outbound sending;
- DNS readiness;
- dry-run mode;
- reply polling;
- SMTP;
- IMAP;
- sales mailbox credentials.

No passwords, message bodies or private contact data are displayed.

GitHub Actions jobs have intermittently failed before checkout, so the page states that the production Vercel build remains the enforced release gate until runner reliability is restored.

## Remaining delivery telemetry

This release exposes outreach configuration health and recorded prospect outcomes. Persisted provider-level bounce, deferral, suppression and mailbox polling event telemetry remains a separate follow-up under issue #87.
