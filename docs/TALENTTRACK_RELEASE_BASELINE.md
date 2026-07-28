# TalentTrack Pilot Release Baseline

## Authority

This document is the authoritative operating and release-status reference for the TalentTrack acquisition and BD workspace. Historical V4/V5 and Prospecting OS names remain only as compatibility identifiers until an accepted upgrade and rollback drill proves they can be retired safely.

## Product boundary

TalentTrack Pilot is one Windows-first operating system for:

1. approved Upwork saved-search opportunity capture;
2. warm LinkedIn buyer-requirement capture;
3. Sales Navigator cold direct-buyer and partner campaigns;
4. canonical evidence, identity, enrichment and campaign fit;
5. Prospect Desk assignment, tasks and next-best-action;
6. human-reviewed outreach drafting, exact approval and manual-send recording;
7. server-enforced commercial readiness before cold-outreach approval;
8. commercial funnel analytics and management calibration;
9. optional local PostgreSQL retention for collector captures with a JSON rollback shadow.

Every external proposal, message, InMail, connection request, comment, reaction, follow and email remains human-controlled. This release does not automate external account actions.

## Canonical release identity

| Item | Canonical value |
|---|---|
| Product | TalentTrack Pilot |
| Product version | 1.0.0 |
| Runtime version | 0.3.1 |
| State root | `%LOCALAPPDATA%\Codistan\Acquisition` |
| Default local capture store | JSONL |
| Optional local capture store | Loopback-only PostgreSQL with JSON rollback shadow |
| Installer | `START-HERE-TALENTTRACK.cmd` |
| Start | `START-TALENTTRACK.cmd` |
| Health | `CHECK-TALENTTRACK.cmd` |
| Full pilot gate | `CHECK-TALENTTRACK-PILOT.cmd` |
| Diagnostics | `DIAGNOSE-TALENTTRACK.cmd` |
| Rollback | `ROLLBACK-TALENTTRACK.cmd` |
| Review queue | `OPEN-TALENTTRACK-REVIEW.cmd` |
| Enable local PostgreSQL | `ENABLE-TALENTTRACK-POSTGRES.cmd` |
| Check local PostgreSQL | `CHECK-TALENTTRACK-POSTGRES.cmd` |
| Backup local PostgreSQL | `BACKUP-TALENTTRACK-POSTGRES.cmd` |
| Restore local PostgreSQL | `RESTORE-TALENTTRACK-POSTGRES.cmd` |

The internal Python package remains `acquisition_v4` during the pilot. Renaming it would create migration risk without changing operator behavior. The package name is therefore classified as a compatibility implementation detail, not the product name.

## Component status registry

| Component | State | Current boundary | Exit or reactivation criterion |
|---|---|---|---|
| Upwork approved saved-search capture | `live-validation` | Normal logged-in Chrome; bounded visible-card capture; manual proposal submission | 100 unique records, at least 15 Priority A/B, evidence thresholds and successful Prospect Desk sync |
| LinkedIn warm discovery | `live-validation` | Approved searches; buyer-authored demand only; no messaging | 50 unique records, at least 10 Priority A/B, canonical/profile thresholds and commercial review |
| Sales Navigator campaigns | `live-validation` | Explicitly registered searches; cold-fit labels; no account actions | 75 unique records, at least 15 Priority A/B, evidence/cold-warning thresholds and commercial review |
| Combined human commercial gate | `live-validation` | Priority A/B records only; reviewer and review time required | At least 15 reviews, at least three per source and at least 60% accepted for pursuit |
| Local JSONL capture store | `active` | Default source-isolated records, seen fingerprints and status | Retained as fallback baseline and rollback shadow |
| Optional local PostgreSQL capture store | `live-validation` | Operator-enabled, loopback-only, fail-closed, JSON shadow retained | Windows enable/check/backup/restore drill and real source pilot pass |
| Prospect Desk synchronization | `live-validation` | Bearer-token ingestion; independent source retries | All three sources sync without losing owner or BD history |
| Production Prospect Desk PostgreSQL | `active` | Existing Neon/PostgreSQL production boundary remains unchanged | Production synchronization and rollback proof pass |
| Identity and evidence enrichment | `active` | Provenance and conflicts retained; reversible resolution | Pilot defect rate accepted |
| Offer and campaign engine | `active` | Versioned offers and separate direct/channel/overflow lanes | At least one product and one service campaign reviewed |
| Commercial readiness enforcement | `active` | Server and UI block research-only, on-hold, unknown or unmapped cold offers | Offer owner explicitly approves claims, proof, capacity and pricing boundaries |
| BD workflow and next-best-action | `active` | Human-owned tasks, follow-ups and evidence-grounded recommendations | Pilot team operates without spreadsheets |
| Pilot operations queues | `active` | Priority review, pilot blockers, source-separated queues and sample progress | Pilot team confirms queues are usable on real records |
| Human-controlled outreach workbench | `active` | Exact revision approval and immutable manual-send records | Review and sent-history pilot accepted |
| Commercial analytics and calibration | `active` | Real stored events, explicit values and management decisions | Representative reviewed sample available |
| Automatic external outreach | `on-hold` | No transport or platform action in the pilot | Separate platform, security, compliance and commercial approval |
| Historical Playwright/browser-control experiments | `superseded-reference` | Retained for decision history only | Remove only after retention review; never install or operate |
| V4/Prospecting OS command names and `acquisition_v4` module | `superseded-reference` | Compatibility aliases and internal package only | One accepted upgrade and rollback drill with no dependency |

