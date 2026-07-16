# Codistan Acquisition Worker

Local-first Python foundation for browser-assisted opportunity research. It is intentionally separate from Vercel and does not submit proposals, send messages or perform external actions.

## Requirements

- Python 3.12+
- A local workstation or dedicated worker/VPS
- For browser use: Playwright and Chromium
- A user-authorized browser profile stored outside this repository

## Install

```bash
cd workers/acquisition
python -m venv .venv
# Windows: .venv\Scripts\activate
# Linux/macOS: source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -e ".[browser]"
playwright install chromium
```

The fixture-based dry run uses only Python's standard library, so browser dependencies are not required for tests.

## Test

```bash
cd workers/acquisition
python -m unittest discover -s tests -v
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

Running the same command twice demonstrates resumable deduplication: the second run records duplicates instead of appending them again.

## Bootstrap an authorized browser profile

Store the profile outside the Git repository:

```bash
python -m acquisition browser \
  --profile /absolute/private/path/codistan-browser-profile \
  --url https://example.com/login \
  --repository-root ../..
```

Complete login or verification manually. The worker never accepts account passwords as CLI arguments and never logs cookies, storage state, tokens or the profile path.

## Ingestion boundary

Dry-run JSONL is the default. A future reviewed ingestion API can be used with:

```bash
export ACQUISITION_INGEST_TOKEN="..."
python -m acquisition run ... --ingest-url https://internal.example/api/opportunities
```

Do not use ingestion mode until the receiving API and #204 qualification contract are approved.

## Safety rules

- Use only user-authorized sessions.
- Respect platform rules, account protections and conservative pacing.
- Pause for human action when login or verification is required.
- Do not automate Upwork applications, LinkedIn connections, messages or InMails.
- Never commit browser profiles, cookies, tokens, storage state or extracted private page archives.

## Qualification preview

The deterministic #204 configuration is stored in `config/qualification.example.toml`.

```python
from acquisition.qualification import load_qualification_config, qualify

config = load_qualification_config(Path("config/qualification.example.toml"))
decision = qualify(record, config)
```

The decision includes disposition, score, confidence, business unit, service, dimension scores, missing evidence, risks, approved proof IDs, next action and configuration version. It never sends an external message or application.
