# TalentTrack Pilot

TalentTrack is Codistan’s Windows-first acquisition and business-development operating runtime. It brings together:

- approved Upwork saved-search opportunities;
- warm LinkedIn buyer requirements;
- Sales Navigator product and service campaigns;
- a combined local review queue;
- durable synchronization into Prospect Desk;
- BD tasks, human-controlled outreach and commercial learning.

The authoritative release identity and component states are defined in [`RELEASE.json`](RELEASE.json) and [`../../docs/TALENTTRACK_RELEASE_BASELINE.md`](../../docs/TALENTTRACK_RELEASE_BASELINE.md). Optional local PostgreSQL operations are documented in [`../../docs/TALENTTRACK_LOCAL_POSTGRES.md`](../../docs/TALENTTRACK_LOCAL_POSTGRES.md).

## Release boundary

- Product: **TalentTrack Pilot 1.0.0**
- Runtime: `0.3.1`
- Upwork collector: `127.0.0.1:8765`
- LinkedIn warm collector: `127.0.0.1:8775`
- Sales Navigator cold collector: `127.0.0.1:8785`
- Combined LinkedIn extension: `1.4.1`
- State: `%LOCALAPPDATA%\Codistan\Acquisition`
- Default local capture store: JSONL
- Optional local capture store: loopback-only PostgreSQL with JSON rollback shadow
- Normal logged-in Chrome only
- No Playwright, hidden browser profile, credential storage or account-challenge handling
- No proposal, application, message, InMail, connection request, follow, reaction, comment or email action

The internal Python package remains named `acquisition_v4` during the pilot to avoid a risky state or installer migration. Operators should use only the TalentTrack command names below. Legacy V4/V5 command files remain compatibility aliases until the upgrade and rollback gate passes.

Local capture remains operational if Prospect Desk or the internet is temporarily unavailable. When optional PostgreSQL is enabled, Docker and PostgreSQL must remain available; the collectors fail closed rather than silently creating a divergent JSON-only history.

## One-time Windows setup

1. Open `workers\acquisition`.
2. Run `START-HERE-TALENTTRACK.cmd`.
3. Reload the unpacked extensions in `chrome://extensions/`:
   - `%LOCALAPPDATA%\Codistan\Acquisition\extensions\upwork`
   - `%LOCALAPPDATA%\Codistan\Acquisition\extensions\linkedin`
4. Confirm the LinkedIn extension shows version `1.4.1`.
5. Run `CHECK-TALENTTRACK.cmd`.

The installer:

- installs Python 3.12 when required;
- installs the pinned Psycopg binary dependency;
- preserves records, review output, deduplication and sync configuration;
- preserves an existing local PostgreSQL volume, secret configuration and backups;
- starts and validates ports 8765, 8775 and 8785;
- requires the collectors to report the configured storage backend;
- migrates older sync configurations to all three sources;
- keeps the previous installed application for rollback;
- creates canonical TalentTrack desktop and Windows-startup shortcuts;
- removes stale V5 shortcut duplicates without deleting legacy command files;
- adds **Check Sales Navigator Pilot** for the live acceptance gate.

## Canonical operator commands

| Action | Command |
|---|---|
| Install or upgrade | `START-HERE-TALENTTRACK.cmd` |
| Start | `START-TALENTTRACK.cmd` |
| Check health | `CHECK-TALENTTRACK.cmd` |
| Open local review | `OPEN-TALENTTRACK-REVIEW.cmd` |
| Safe diagnostics | `DIAGNOSE-TALENTTRACK.cmd` |
| Restore previous package | `ROLLBACK-TALENTTRACK.cmd` |
| Configure Prospect Desk sync | `CONFIGURE-PROSPECT-DESK-SYNC.cmd` |
| Open approved Upwork searches | `OPEN-UPWORK-SEARCHES.cmd` |
| Open LinkedIn lead searches | `OPEN-LINKEDIN-LEAD-SEARCHES.cmd` |
| Check Sales Navigator sample | `CHECK-SALES-NAVIGATOR-PILOT.cmd` |
| Enable optional local PostgreSQL | `ENABLE-TALENTTRACK-POSTGRES.cmd` |
| Check local PostgreSQL | `CHECK-TALENTTRACK-POSTGRES.cmd` |
| Back up local PostgreSQL | `BACKUP-TALENTTRACK-POSTGRES.cmd` |
| Restore local PostgreSQL | `RESTORE-TALENTTRACK-POSTGRES.cmd` |

## Optional local PostgreSQL

JSONL remains the default. After installing and starting Docker Desktop, run `ENABLE-TALENTTRACK-POSTGRES.cmd` to make local PostgreSQL the authoritative collector store.

The enable workflow:

- binds PostgreSQL only to `127.0.0.1:55432` by default;
- generates and protects a per-user password;
- starts the repository-provided `postgres:16-alpine` service;
- imports existing JSONL records when the source tables are empty;
- mirrors every committed record, seen fingerprint and status update back to JSON;
- restarts TalentTrack and requires all three collectors to report `storage_backend=postgresql`;
- does not display the password or connection URL.

Use the dedicated Check, Backup and Restore commands for operations. Backups use PostgreSQL custom format, include adjacent checksum metadata and are stored under `%LOCALAPPDATA%\Codistan\Acquisition\backups`. Restore requires the exact confirmation `RESTORE TALENTTRACK` and creates a fresh safety backup before replacing the database.

Do not delete the Docker volume or secret file as an improvised disable process. Automatic fallback is intentionally unavailable because it could create two competing histories.

## Upwork

Open the three approved saved searches through **Open Upwork Searches**. The extension captures visible jobs, preserves commercial evidence, deduplicates and enriches, ranks them, and synchronizes non-Reject records to:

