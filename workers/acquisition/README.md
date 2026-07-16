# Codistan Acquisition Worker

Local-first Python foundation for browser-assisted opportunity research. It is intentionally separate from Vercel and does not submit proposals, send messages or perform external actions.

## Nontechnical Windows setup

On the selected Windows office computer:

1. Open this folder in File Explorer.
2. Double-click `START-HERE.cmd`.
3. Log into Upwork and LinkedIn only inside the official browser windows opened by the setup.
4. Complete OTP, CAPTCHA or account verification yourself.
5. Close each dedicated browser window when instructed so its authorized profile is saved.
6. Run `VALIDATE-ACCOUNTS.cmd`, or rerun `START-HERE.cmd`, to confirm both saved sessions.

See [SETUP-WINDOWS.md](SETUP-WINDOWS.md) for the full operator-safe guide. Browser profiles are stored outside the repository under `%LOCALAPPDATA%\Codistan\Acquisition\profiles`.

The validator records only expected domain/path state, boolean authentication status and the names of known navigation markers. It does not store messages, job descriptions, contacts, cookies, credentials or private page content.

## One-click Upwork operator-assisted capture

After the Upwork session is validated, double-click `RUN-UPWORK-PILOT.cmd`.

The current pilot deliberately avoids automated search navigation. It:

- opens one dedicated authorized Upwork tab in an installed visible browser;
- asks the operator to open each saved search normally inside Upwork;
- reads visible job-result cards only after the operator presses Enter;
- never opens job-detail or proposal pages automatically;
- never generates fake mouse movement, random timing or browser-fingerprint disguises;
- pauses for human login, Cloudflare or account-verification action;
- captures visible titles, descriptions, source links, budget and client-quality signals where present on the card;
- deduplicates previously reviewed source IDs;
- applies deterministic portfolio-aware qualification rules;
- creates local HTML, JSON and CSV reports under `%LOCALAPPDATA%\Codistan\Acquisition\output\upwork-assisted-pilot`;
- creates `dashboard-ready.jsonl` containing only qualified, contact-ready and proposal-ready records;
- does not submit proposals, send messages or write to Prospect Desk.

Dashboard ingestion remains disabled until the first report is explicitly approved. The report itself states this boundary and the runner records `dashboard_ingestion_enabled=false`.

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

## Validate an authorized session

Close the dedicated account browser window before validation:

```bash
python -m acquisition session-check \
  --profile /absolute/private/path/codistan-browser-profile \
  --account upwork \
  --repository-root ../.. \
  --output /private/local/output/upwork-session-check.json
```

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
- Do not attempt to evade Cloudflare, platform safeguards, rate limits or browser detection.
- Never commit browser profiles, cookies, tokens, storage state or extracted private page archives.

## Qualification preview

The deterministic #204 configuration is stored in `config/qualification.example.toml`.

```python
from acquisition.qualification import load_qualification_config, qualify

config = load_qualification_config(Path("config/qualification.example.toml"))
decision = qualify(record, config)
```

The decision includes disposition, score, confidence, business unit, service, dimension scores, missing evidence, risks, approved proof IDs, next action and configuration version. It never sends an external message or application.
