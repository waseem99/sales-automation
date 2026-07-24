# Acquisition Engine V5

This directory contains the Windows-first acquisition runtime for:

- Upwork saved-search opportunities;
- warm LinkedIn buyer requirements;
- Sales Navigator product- and service-specific cold campaigns;
- the combined local review queue;
- durable synchronization into Prospect Desk.

## Release boundary

- Runtime: `0.3.0`
- Upwork collector: `127.0.0.1:8765`
- LinkedIn warm collector: `127.0.0.1:8775`
- Sales Navigator cold collector: `127.0.0.1:8785`
- Combined LinkedIn extension: `1.4.0`
- State: `%LOCALAPPDATA%\Codistan\Acquisition`
- Normal logged-in Chrome only
- No Playwright, hidden browser profile, credential storage or account-challenge handling
- No proposal, application, message, InMail, connection request, follow, reaction, comment or email action

Local capture remains operational if Prospect Desk or the internet is temporarily unavailable.

## One-time Windows setup

1. Check out the V5 branch after its V4 base is available.
2. Open `workers\acquisition`.
3. Run `START-HERE-ACQUISITION-V4.cmd`.
4. Reload the unpacked extensions in `chrome://extensions/`:
   - `%LOCALAPPDATA%\Codistan\Acquisition\extensions\upwork`
   - `%LOCALAPPDATA%\Codistan\Acquisition\extensions\linkedin`
5. Confirm the LinkedIn extension shows version `1.4.0`.

The installer:

- installs Python 3.12 when required;
- preserves records, review output, deduplication and sync configuration;
- starts and validates ports 8765, 8775 and 8785;
- migrates older sync configurations to all three sources;
- keeps the previous installed application for rollback;
- creates desktop and Windows-startup shortcuts.

## Upwork

Open the three approved saved searches through **Open Upwork Searches**. The extension captures visible jobs, preserves commercial evidence, deduplicates and enriches, ranks them, and synchronizes non-Reject records to:

- `/leads/upwork`
- `/prospects`

Opening the saved-search pages remains the discovery trigger. Proposal submission and messages remain manual.

## Warm LinkedIn

The existing five buyer-intent searches run every 15 minutes while normal logged-in Chrome is open. They cover software delivery, AI automation, digital marketing, video/animation and cybersecurity.

The extension processes one inactive temporary tab at a time, performs a bounded four-step scan, captures only resolvable buyer-authored requirements and closes the tab. Non-Reject records synchronize to:

- `/leads/linkedin`
- `/prospects`

These records may be treated as warm opportunities only when the original post contains explicit supported-service demand.

## Sales Navigator cold campaigns

Sales Navigator is a separate campaign-driven source. It does not share warm-opportunity classification.

### Default campaign

The seeded campaign is:

**FinTech Backend Operations Platform**

It positions:

- a FinTech backend operations platform;
- managed product and software delivery;
- white-label, overflow and outsourcing partnership;
- integrations, workflow automation and AI-enabled operations where supported.

Default account themes include fintech, payments, digital banking, wallets, lending/NBFC, microfinance, remittance, cross-border payments and financial infrastructure.

Default personas include founders, CEOs, COOs, CTOs, CIOs, product and engineering leaders, operations leaders, platform/integration leaders, digital-transformation leaders and partnership leaders.

### Register a Sales Navigator search

1. Use Sales Navigator normally to create or refine a lead search.
2. Keep the resulting lead-search or people-list page open.
3. Open the Codistan LinkedIn extension.
4. Select **Open Sales Navigator campaigns**.
5. Review or edit:
   - campaign and offer name;
   - offer summary;
   - service route and service lanes;
   - target industries;
   - target personas;
   - target geographies.
6. Under **Approved searches**, leave the URL field blank to use the most recently opened Sales Navigator tab, or paste the current Sales Navigator lead-search URL.
7. Click **Register search**.
8. Click **Run this campaign now** for the first test.

Only explicitly registered lead-search or people-list URLs are eligible for recurring scans.

### Scheduled behavior

Registered Sales Navigator searches run every 12 hours while Chrome is open and the Sales Navigator session is available.

Each run:

