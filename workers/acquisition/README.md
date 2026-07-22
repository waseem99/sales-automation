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

The shared runtime implements #200. The Upwork extension advances #201, the LinkedIn direct-requirement extension advances #202, deterministic closeability implements the core #204 contract, and the combined read-only action queue advances #220.

## One-time Windows setup

1. Double-click `START-ACQUISITION-V4.cmd` and leave the minimized runtime running.
2. Double-click `PREPARE-UPWORK-EXTENSION.cmd`.
3. Double-click `PREPARE-LINKEDIN-EXTENSION.cmd`.
4. In `chrome://extensions/`, enable Developer mode and load these unpacked folders:
   - `%LOCALAPPDATA%\Codistan\Acquisition\extensions\upwork`
   - `%LOCALAPPDATA%\Codistan\Acquisition\extensions\linkedin`
5. Run `CHECK-ACQUISITION-V4.cmd`. Both collectors must show healthy.

Repeat the relevant **Prepare** command and click **Reload** on that unpacked extension after an extension update.

## Daily Upwork flow

1. Double-click `OPEN-UPWORK-SEARCHES.cmd`.
2. The launcher opens only these approved searches:
   - Waseem — AI + Fullstack AI 16 July 2026
   - Roshana — 3D Design & Creatives 15 July 2026
   - Nadir — Game & AR/VR 16 July 2026
3. The extension reads visible job cards after each user-opened page loads.
4. The popup shows new records plus Priority A and Priority B counts.

The Upwork extension retains canonical job identity plus visible value, buyer, competition, freshness, duration, workload and skill evidence needed for bidding decisions. It never refreshes, scrolls, clicks a job, handles verification, submits a proposal, changes a profile or sends a message.

## Daily LinkedIn flow

1. Double-click `OPEN-LINKEDIN-LEAD-SEARCHES.cmd`.
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

Double-click `OPEN-ACQUISITION-REVIEW.cmd` to open the readable queue. Priority A appears first, then Priority B, Research and Reject. Source titles are clickable and open the original Upwork job or LinkedIn post. The page cannot submit proposals or send outreach.

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
