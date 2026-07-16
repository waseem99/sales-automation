# Codistan Acquisition Worker

Local-first opportunity acquisition and qualification worker for Prospect Desk. It can research and route opportunities, but it never submits proposals, applies to jobs, sends messages, changes account data or bypasses platform security controls.

## Primary Upwork workflow: automatic visible Chrome worker

On the selected Windows acquisition computer, double-click:

`INSTALL-UPWORK-AUTOMATION.cmd`

This is a one-time installation. It:

- installs and tests the Python worker;
- reuses the saved Upwork browser profile under `%LOCALAPPDATA%\Codistan\Acquisition\profiles`;
- creates the Windows task `Codistan Upwork Acquisition`;
- triggers every 30 minutes and opens Chrome only during DST-aware US and Australian opportunity windows;
- covers 07:00 Eastern through approximately 18:00 Pacific and 07:00-10:30 Sydney/Melbourne time;
- runs all three approved saved searches on every active run: AI Jobs, Roshana 2D/3D, and Nadir Game/AR/VR;
- launches a visible installed Chrome/Edge session;
- extracts and deduplicates new job opportunities;
- applies US-only/worldwide market policy, Pakistan/GCC exclusions and approved commercial filters;
- applies portfolio-aware qualification and A/B/C priorities;
- enriches a limited number of strong candidates from their visible job-detail pages;
- generates recoverable HTML, JSON and CSV outputs;
- sends Priority A/B records to Prospect Desk when encrypted ingestion credentials are configured;
- keeps failed or unconfigured ingestion records in a durable local retry queue.

The Windows user must be signed in because the Upwork browser stays visible. The worker does not run headlessly for authenticated Upwork acquisition.

See [UPWORK-AUTOMATION-WINDOWS.md](UPWORK-AUTOMATION-WINDOWS.md) for the full setup, exact search links, filters and operating guide.

### Verification handling

The worker detects login, Cloudflare, CAPTCHA, identity verification, unusual-activity and account-checkpoint states. It then:

1. leaves the browser open;
2. writes a local attention record;
3. displays a Windows notification;
4. waits and polls without clicking;
5. resumes automatically when a normal Upwork page returns;
6. stops safely and retries on the next schedule if the challenge remains active.

No stealth plugins, fingerprint spoofing, fake mouse movement, CAPTCHA service, randomized human imitation or security-control bypass is included.

### One-click controls

- `CHECK-UPWORK-AUTOMATION.cmd` — show task, market-window, run, priority and verification status.
- `RUN-UPWORK-AUTOMATION-NOW.cmd` — start one immediate run outside the ordinary time-window gate.
- `UNINSTALL-UPWORK-AUTOMATION.cmd` — remove the schedule while preserving local history.

## Prospect Desk ingestion

The installer can store the Prospect Desk ingestion token using Windows DPAPI for the current Windows user. The token is not committed to Git and is exposed to the worker process only through temporary environment variables.

Only Priority A and B opportunities are eligible for ingestion. Requests include an idempotency key so the receiving endpoint can safely upsert repeated deliveries.

If the endpoint is unavailable or credentials are not configured, records remain queued at:

`%LOCALAPPDATA%\Codistan\Acquisition\prospect-desk-ingestion-pending.jsonl`

They are retried automatically on later runs.

## Manual extension fallback

`RUN-UPWORK-PILOT.cmd` remains available as a troubleshooting and calibration fallback. It uses the manually triggered Chrome extension and localhost collector. It is not the ordinary daily workflow.

The fallback:

- requires the operator to navigate Upwork and trigger capture;
- never opens job-detail or proposal pages automatically;
- never submits proposals, sends messages or applies to jobs;
- creates local HTML, JSON and CSV reports.

## Nontechnical account setup

When the saved Upwork profile is missing, the automation installer launches the existing account connection flow. Complete login, OTP, CAPTCHA and verification only in the official browser window, then close that dedicated window so the profile is saved.

Browser profiles remain outside Git under:

`%LOCALAPPDATA%\Codistan\Acquisition\profiles`

## Requirements

- Windows 10/11 acquisition workstation
- Python 3.12+
- Google Chrome or Microsoft Edge
- Windows user signed in during scheduled runs
- Playwright browser support installed by setup
- Optional Prospect Desk HTTPS ingestion endpoint and bearer token

## Development install

```bash
cd workers/acquisition
python -m venv .venv
# Windows: .venv\Scripts\activate
# Linux/macOS: source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -e ".[browser]"
playwright install chromium
```

## Test

```bash
cd workers/acquisition
python -m unittest discover -s tests -v
```

The setup and automation installers run the test suite before creating or changing the Windows schedule.

## Scheduled worker CLI

```bash
python -m acquisition upwork-scheduled \
  --profile /private/upwork-browser-profile \
  --repository-root ../.. \
  --config config/upwork-automation.toml \
  --qualification-config config/qualification.example.toml \
  --output-directory /private/output/run-id \
  --checkpoint /private/checkpoints/upwork-seen.json \
  --state-directory /private/state
```

Add `--enable-ingestion` only when `ACQUISITION_INGEST_URL` and `ACQUISITION_INGEST_TOKEN` are available to the process.

The scheduler gate can be inspected independently:

```bash
python -m acquisition upwork-schedule-info --config config/upwork-automation.toml
```

## Dry-run fixture

```bash
python -m acquisition run \
  --adapter fixture \
  --input fixtures/opportunities.html \
  --config config/segments.example.toml \
  --output .data/acquisition/dry-run.jsonl \
  --checkpoint .data/acquisition/checkpoints.json \
  --run-key fixture-pilot \
  --dry-run
```

## Bootstrap an authorized browser profile

Store the profile outside the Git repository:

```bash
python -m acquisition browser \
  --profile /absolute/private/path/codistan-browser-profile \
  --url https://www.upwork.com/nx/find-work/ \
  --repository-root ../..
```

The worker never accepts account passwords as CLI arguments and never logs cookies, storage state, OTPs or recovery codes.

## Qualification model

The deterministic configuration is stored in `config/qualification.example.toml`. Decisions include:

- disposition;
- A/B/C priority;
- weighted commercial, technical, buyer and competition dimensions;
- business unit and service route;
- intended Upwork profile and saved-search lane;
- US-only/worldwide market scope;
- commercial-filter status;
- missing evidence and risks;
- approved portfolio proof IDs;
- recommended human action.

## Safety rules

- Use only user-authorized sessions and configured search URLs.
- Keep the authenticated browser visible.
- Complete login, CAPTCHA and verification personally.
- Stop and wait when account protection appears.
- Do not automate proposals, applications, messages, connections or profile changes.
- Do not attempt to evade Cloudflare, platform safeguards, rate limits or browser detection.
- Never commit profiles, cookies, tokens, storage state or private page archives.