1. opens one registered search in an inactive tab;
2. waits for normal rendering;
3. captures visible person cards;
4. performs at most three scroll steps;
5. keeps at most 30 unique people per search;
6. attaches the campaign and offer definition;
7. classifies each person as a cold prospect;
8. sends accepted/enriched evidence to the collector on port 8785;
9. closes the temporary tab;
10. blocks overlapping runs.

Visible evidence may include person name, role, company, location, relationship degree, mutual connections, recent LinkedIn activity, Posted on LinkedIn, TeamLink and role-change signals where LinkedIn displays them.

The extension does not click Save, Connect, Message, InMail, Follow or any other LinkedIn control. Login, checkpoint, auth-wall or unavailable-seat redirects are reported and never bypassed.

### Cold qualification

Sales Navigator prospects are stored as:

- `source: sales_navigator`
- `leadType: sales_navigator_cold_prospect`
- `prospectStage: cold_prospect`
- no confirmed `live_opportunity` status

Scoring dimensions are:

- persona authority;
- account and industry fit;
- campaign and offer fit;
- activity and relationship signals;
- evidence completeness.

Every prospect retains the risk that no explicit buying intent has been established. Priority A/B means strong campaign fit, not a confirmed request.

Accepted/enriched records synchronize to:

- `/leads/sales-navigator`
- `/prospects`

Prospect Desk stores the campaign, offer, ICP evidence, score, confidence, missing evidence and risks, then prepares owner assignment, recommended Codistan profile, approved portfolio proof, next action and a human-reviewable outreach draft.

## Adding another product or service campaign

The campaign engine is not limited to FinTech.

A new campaign should define:

- stable campaign ID and name;
- offer type: product, service or hybrid;
- offer name and summary;
- primary service route and service lanes;
- target industries and account themes;
- target personas and seniority;
- optional target geographies;
- one or more approved Sales Navigator lead-search URLs.

The extension settings page is the operator interface. The underlying campaign store supports multiple campaign records, although the first UI is focused on the seeded FinTech campaign.

## Prospect Desk synchronization

Deploy `api/acquisition-ingest.ts` with:

- `DATABASE_URL`
- `ACQUISITION_INGEST_TOKEN` containing at least 32 characters

Run **Configure Prospect Desk Sync** and enter the deployment URL and the same token. The local config is stored at:

```text
%LOCALAPPDATA%\Codistan\Acquisition\config\prospect-desk-sync.json
```

It enables:

```json
{
  "sources": ["linkedin", "upwork", "sales_navigator"]
}
```

Each source has independent retry and fingerprint state under `%LOCALAPPDATA%\Codistan\Acquisition\sync`. The bridge retries every 60 seconds, sends only new or enriched non-Reject records and never exposes the token in health output.

Repeated captures update the same canonical job, post or person while preserving owner, outreach, follow-up, reply, proposal and outcome history.

## Local review and health

The combined review queue includes all three sources:

- `%LOCALAPPDATA%\Codistan\Acquisition\review\index.html`
- `%LOCALAPPDATA%\Codistan\Acquisition\review\queue.json`
- `%LOCALAPPDATA%\Codistan\Acquisition\review\queue.csv`

Check health:

```powershell
Invoke-RestMethod http://127.0.0.1:8765/health
Invoke-RestMethod http://127.0.0.1:8775/health
Invoke-RestMethod http://127.0.0.1:8785/health
```

Safe diagnostics contain health, versions, process metadata and runtime log tails only. They exclude opportunity bodies, cookies, credentials and sync tokens.

## Developer validation

From `workers/acquisition`:

```bash
python -m unittest discover -s tests -v
node tests/upwork_extension_contract.mjs
node tests/linkedin_extension_contract.mjs
node tests/sales_navigator_extension_contract.mjs
node tests/prospect_desk_bridge_contract.mjs
node tests/sales_navigator_bridge_contract.mjs
```

Run all three collectors:

```bash
PYTHONPATH=. python -m acquisition_v4.supervisor --state-root ./local-state
```

Submit sanitized fixtures:

```bash
PYTHONPATH=. python -m acquisition_v4.fixture_submit upwork fixtures/upwork-capture.json
PYTHONPATH=. python -m acquisition_v4.fixture_submit linkedin fixtures/linkedin-capture.json
PYTHONPATH=. python -m acquisition_v4.fixture_submit sales_navigator fixtures/sales-navigator-capture.json
```

Submitting the same fixture again must produce a duplicate, not another record. A richer fixture must enrich the same canonical record.