- `/leads/upwork`
- `/prospects`

Opening the saved-search pages remains the discovery trigger. Proposal submission and messages remain manual.

## Warm LinkedIn

The approved buyer-intent searches run every 15 minutes while normal logged-in Chrome is open. They cover software delivery, AI automation, digital marketing, video/animation and cybersecurity.

The extension processes one inactive temporary tab at a time, performs a bounded scan, captures only resolvable buyer-authored requirements and closes the tab. Non-Reject records synchronize to:

- `/leads/linkedin`
- `/prospects`

A record is warm only when the original post contains explicit supported-service demand.

## Sales Navigator cold campaigns

Sales Navigator is a separate campaign-driven source. It never shares the warm-opportunity classification.

The seeded campaign is **FinTech Backend Operations Platform**, covering product delivery, managed software services, white-label/overflow partnerships, integrations and workflow automation where supported.

### Register an approved search

1. Use Sales Navigator normally to create or refine a lead search.
2. Keep the lead-search or people-list page open.
3. Open the Codistan LinkedIn extension.
4. Select **Open Sales Navigator campaigns**.
5. Review the campaign, offer, service lanes, industries, personas and geographies.
6. Register the current approved search URL.
7. Keep scheduled capture disabled for the first manual pilot.
8. Run the campaign manually.
9. Review per-search diagnostics.
10. Run **Check Sales Navigator Pilot**.

After explicit operator approval, registered searches may run every 12 hours while Chrome is open and a licensed Sales Navigator session is available.

Each scheduled run:

1. opens one registered search in an inactive tab;
2. waits for normal rendering;
3. captures visible person cards;
4. performs at most three scroll steps;
5. keeps at most 30 unique people per search;
6. attaches campaign and offer evidence;
7. labels every person as a cold prospect;
8. submits accepted evidence to port 8785;
9. closes the temporary tab;
10. blocks overlapping runs.

The extension does not click Save, Connect, Message, InMail, Follow or any other LinkedIn control. Login, checkpoint, auth-wall or unavailable-seat redirects are reported and never bypassed.

### Pilot acceptance

The technical gate requires:

- at least 25 unique prospects;
- at least 15 Priority A/B prospects;
- at least 95% canonical profile evidence;
- at least 80% role evidence;
- at least 80% company evidence;
- at least 95% campaign metadata coverage;
- cold/no-explicit-intent warning retained;
- zero external-action records.

Passing the technical gate only means the sample is ready for human commercial review. At least 15 A/B records must be reviewed, and routine operation is approved only if at least 60% of that sample is commercially review-worthy.

Accepted/enriched records synchronize to:

- `/leads/sales-navigator`
- `/prospects`

Priority A/B means strong campaign fit, not confirmed demand.

## Prospect Desk synchronization

Deploy `api/acquisition-ingest.ts` with:

- `DATABASE_URL`
- `ACQUISITION_INGEST_TOKEN` containing at least 32 characters

Run **Configure Prospect Desk Sync** and enter the deployment URL and token. The local configuration remains at:

```text
%LOCALAPPDATA%\Codistan\Acquisition\config\prospect-desk-sync.json
```

Each source has independent retry and fingerprint state under `%LOCALAPPDATA%\Codistan\Acquisition\sync`. The bridge retries every 60 seconds, sends only new or enriched non-Reject records and never exposes the token in health output.

Repeated captures update the same canonical job, post or person while preserving owner, outreach, follow-up, reply, proposal and outcome history.

## Local review and health

The combined review queue includes all three sources:

```text
%LOCALAPPDATA%\Codistan\Acquisition\review\index.html
%LOCALAPPDATA%\Codistan\Acquisition\review\queue.json
%LOCALAPPDATA%\Codistan\Acquisition\review\queue.csv
```

Health endpoints:

```powershell
Invoke-RestMethod http://127.0.0.1:8765/health
Invoke-RestMethod http://127.0.0.1:8775/health
Invoke-RestMethod http://127.0.0.1:8785/health
```

Health reports only the non-secret storage label `jsonl` or `postgresql`. Safe diagnostics contain health, versions, process metadata and runtime log tails only. They exclude opportunity bodies, cookies, credentials, database connection URLs and sync tokens.

## Upgrade and rollback

Application files live under `app-current`; the prior package is retained as `app-previous`. Records and configuration live outside both folders in the stable state root.

`ROLLBACK-TALENTTRACK.cmd` restores the previous application package without deleting:

- captured records;
- deduplication fingerprints;
- review output;
- Prospect Desk sync state;
- local PostgreSQL volume, secret configuration or backups;
- JSON rollback shadow;
- configuration.

## Developer validation

From `workers/acquisition`:

```bash
python -m unittest discover -s tests -v
node tests/upwork_extension_contract.mjs
node tests/linkedin_extension_contract.mjs
node tests/sales_navigator_extension_contract.mjs
node tests/prospect_desk_bridge_contract.mjs
node tests/sales_navigator_bridge_contract.mjs
node tests/talenttrack_release_baseline_contract.mjs
node tests/local_postgres_contract.mjs
```

Run the collectors locally:

```bash
PYTHONPATH=. python -m acquisition_v4.supervisor --state-root ./local-state
```

Submit sanitized fixtures:

```bash
PYTHONPATH=. python -m acquisition_v4.fixture_submit upwork fixtures/upwork-capture.json
PYTHONPATH=. python -m acquisition_v4.fixture_submit linkedin fixtures/linkedin-capture.json
PYTHONPATH=. python -m acquisition_v4.fixture_submit sales_navigator fixtures/sales-navigator-capture.json
```

Submitting the same fixture again must produce a duplicate, not another record. A richer fixture must enrich the same canonical record.
