# TalentTrack Pilot Release Baseline

## Authority

This document is the authoritative operating and release-status reference for the TalentTrack acquisition and BD workspace. Historical V4/V5 names remain only as compatibility identifiers until an accepted upgrade and rollback drill proves they can be retired safely.

## Product boundary

TalentTrack Pilot is one Windows-first operating system for:

1. approved Upwork saved-search opportunity capture;
2. warm LinkedIn buyer-requirement capture;
3. Sales Navigator cold direct-buyer and partner campaigns;
4. canonical evidence, identity, enrichment and campaign fit;
5. Prospect Desk assignment, tasks and next-best-action;
6. human-reviewed outreach drafting, exact approval and manual-send recording;
7. commercial funnel analytics and management calibration;
8. optional local PostgreSQL retention for collector captures with a JSON rollback shadow.

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
| Upwork approved saved-search capture | `live-validation` | Normal logged-in Chrome; bounded visible-card capture; manual proposal submission | Accepted real-source sample and successful Prospect Desk sync |
| LinkedIn warm discovery | `live-validation` | Approved searches; buyer-authored demand only; no messaging | Canonical-link and commercial-review acceptance sample passes |
| Sales Navigator campaigns | `live-validation` | Explicitly registered searches; cold-fit labels; no account actions | Technical 25-record gate plus human commercial-review gate passes |
| Local JSONL capture store | `active` | Default source-isolated records, seen fingerprints and status | Retained as fallback baseline and rollback shadow |
| Optional local PostgreSQL capture store | `live-validation` | Operator-enabled, loopback-only, fail-closed, JSON shadow retained | Windows enable/check/backup/restore drill and real source pilot pass |
| Prospect Desk synchronization | `live-validation` | Bearer-token ingestion; independent source retries | All three sources sync without losing owner or BD history |
| Production Prospect Desk PostgreSQL | `active` | Existing Neon/PostgreSQL production boundary remains unchanged | Production synchronization and rollback proof pass |
| Identity and evidence enrichment | `active` | Provenance and conflicts retained; reversible resolution | Pilot defect rate accepted |
| Offer and campaign engine | `active` | Versioned offers and separate direct/channel/overflow lanes | At least one product and one service campaign reviewed |
| BD workflow and next-best-action | `active` | Human-owned tasks, follow-ups and evidence-grounded recommendations | Pilot team operates without spreadsheets |
| Human-controlled outreach workbench | `active` | Exact revision approval and immutable manual-send records | Review and sent-history pilot accepted |
| Commercial analytics and calibration | `active` | Real stored events, explicit values and management decisions | Representative reviewed sample available |
| Automatic external outreach | `on-hold` | No transport or platform action in the pilot | Separate platform, security, compliance and commercial approval |
| Historical Playwright/browser-control experiments | `superseded-reference` | Retained for decision history only | Remove only after retention review; never install or operate |
| V4 command names and `acquisition_v4` module | `superseded-reference` | Compatibility aliases and internal package only | One accepted upgrade and rollback drill with no dependency |

## Authoritative branch chain

The accepted implementation order is:

1. PR #223 — warm acquisition/runtime foundation;
2. PR #225 — Sales Navigator cold campaigns;
3. PR #236 onward — scheduled capture, identity, enrichment, campaign and account intelligence;
4. PR #251 — operational BD workspace;
5. PR #254 — authoritative outreach workbench;
6. PR #256 — authoritative commercial analytics and calibration;
7. PR #257 — canonical installer, naming, diagnostics, rollback and status registry;
8. the local PostgreSQL slice — optional collector persistence, migration shadow, backup and restore.

Closed PRs #252 and #253 are obsolete implementations and must not be reintroduced.

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
9. Run the Upwork, LinkedIn and Sales Navigator live acceptance gates independently.
10. Confirm Prospect Desk preserves assignment, outreach and outcome history on repeated enrichment.
11. Perform one application rollback drill and verify database and local state are unchanged.
12. Advance the release only after management records source and campaign keep/change/stop decisions.

## Merge policy

`main` must not be updated merely because code checks pass. The release requires:

- green dedicated CI for each authoritative slice;
- one coherent Windows installer and diagnostics package;
- successful real-source acceptance for warm and cold lanes;
- PostgreSQL/Prospect Desk synchronization proof;
- local PostgreSQL enable/check/backup/restore evidence when that mode is selected;
- state-preserving upgrade and rollback evidence;
- explicit confirmation that no external action was automated.
