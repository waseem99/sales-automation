# TalentTrack Pilot Release Baseline

## Authority

This document is the authoritative operating and release-status reference for the TalentTrack acquisition and BD workspace. Historical V4/V5 names remain only as compatibility identifiers until an accepted upgrade and rollback drill proves they can be retired safely.

## Product boundary

TalentTrack Pilot is one Windows-first operating system for:

1. approved Upwork saved-search opportunity capture;
2. warm LinkedIn buyer-requirement capture;
3. Sales Navigator cold direct-buyer and partner campaigns;
4. canonical evidence, identity, enrichment and campaign fit;
5. Prospect Desk assignment, tasks and next-best-action;
6. human-reviewed outreach drafting, exact approval and manual-send recording;
7. commercial funnel analytics and management calibration.

Every external proposal, message, InMail, connection request, comment, reaction, follow and email remains human-controlled. This release does not automate external account actions.

## Canonical release identity

| Item | Canonical value |
|---|---|
| Product | TalentTrack Pilot |
| Product version | 1.0.0 |
| Runtime version | 0.3.0 |
| State root | `%LOCALAPPDATA%\Codistan\Acquisition` |
| Installer | `START-HERE-TALENTTRACK.cmd` |
| Start | `START-TALENTTRACK.cmd` |
| Health | `CHECK-TALENTTRACK.cmd` |
| Diagnostics | `DIAGNOSE-TALENTTRACK.cmd` |
| Rollback | `ROLLBACK-TALENTTRACK.cmd` |
| Review queue | `OPEN-TALENTTRACK-REVIEW.cmd` |

The internal Python package remains `acquisition_v4` during the pilot. Renaming it would create migration risk without changing operator behavior. The package name is therefore classified as a compatibility implementation detail, not the product name.

## Component status registry

| Component | State | Current boundary | Exit or reactivation criterion |
|---|---|---|---|
| Upwork approved saved-search capture | `live-validation` | Normal logged-in Chrome; bounded visible-card capture; manual proposal submission | Accepted real-source sample and successful Prospect Desk sync |
| LinkedIn warm discovery | `live-validation` | Approved searches; buyer-authored demand only; no messaging | Canonical-link and commercial-review acceptance sample passes |
| Sales Navigator campaigns | `live-validation` | Explicitly registered searches; cold-fit labels; no account actions | Technical 25-record gate plus human commercial-review gate passes |
| Prospect Desk synchronization | `live-validation` | Bearer-token ingestion; independent source retries | All three sources sync without losing owner or BD history |
| Identity and evidence enrichment | `active` | Provenance and conflicts retained; reversible resolution | Pilot defect rate accepted |
| Offer and campaign engine | `active` | Versioned offers and separate direct/channel/overflow lanes | At least one product and one service campaign reviewed |
| BD workflow and next-best-action | `active` | Human-owned tasks, follow-ups and evidence-grounded recommendations | Pilot team operates without spreadsheets |
| Human-controlled outreach workbench | `active` | Exact revision approval and immutable manual-send records | Review and sent-history pilot accepted |
| Commercial analytics and calibration | `active` | Real stored events, explicit values and management decisions | Representative reviewed sample available |
| Automatic external outreach | `on-hold` | No transport or platform action in the pilot | Separate platform, security, compliance and commercial approval |
| Historical Playwright/browser-control experiments | `superseded-reference` | Retained for decision history only | Remove only after retention review; never install or operate |
| V4 command names and `acquisition_v4` module | `superseded-reference` | Compatibility aliases and internal package only | One accepted upgrade and rollback drill with no dependency |

## Authoritative branch chain

The accepted implementation order is:

1. PR #223 — warm acquisition/runtime foundation;
2. PR #225 — Sales Navigator cold campaigns;
3. PR #236 onward — scheduled capture, identity, enrichment, campaign and account intelligence;
4. PR #251 — operational BD workspace;
5. PR #254 — authoritative outreach workbench;
6. PR #256 — authoritative commercial analytics and calibration;
7. this release-baseline branch — canonical installer, naming, diagnostics, rollback and status registry.

Closed PRs #252 and #253 are obsolete implementations and must not be reintroduced.

## Upgrade behavior

Installation must:

- keep `%LOCALAPPDATA%\Codistan\Acquisition` unchanged;
- preserve `records.jsonl`, `seen.json`, review output, sync fingerprints and configuration;
- stop only the currently registered TalentTrack/legacy acquisition runtime processes;
- move `app-current` to `app-previous` before replacing application files;
- install canonical TalentTrack commands and shortcuts;
- retain legacy command wrappers during the compatibility period;
- validate all three collector health endpoints before reporting success;
- automatically restore the previous application package if health validation fails.

## Rollback behavior

Rollback restores `app-previous` as `app-current` without deleting state. Captured records, deduplication fingerprints, review output and synchronization configuration remain outside the application package and must survive both upgrade and rollback.

## Operator acceptance sequence

1. Run `START-HERE-TALENTTRACK.cmd`.
2. Confirm the canonical TalentTrack desktop and startup shortcuts exist.
3. Reload the Upwork and LinkedIn unpacked extensions from the documented state root.
4. Run `CHECK-TALENTTRACK.cmd` and confirm ports 8765, 8775 and 8785 are healthy.
5. Run `DIAGNOSE-TALENTTRACK.cmd` and confirm diagnostics contain no credentials, cookies, opportunity bodies or sync token.
6. Run sanitized fixture regressions.
7. Run the Upwork, LinkedIn and Sales Navigator live acceptance gates independently.
8. Confirm Prospect Desk preserves assignment, outreach and outcome history on repeated enrichment.
9. Perform one rollback drill and verify local state is unchanged.
10. Advance the release only after management records source and campaign keep/change/stop decisions.

## Merge policy

`main` must not be updated merely because code checks pass. The release requires:

- green dedicated CI for each authoritative slice;
- one coherent Windows installer and diagnostics package;
- successful real-source acceptance for warm and cold lanes;
- PostgreSQL/Prospect Desk synchronization proof;
- state-preserving upgrade and rollback evidence;
- explicit confirmation that no external action was automated.
