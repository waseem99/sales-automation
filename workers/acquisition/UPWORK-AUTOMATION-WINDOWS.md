# Automatic Upwork Acquisition on Windows

This is the primary Upwork acquisition workflow. It runs a visible, conservative Chrome worker on a Windows workstation and does not require the manual capture extension for ordinary operation.

## One-time installation

1. Ensure the Windows computer is the dedicated acquisition workstation.
2. Open `workers/acquisition` in File Explorer.
3. Double-click `INSTALL-UPWORK-AUTOMATION.cmd`.
4. The installer runs Python setup and all worker tests.
5. If the saved Upwork profile is missing, a normal Chrome window opens once for login and human verification.
6. Optionally provide the Prospect Desk HTTPS ingestion URL and token. The token is encrypted using Windows DPAPI for the current Windows user and is never committed to Git.
7. The installer creates the Windows task `Codistan Upwork Acquisition`.
8. A first test run starts automatically.

Default schedule:

- Monday-Friday at 09:30
- Monday-Friday at 13:30
- Monday-Friday at 17:30

The computer must be powered on and the configured Windows user must be signed in because the Upwork browser remains visible.

## What each run does

1. Prevents overlapping runs with a local lock.
2. Opens installed Google Chrome or Microsoft Edge using the saved Upwork profile.
3. Navigates only the configured Upwork search-result URLs.
4. Waits at least the configured conservative delay after each navigation.
5. Extracts visible job cards and stable Upwork job IDs.
6. Deduplicates opportunities already processed.
7. Applies the portfolio-aware BD routing and A/B/C priority model.
8. Opens a limited number of strong A/B candidates for detail enrichment.
9. Writes recovery snapshots after every accepted opportunity.
10. Generates HTML, JSON, CSV and `dashboard-ready.jsonl` outputs.
11. Sends only Priority A and B records to Prospect Desk when encrypted ingestion credentials are configured.
12. Keeps failed ingestion records in a durable local retry queue and retries them on the next run.
13. Retains run reports for the configured retention period.

## Verification and account-protection behavior

The worker does not solve or bypass:

- Cloudflare checks;
- CAPTCHA;
- login challenges;
- identity verification;
- unusual-activity warnings;
- account checkpoints.

When any such state appears:

1. The browser remains open.
2. The worker writes `%LOCALAPPDATA%\Codistan\Acquisition\upwork-attention-required.json`.
3. A Windows notification is displayed.
4. The worker polls the visible page without clicking or interacting.
5. If the user completes verification during the safe waiting window, the worker resumes automatically.
6. If verification remains active, the run stops safely and the next scheduled run retries.

No stealth plugins, fingerprint changes, fake mouse movement, randomized human imitation, CAPTCHA services or security-control bypasses are included.

## Prospect Desk ingestion

When configured, credentials are stored at:

`%LOCALAPPDATA%\Codistan\Acquisition\secrets\prospect-desk.json`

The token is encrypted for the current Windows user using Windows DPAPI. The scheduled runner decrypts it only in memory, passes it to the worker process through temporary environment variables and removes those variables when the process exits.

Ingestion uses:

- bearer-token authentication;
- HTTPS only;
- an idempotency key derived from the opportunity record;
- Priority A and B records only;
- a durable local retry queue;
- no proposal, application or message action.

If credentials are not configured, Priority A/B records remain in:

`%LOCALAPPDATA%\Codistan\Acquisition\prospect-desk-ingestion-pending.jsonl`

## Checking health

Double-click `CHECK-UPWORK-AUTOMATION.cmd` to see:

- whether the task is installed;
- last and next run times;
- last task result;
- worker status;
- opportunity and priority counts;
- pending ingestion count;
- whether human verification is required.

## Running immediately

Double-click `RUN-UPWORK-AUTOMATION-NOW.cmd`.

This is only a run-now control. Ordinary daily acquisition is handled by the Windows schedule.

## Removing the schedule

Double-click `UNINSTALL-UPWORK-AUTOMATION.cmd`.

The uninstaller removes the Windows task but preserves browser profiles, reports, checkpoints, opportunity history and encrypted Prospect Desk credentials unless credential removal is explicitly requested from PowerShell.

## Local paths

Browser profile:

`%LOCALAPPDATA%\Codistan\Acquisition\profiles\upwork-browser-v2`

Run reports:

`%LOCALAPPDATA%\Codistan\Acquisition\output\upwork-automation\<timestamp>`

Logs:

`%LOCALAPPDATA%\Codistan\Acquisition\logs\upwork-automation`

Status:

`%LOCALAPPDATA%\Codistan\Acquisition\upwork-automation-status.json`

Pending ingestion:

`%LOCALAPPDATA%\Codistan\Acquisition\prospect-desk-ingestion-pending.jsonl`

## Operational boundary

The worker researches and qualifies opportunities. It never submits proposals, applies to jobs, sends messages, changes profile data or performs any other external account action. Those actions remain human-controlled.
