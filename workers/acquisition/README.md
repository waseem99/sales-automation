# Codistan Acquisition Worker

Local-first foundation for human-controlled opportunity research. It remains separate from Vercel and never submits proposals, sends messages, applies to jobs or performs other external account actions.

## Nontechnical Windows setup

On the selected Windows office computer:

1. Open this folder in File Explorer.
2. Double-click `START-HERE.cmd`.
3. Log into Upwork and LinkedIn only inside the official browser windows opened by setup.
4. Complete OTP, CAPTCHA or account verification yourself.
5. Close each dedicated browser window when instructed so its authorized profile is saved.
6. Run `VALIDATE-ACCOUNTS.cmd`, or rerun `START-HERE.cmd`, to confirm both saved sessions.

See [SETUP-WINDOWS.md](SETUP-WINDOWS.md) for the account-profile setup guide. Browser profiles stay outside Git under `%LOCALAPPDATA%\Codistan\Acquisition\profiles`.

## Upwork manual Chrome-extension capture

Double-click `RUN-UPWORK-PILOT.cmd`.

The current pilot does not launch or control an Upwork browser through Playwright or remote debugging. On its first run it guides the operator through loading the unpacked `Codistan Upwork Opportunity Capture` extension into the same ordinary Chrome profile used for Upwork.

The workflow:

- starts a localhost-only collector at `127.0.0.1:8765`;
- opens Upwork through the operating system's normal default-browser flow;
- requires the operator to open saved searches and browse normally;
- captures only visible job-result cards after the operator clicks the extension;
- never opens job-detail or proposal pages automatically;
- never generates fake mouse movement, random timing, fingerprint disguises or security-bypass behavior;
- captures visible titles, descriptions, source links, budget and client-quality signals where present on each card;
- deduplicates previously reviewed source IDs;
- applies the deterministic portfolio-aware qualification rules;
- creates HTML, JSON and CSV reports under `%LOCALAPPDATA%\Codistan\Acquisition\output\upwork-extension-pilot`;
- creates `dashboard-ready.jsonl` containing only qualified, contact-ready and proposal-ready records;
- does not write to Prospect Desk until the first report is explicitly approved.

The unpacked extension is copied to `%LOCALAPPDATA%\Codistan\Acquisition\upwork-capture-extension`. It communicates only with the localhost collector and has no credential, cookie or proposal-submission capability.

## Requirements

- Python 3.12+
- Windows workstation for the guided launchers
- Google Chrome for the manual Upwork extension pilot
- Playwright only for the separate account-profile bootstrap and validation tools

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

The fixture tests and the manual extension collector use Python's standard library. Playwright is retained for the separate saved-session setup and validation commands.

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

Complete login or verification manually. The worker never accepts account passwords as CLI arguments and never logs cookies, storage state or tokens.

## Validate an authorized session

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

Do not enable ingestion until the receiving API, qualification contract and first live report quality are approved.

## Safety rules

- Use only user-authorized sessions and pages.
- Respect platform rules, account protections and conservative human operation.
- Complete login, CAPTCHA and verification personally.
- Do not automate Upwork applications, LinkedIn connections, messages or InMails.
- Do not attempt to evade Cloudflare, platform safeguards, rate limits or browser detection.
- Never commit browser profiles, cookies, tokens, storage state or extracted private page archives.

## Qualification preview

The deterministic configuration is stored in `config/qualification.example.toml`.

```python
from acquisition.qualification import load_qualification_config, qualify

config = load_qualification_config(Path("config/qualification.example.toml"))
decision = qualify(record, config)
```

The decision includes disposition, score, confidence, business unit, service, dimension scores, missing evidence, risks, approved proof IDs, next action and configuration version. It never sends an external message or application.
