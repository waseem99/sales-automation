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

The shared schema, health, persistence, deduplication and restart contract implement #200. The Upwork extension and exact-search launcher advance #201. LinkedIn extraction and commercial qualification remain under #202 and #204.

## Windows operator flow — Upwork

1. Double-click `START-ACQUISITION-V4.cmd` and leave the minimized runtime running.
2. Double-click `PREPARE-UPWORK-EXTENSION.cmd` once after installation or an extension update.
3. In `chrome://extensions/`, enable Developer mode, choose **Load unpacked**, and select:
   `%LOCALAPPDATA%\Codistan\Acquisition\extensions\upwork`
4. Double-click `OPEN-UPWORK-SEARCHES.cmd` each working session.
5. The extension automatically reads visible cards after the three approved searches load. Its popup provides a manual capture fallback and current collector status.
6. Run `CHECK-ACQUISITION-V4.cmd` whenever capture status is unclear.

The launcher opens only these approved searches:

- Waseem — AI + Fullstack AI 16 July 2026
- Roshana — 3D Design & Creatives 15 July 2026
- Nadir — Game & AR/VR 16 July 2026

The extension never refreshes, scrolls, clicks a job, handles verification, submits a proposal, changes a profile, or sends a message.

## Developer validation

From this directory:

```bash
python -m unittest discover -s tests -v
node tests/upwork_extension_contract.mjs
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

The Upwork extension additionally retains fixed/hourly value, client spend, hire rate, payment verification, proposal range, posted age, duration, weekly hours, experience level, skills, approved saved-search name and profile owner where visible.

Health endpoints expose only operational metadata. They do not expose captured post/job bodies, cookies, credentials or private session data.
