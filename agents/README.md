# Codistan Acquisition Worker

Local Python worker foundation for opportunity research. It runs on a developer workstation or dedicated VPS and remains separate from Vercel.

## v1 boundaries

- Uses only user-authorized browser profiles and platform-compliant research workflows.
- Does not automate proposals, messages, connection requests or bids.
- Stops and requires human action when a login, verification or account challenge appears.
- Defaults to dry-run JSONL output.
- Never commits browser profiles, cookies, credentials or runtime state.
- Sends records to the existing Prospect Desk intake only after an explicit `--ingest --confirm-ingestion` command.

## Install

```bash
cd agents
python -m venv .venv
source .venv/bin/activate
python -m pip install -e .
playwright install chromium
```

On Windows PowerShell:

```powershell
cd agents
py -3.12 -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install -e .
playwright install chromium
```

## Validate the fixture adapter

```bash
acquisition-worker fixture \
  --input fixtures/sample_opportunities.html \
  --source upwork \
  --segment fixture-pilot \
  --output .state/dry-run.jsonl \
  --checkpoint .state/fixture-checkpoint.json
```

Run the same command again. Previously processed records are skipped from the checkpoint.

## Launch an authorized browser profile

The browser command opens Chromium and does not automate login:

```bash
acquisition-worker browser \
  --profile-path /absolute/path/outside/the/repository/upwork-profile \
  --start-url https://www.upwork.com/nx/find-work/
```

The default is headed mode. If a verification challenge is detected, the worker pauses and prints a human-action message.

## Run the Upwork saved-search pilot

Copy the example configuration and edit only the search URLs and commercial thresholds:

```bash
cp config/upwork.saved-searches.example.json .state/upwork.saved-searches.json
```

Open an already authorized profile and run configured searches:

```bash
acquisition-worker upwork \
  --config .state/upwork.saved-searches.json \
  --profile-path /absolute/path/outside/the/repository/upwork-profile \
  --output .state/upwork-dry-run.jsonl \
  --checkpoint .state/upwork-checkpoint.json
```

The worker:

- visits only configured Upwork search URLs;
- extracts visible job evidence;
- applies deterministic business-unit routing and qualification;
- archives rejected records with structured reasons;
- writes accepted and rejected results to local JSONL;
- does not open a proposal form, submit a proposal or send a message.

Use `--search-id ai-automation` to run one segment. Keep dry-run mode for initial review. Add `--ingest --confirm-ingestion` only after the output has been reviewed.

## Explicit ingestion

Set the authenticated dashboard cookie in the shell, not in source control:

```bash
export SA_DASHBOARD_BASE_URL="https://your-production-domain"
export SA_DASHBOARD_COOKIE="dashboard_session=...; dashboard_actor=..."
```

Then run:

```bash
acquisition-worker fixture \
  --input fixtures/sample_opportunities.html \
  --source upwork \
  --segment fixture-pilot \
  --output .state/dry-run.jsonl \
  --checkpoint .state/fixture-checkpoint.json \
  --ingest \
  --confirm-ingestion
```

The worker calls the existing `/api/prospects/manual-intake` route. It never submits an external proposal or message.

## Tests

```bash
cd agents
python -m unittest discover -s tests -v
```

The tests use only local fixtures and do not launch a browser or call production.
