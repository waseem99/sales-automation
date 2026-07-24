# Acquisition Engine V4 local runtime

This directory contains the Windows-first runtime for the Upwork and LinkedIn Chrome-extension collectors, the local review queue, and the optional Prospect Desk synchronization bridge.

## Current release boundary

- Runtime release: `0.2.0`
- Upwork collector: `127.0.0.1:8765`
- LinkedIn collector: `127.0.0.1:8775`
- LinkedIn extension: `1.3.0`
- State: `%LOCALAPPDATA%\Codistan\Acquisition`
- Normal user Chrome only
- No Playwright, hidden browser profile or account-challenge handling
- Local capture remains operational when Prospect Desk or the internet is unavailable
- No proposal, application, email, message, connection request or other external action

The shared runtime implements #200. The Upwork extension advances #201, the scheduled LinkedIn direct-requirement extension advances #202, deterministic closeability implements the core #204 contract, the combined local and Prospect Desk action queues advance #220, and the install/recovery bundle advances #221.

## One-time Windows setup

1. Download or check out the PR #223 branch.
2. Open `workers\acquisition`.
3. Double-click `START-HERE-ACQUISITION-V4.cmd`.
4. The installer:
   - installs Python 3.12 through `winget` when required;
   - copies replaceable application files to `%LOCALAPPDATA%\Codistan\Acquisition\app-current`;
   - preserves captured records, review output, sync configuration and deduplication state outside that folder;
   - keeps the prior application version as `app-previous`;
   - copies both unpacked extensions to stable local folders;
   - starts both collectors and verifies ports `8765` and `8775`;
   - creates daily-operation, health, sync configuration, diagnostics and rollback shortcuts on the desktop;
   - starts the runtime automatically when the Windows user signs in.
5. In `chrome://extensions/`, enable Developer mode and load these unpacked folders once:
   - `%LOCALAPPDATA%\Codistan\Acquisition\extensions\upwork`
   - `%LOCALAPPDATA%\Codistan\Acquisition\extensions\linkedin`

After an application update, rerun `START-HERE-ACQUISITION-V4.cmd` and click **Reload** on both unpacked extensions. Their folder locations remain stable.

## Upwork flow

1. Double-click the desktop shortcut **Open Upwork Searches**.
2. The launcher opens only these approved searches:
   - Waseem — AI + Fullstack AI 16 July 2026
   - Roshana — 3D Design & Creatives 15 July 2026
   - Nadir — Game & AR/VR 16 July 2026
3. The extension reads visible job cards after each user-opened page loads.
4. The popup shows new records plus Priority A and Priority B counts.

The Upwork extension retains canonical job identity plus visible value, buyer, competition, freshness, duration, workload and skill evidence needed for bidding decisions. It never refreshes, scrolls, clicks a job, handles verification, submits a proposal, changes a profile or sends a message.

## Scheduled LinkedIn flow

LinkedIn extension `1.3.0` runs the five approved searches every **15 minutes** while normal Chrome is running and the user remains signed in.

Each cycle:

1. opens one approved content search in an inactive temporary tab;
2. waits for normal LinkedIn rendering;
3. performs the bounded four-step scan;
4. captures only resolvable buyer-intent posts with original canonical evidence;
5. deduplicates or enriches through the local collector;
6. closes the temporary tab;
7. waits before opening the next search;
8. skips a new cycle if the previous cycle is still active.

The five lanes are:

- software development and delivery partners;
- AI automation partners;
- digital marketing agencies;
- video production and animation partners;
- cybersecurity consultants and project-based engagements.

Open the extension popup to:

- enable or disable the 15-minute cycle;
- see the previous cycle time and counts;
- run all approved searches immediately;
- capture or scan the current page manually when needed.

The scheduled extension may open inactive tabs and scroll search results. It does not message, connect, follow, react, comment, email, submit a proposal, change searches outside the approved list, or bypass LinkedIn controls. Login, checkpoint or auth-wall redirects are recorded as operational errors and never handled automatically.

## Prospect Desk synchronization

Local capture works without Prospect Desk synchronization. To populate the production `/prospects` and `/leads/linkedin` workspaces automatically, deploy the machine-authenticated endpoint and configure the local bridge.

### Production configuration

Add a Vercel environment variable named:

```text
ACQUISITION_INGEST_TOKEN
```

Use a random value of at least 32 characters and deploy `api/acquisition-ingest.ts`. The endpoint accepts only authenticated evidence-only POST requests and requires the production `DATABASE_URL`.

### PC configuration

Double-click the desktop shortcut **Configure Prospect Desk Sync** and enter:

- the production Prospect Desk URL, such as `https://your-domain.example`;
- the same `ACQUISITION_INGEST_TOKEN` value.

The script writes the secret only to:

```text
%LOCALAPPDATA%\Codistan\Acquisition\config\prospect-desk-sync.json
```

It is not committed to GitHub or printed in health output. The bridge retries every 60 seconds and sends only records whose fingerprint is new or enriched. Reject records are never synchronized.

Every synchronized LinkedIn record is upserted by stable identity and canonical post URL. Prospect Desk receives:

- original post and author/profile evidence;
- headline and available company context;
- public email when explicitly visible in the post;
- source search and capture metadata;
- local Priority A, Priority B or Research decision;
- score, confidence, positive reasons, missing evidence and risk flags;
- service workspace mapping;
- recommended Codistan profile and approved portfolio proof;
- automatic owner assignment where unassigned;
- recommended next action and a human-reviewable response draft.

Repeated scans enrich the same record. Existing owner, outreach history, reply, follow-up, proposal and outcome data are preserved. All outreach remains manual.

## Service workspace mapping

- software product delivery → **Software and SaaS**;
- AI automation → **AI and automation**;
- cybersecurity → **Cybersecurity**;
- digital marketing and growth → **Web and marketing**;
- video, animation, 3D and immersive delivery → **3D, AR and VR**;
- explicit white-label or overflow partnerships → **Partnership leads** and the closest delivery service workspace.

## Closeability decisions

Every accepted record is scored immediately under the current Acquisition V4 closeability configuration.

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

## Combined local action queue

After every capture, the runtime rewrites:

- `%LOCALAPPDATA%\Codistan\Acquisition\review\index.html`
- `%LOCALAPPDATA%\Codistan\Acquisition\review\queue.json`
- `%LOCALAPPDATA%\Codistan\Acquisition\review\queue.csv`

Double-click the desktop shortcut **Open Acquisition Review**. Priority A appears first, then Priority B, Research and Reject. Source titles are clickable and open the original Upwork job or LinkedIn post. The page cannot submit proposals or send outreach.

## Health, diagnostics and rollback

- **Check Acquisition V4** shows whether both collectors are healthy and reports current A/B counts.
- Each collector health response includes a sanitized `prospect_desk_sync` section with configuration, endpoint host, pending count, last success and last error. It never exposes the token.
- **Diagnose Acquisition V4** creates a ZIP containing health, versions and file metadata only. It excludes captured opportunity bodies, cookies and credentials.
- **Rollback Acquisition V4** swaps `app-current` with `app-previous`, refreshes both stable extension folders and restarts the runtime. Captured records, deduplication and sync configuration remain intact.

## Developer validation

From this directory:

```bash
python -m unittest discover -s tests -v
node tests/upwork_extension_contract.mjs
node tests/linkedin_extension_contract.mjs
node tests/prospect_desk_bridge_contract.mjs
```

The repository also contains focused GitHub Actions workflows for the local runtime and the production Vercel build.

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
