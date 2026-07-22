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

Source-specific extraction and commercial qualification are completed under issues #201, #202 and #204. This package establishes the shared schema, health, persistence, deduplication and restart contract required by #200.

## Developer validation

From this directory:

```bash
python -m unittest discover -s tests -v
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
