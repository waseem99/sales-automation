# Acquisition Engine V4 local runtime

This directory contains the clean local runtime for the Upwork and LinkedIn Chrome-extension collectors.

## Current release boundary

- Upwork collector: `127.0.0.1:8765`
- LinkedIn collector: `127.0.0.1:8775`
- State: `%LOCALAPPDATA%\Codistan\Acquisition`
- Normal user Chrome only
- No Playwright, hidden navigation or account-challenge handling
- No Vercel or production database requirement
- No proposal, application, message, connection request or other external action

The shared runtime implements #200. The Upwork extension advances #201, the LinkedIn direct-requirement extension advances #202, deterministic closeability implements the core #204 contract, the combined read-only action queue advances #220, and the install/recovery bundle advances #221.

## One-time Windows setup

1. Download or check out the PR #223 branch.
2. Open `workers\acquisition`.
3. Double-click `START-HERE-ACQUISITION-V4.cmd`.
4. The installer:
   - installs Python 3.12 through `winget` when required;
   - copies replaceable application files to `%LOCALAPPDATA%\Codistan\Acquisition\app-current`;
   - preserves captured records, review output and deduplication state outside that folder;
   - keeps the prior application version as `app-previous`;
   - copies both unpacked extensions to stable local folders;
   - starts both collectors and verifies ports `8765` and `8775`;
   - creates daily-operation, health, diagnostics and rollback shortcuts on the desktop;
   - starts the runtime automatically when the Windows user signs in.
5. In `chrome://extensions/`, enable Developer mode and load these unpacked folders once:
   - `%LOCALAPPDATA%\Codistan\Acquisition\extensions\upwork`
   - `%LOCALAPPDATA%\Codistan\Acquisition\extensions\linkedin`

After an application update, rerun `START-HERE-ACQUISITION-V4.cmd` and click **Reload** on both unpacked extensions. Their folder locations remain stable.

## Daily Upwork flow

1. Double-click the desktop shortcut **Open Upwork Searches**.
2. The launcher opens only these approved searches:
   - Waseem — AI + Fullstack AI 16 July 2026
   - Roshana — 3D Design & Creatives 15 July 2026
   - Nadir — Game & AR/VR 16 July 2026
3. The extension reads visible job cards after each user-opened page loads.
4. The popup shows new records plus Priority A and Priority B counts.

The Upwork extension retains canonical job identity plus visible value, buyer, competition, freshness, duration, workload and skill evidence needed for bidding decisions. It never refreshes, scrolls, clicks a job, handles verification, submits a proposal, changes a profile or sends a message.

## Daily LinkedIn flow

1. Double-click the desktop shortcut **Open LinkedIn Lead Searches**.
2. The launcher opens five high-intent content searches:
   - software development agency requirements;
   - AI automation partner requirements;
   - digital marketing agency requirements;
   - video and animation agency requirements;
   - cybersecurity consultant requirements.
3. The extension reviews only visible posts after the user-opened search pages load.
4. It submits only explicit supported service requirements and keeps the original post URL and original author.
5. The popup shows new records plus Priority A and Priority B counts.

The LinkedIn extension filters permanent vacancies, job seekers, freelancer self-promotion and generic content before local ingestion. It retains service lanes, intent phrases, available contact-route types and repost/original-author evidence. It never messages, connects, follows, reacts or comments.

## Closeability decisions

Every accepted record is scored immediately under configuration `acquisition-v4-closeability-1.0.0`.

### Upwork dimensions

- service fit;
- commercial value;
- buyer quality;
- competition and timing.

### LinkedIn dimensions

- service fit;
- explicit buyer intent;
- available response route;
- buyer identity;
- freshness.

The stored decision includes Priority A, Priority B, Research or Reject; score; confidence; service route; positive reasons; missing evidence; risks; and the recommended manual next action. Missing information is shown explicitly and is never invented.

## Combined action queue

After every capture, the runtime rewrites:

- `%LOCALAPPDATA%\Codistan\Acquisition\review\index.html`
- `%LOCALAPPDATA%\Codistan\Acquisition\review\queue.json`
- `%LOCALAPPDATA%\Codistan\Acquisition\review\queue.csv`

Double-click the desktop shortcut **Open Acquisition Review**. Priority A appears first, then Priority B, Research and Reject. Source titles are clickable and open the original Upwork job or LinkedIn post. The page cannot submit proposals or send outreach.

## Health, diagnostics and rollback

- **Check Acquisition V4** shows whether both collectors are healthy and reports current A/B counts.
- **Diagnose Acquisition V4** creates a ZIP containing health, versions and file metadata only. It excludes captured opportunity bodies, cookies and credentials.
- **Rollback Acquisition V4** swaps `app-current` with `app-previous`, refreshes both stable extension folders and restarts the runtime. Captured records and deduplication state remain intact.

## Developer validation

From this directory:

```bash
python -m unittest discover -s tests -v
node tests/upwork_extension_contract.mjs
node tests/linkedin_extension_contract.mjs
```

## Run both collectors

```bash
PYTHONPATH=. python -m acquisition_v4.supervisor \
  --state-root ./local-state
```

Then check:

```bash
PYTHONPATH=. python -m acquisition_v4.status
```

## Submit sanitized fixtures

```bash
PYTHONPATH=. python -m acquisition_v4.fixture_submit upwork fixtures/upwork-capture.json
PYTHONPATH=. python -m acquisition_v4.fixture_submit linkedin fixtures/linkedin-capture.json
```

Submitting the same fixture twice must return a duplicate on the second run. Restarting the supervisor must not reset deduplication.

## Extension payload contract

`POST /capture` accepts a JSON object containing:

- `source`: `upwork` or `linkedin`, matching the collector port;
- `source_subtype`;
- `parser_version`;
- `page_url` and `page_identity`;
- `external_action_performed`: always `false`;
- `records`: one to fifty visible records.

Every normalized record retains a canonical source URL, source-native or deterministic identity, visible evidence, page identity, parser version, timestamps and a stable deduplication key.

Health endpoints expose only operational metadata. They do not expose captured post/job bodies, cookies, credentials or private session data.