## Consolidated implementation chain

The accepted historical implementation order is:

1. PR #223 — warm acquisition/runtime foundation;
2. PR #225 — Sales Navigator cold campaigns;
3. PR #236 onward — scheduled capture, identity, enrichment, campaign and account intelligence;
4. PR #251 — operational BD workspace;
5. PR #254 — authoritative outreach workbench;
6. PR #256 — authoritative commercial analytics and calibration;
7. PR #257 — canonical installer, naming, diagnostics, rollback and status registry;
8. PR #258 — optional local PostgreSQL capture persistence;
9. the consolidated TalentTrack release branch — repository CI correction, commercial-readiness preservation, full pilot gate and pilot usability queues.

PR #255 remains a superseded source branch after its commercial-readiness and combined pilot controls are carried into the consolidated TalentTrack branch. Closed PRs #252 and #253 are obsolete implementations and must not be reintroduced.

The consolidated draft pull request to `main` is the only future merge candidate. Historical stacked PRs must not be merged individually after the consolidated PR is verified.

## Commercial readiness rules

### FinTech Backend Operations Platform

Cold outreach remains `research_only` until the offer owner approves:

- exact workflows, users and measurable pilot outcome;
- externally usable demo, screenshots or architecture;
- supported integrations and deployment boundaries;
- pilot scope and pricing hypothesis;
- relevant financial-services proof or explicitly limited proxy proof;
- approved security, privacy and compliance statements.

Warm buyer requirements may receive a human-reviewed response within verified service capability, but the product must not be presented as production-ready.

### Managed Software and AI Delivery Partnership

Cold outreach is `outreach_ready_limited`. Approval requires confirmation of:

- the relevant delivery lane;
- proof relevant to that lane;
- team availability and mobilisation timing;
- white-label, NDA, ownership and client-contact boundaries.

The system blocks unsupported claims such as unlimited capacity, immediate mobilisation or inferred buyer pressure.

## Full pilot acceptance

Run `CHECK-TALENTTRACK-PILOT.cmd`. It checks all sources together and writes:

```text
%LOCALAPPDATA%\Codistan\Acquisition\review\talenttrack-pilot-acceptance.json
```

Human review input is stored at:

```text
%LOCALAPPDATA%\Codistan\Acquisition\review\commercial-review.json
```

The full release gate requires:

- **Upwork:** at least 100 unique records and 15 Priority A/B;
- **LinkedIn warm:** at least 50 unique records and 10 Priority A/B;
- **Sales Navigator:** at least 75 unique records and 15 Priority A/B;
- source-specific identity, canonical evidence, profile/company/role and cold-warning thresholds;
- zero external-action evidence;
- at least 15 valid human Priority A/B reviews;
- at least three reviews from each source;
- at least 60% accepted for pursuit.

Exit results:

