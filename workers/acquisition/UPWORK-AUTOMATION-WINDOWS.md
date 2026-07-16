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
8. A first controlled test run starts automatically.

## Time-zone-aware schedule

Windows triggers the worker every 30 minutes at a fixed seven-minute offset from the hour. The worker opens Chrome only while one of these daylight-saving-aware windows is active:

- **United States:** 07:00 Eastern through 18:00 Pacific every day. Internally this is represented as 07:00-21:30 in `America/New_York`, which covers the East Coast morning through the Pacific evening.
- **Australia:** 07:00-10:30 in `Australia/Sydney` every day, covering the early Sydney/Melbourne opportunity window.

The IANA time-zone rules automatically adjust for US and Australian daylight-saving changes. Pakistan local time is not used as the business scheduling reference.

The seven-minute offset and the inactive gaps between market windows distribute workload away from the top of the hour. There is no random timing, fake human-input behavior or anti-detection logic.

The computer must be powered on and the configured Windows user must be signed in because the Upwork browser remains visible.

## Searches performed on every active run

Every active run checks all three exact saved-search links:

1. **AI Jobs** — `https://www.upwork.com/nx/find-work/9652811`
   - Profile: `https://www.upwork.com/freelancers/~016e9a7bda2340dcd9`
2. **2D/3D Modeling & Animations — Roshana** — `https://www.upwork.com/nx/find-work/9652860`
   - Profile: `https://www.upwork.com/freelancers/~01323536ddaffbbd34`
3. **Game Development & AR/VR — Nadir** — `https://www.upwork.com/nx/find-work/9652877`
   - Profile: `https://www.upwork.com/freelancers/~0116e2d98cb771724e`

The saved-search query text is stored in `config/upwork-automation.toml` for auditability.

## Commercial and market filters

The worker evaluates two market presets without duplicating the same Upwork job:

- **US only:** explicit United States client location.
- **Worldwide:** all eligible countries except the excluded markets below.

United States jobs are tagged as matching both presets. Other eligible countries are tagged as worldwide. If the client country is not visible, the opportunity cannot become Priority A and remains Priority B pending verification.

Approved commercial engagements are:

- fixed price of **$1,000 or more**; or
- hourly work of **more than 30 hours per week** for either **3-6 months** or **more than 6 months**.

An explicit fixed budget below $1,000 or an explicitly non-matching hourly engagement is archived as Priority C. Missing commercial evidence is sent to Priority B for human confirmation rather than being falsely promoted.

Explicit client locations in Pakistan or the GCC are archived:

- Pakistan;
- United Arab Emirates;
- Saudi Arabia;
- Qatar;
- Kuwait;
- Bahrain;
- Oman.

## What each run does

1. Checks whether a US or Australian market window is active.
2. Prevents overlapping runs with Windows Scheduler controls and a local worker lock.
3. Opens installed Google Chrome or Microsoft Edge using the saved Upwork profile.
4. Navigates the three configured saved-search URLs in sequence.
5. Waits the configured conservative delay after each navigation.
6. Extracts visible job cards and stable Upwork job IDs.
7. Deduplicates opportunities already processed.
8. Applies profile metadata, market filters, commercial filters and portfolio-aware A/B/C routing.
9. Opens a limited number of strong A/B candidates for detail enrichment.
10. Writes recovery snapshots after every accepted opportunity.
11. Generates HTML, JSON, CSV and `dashboard-ready.jsonl` outputs.
12. Sends only Priority A and B records to Prospect Desk when encrypted ingestion credentials are configured.
13. Keeps failed ingestion records in a durable local retry queue and retries them on the next run.
14. Retains run reports for the configured retention period.

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
- saved-search and intended-profile metadata;
- market and commercial-filter evidence;
- a durable local retry queue;
- no proposal, application or message action.

If credentials are not configured, Priority A/B records remain in:

`%LOCALAPPDATA%\Codistan\Acquisition\prospect-desk-ingestion-pending.jsonl`

## Checking health

Double-click `CHECK-UPWORK-AUTOMATION.cmd` to see:

- whether the task is installed;
- last and next scheduler trigger times;
- whether a US or Australian window is currently active;
- worker status;
- opportunity and priority counts;
- pending ingestion count;
- whether human verification is required.

## Running immediately

Double-click `RUN-UPWORK-AUTOMATION-NOW.cmd`.

This explicit control bypasses only the market-time gate. It does not bypass login, CAPTCHA, Cloudflare or any other account-protection state.

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

Schedule status:

`%LOCALAPPDATA%\Codistan\Acquisition\upwork-scheduler-status.json`

Worker status:

`%LOCALAPPDATA%\Codistan\Acquisition\upwork-automation-status.json`

Pending ingestion:

`%LOCALAPPDATA%\Codistan\Acquisition\prospect-desk-ingestion-pending.jsonl`

## Operational boundary

The worker researches and qualifies opportunities. It never submits proposals, applies to jobs, sends messages, changes profile data or performs any other external account action. Those actions remain human-controlled.