- `0` — technical and human commercial gates passed;
- `2` — more records, evidence or human reviews are required;
- `1` — external-action evidence or another blocking safety failure;
- `3` — a collector is unavailable or unsafe.

A passed gate permits release consideration only. It never enables automatic external actions.

## Storage boundary

JSONL remains the default local collector store. PostgreSQL is enabled only through `ENABLE-TALENTTRACK-POSTGRES.cmd` after Docker Desktop is available.

When PostgreSQL is enabled:

- the service binds only to `127.0.0.1`;
- the secret remains under the stable state root with current-user ACLs;
- PostgreSQL becomes authoritative for records, seen fingerprints and collector status;
- existing JSONL data is imported only when the source table is empty;
- every committed database write is mirrored to JSON as a rollback shadow;
- collectors fail closed if PostgreSQL becomes unavailable;
- no automatic fallback can create a divergent second history;
- native custom-format backups and checksum metadata remain outside application packages;
- restore requires explicit confirmation and a new pre-restore safety backup.

This optional local store does not replace or modify Prospect Desk's existing production PostgreSQL/Neon boundary. Detailed operations are in [`TALENTTRACK_LOCAL_POSTGRES.md`](TALENTTRACK_LOCAL_POSTGRES.md).

## Upgrade behavior

Installation must:

- keep `%LOCALAPPDATA%\Codistan\Acquisition` unchanged;
- preserve `records.jsonl`, `seen.json`, review output, sync fingerprints and configuration;
- preserve the local PostgreSQL named volume, secret file, public non-secret config and backups;
- install the pinned supported Psycopg binary dependency;
- stop only the currently registered TalentTrack/legacy acquisition runtime processes;
- move `app-current` to `app-previous` before replacing application files;
- install canonical TalentTrack commands and shortcuts;
- retain legacy command wrappers during the compatibility period;
- detect whether JSONL or PostgreSQL is the configured backend;
- validate all three collector health endpoints and expected backend before reporting success;
- automatically restore the previous application package if dependency or health validation fails.

## Rollback behavior

Rollback restores `app-previous` as `app-current` without deleting state. Captured records, deduplication fingerprints, review output, synchronization configuration, local PostgreSQL volume, secrets, backups and JSON rollback shadow remain outside the application package and must survive both upgrade and rollback.

## Operator acceptance sequence

1. Run `START-HERE-TALENTTRACK.cmd`.
2. Confirm the canonical TalentTrack desktop and startup shortcuts exist.
3. Reload the Upwork and LinkedIn unpacked extensions from the documented state root.
4. Run `CHECK-TALENTTRACK.cmd` and confirm ports 8765, 8775 and 8785 are healthy.
5. Run `DIAGNOSE-TALENTTRACK.cmd` and confirm diagnostics contain no credentials, cookies, opportunity bodies, database connection URL or sync token.
6. Run sanitized fixture regressions.
7. Optionally enable local PostgreSQL and confirm all collectors report `storage_backend=postgresql`.
8. Run one native PostgreSQL backup and restore drill; verify the JSON shadow is refreshed and no state is lost.
9. Run the independent Upwork, LinkedIn and Sales Navigator live acceptance checks.
10. Use the Priority A/B review and pilot-blocker queues in Prospect Desk to complete owner, next action, due date, channel and proof fields.
11. Confirm Prospect Desk preserves assignment, outreach and outcome history on repeated enrichment.
12. Complete `commercial-review.json` and run `CHECK-TALENTTRACK-PILOT.cmd`.
13. Perform one application rollback drill and verify database and local state are unchanged.
14. Advance the release only after management records source and campaign keep/change/stop decisions.

## Merge policy

`main` must not be updated merely because code checks pass. The release requires:

- green repository deployment CI and green consolidated release CI;
- one coherent Windows installer and diagnostics package;
- successful real-source acceptance for warm and cold lanes;
- the combined technical and human commercial gate;
- PostgreSQL/Prospect Desk synchronization proof;
- local PostgreSQL enable/check/backup/restore evidence when that mode is selected;
- state-preserving upgrade and rollback evidence;
- explicit confirmation that no external action was automated.

Only after those conditions pass may the consolidated draft PR be marked ready, merged into `main`, deployed as the production baseline and tagged as the accepted TalentTrack Pilot release.
