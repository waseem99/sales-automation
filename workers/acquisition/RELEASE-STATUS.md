# Codistan Acquisition — Release Status

**Authoritative product version:** `1.0.0-rc.1`  
**Release state:** `live-validation`  
**Operator name:** **Codistan Acquisition**

This document and `RELEASE.json` are the authoritative status references for the local acquisition product. New operator instructions must not use V4 or V5 terminology. Those names remain only in internal module paths and compatibility aliases until a post-release retention review.

## Active architecture

| Layer | Active capability | Local/runtime boundary | Status |
|---|---|---|---|
| Upwork | Approved saved-search job capture and qualification | Chrome extension → `127.0.0.1:8765` | Code-complete; operator live acceptance required |
| LinkedIn | Warm buyer-requirement capture | Combined LinkedIn extension → `127.0.0.1:8775` | Code-complete; operator live acceptance required |
| Sales Navigator | Cold direct-buyer, channel-partner and delivery-partner campaigns | Combined LinkedIn extension → `127.0.0.1:8785` | Code-complete; operator live acceptance required |
| Local supervisor | Starts and monitors all three collectors | Internal compatibility module `acquisition_v4.supervisor` | Active |
| Prospect Desk | Review, ownership, workflow, account intelligence and source workspaces | Authenticated Vercel/Neon application | Dedicated gates green through PR #253 |
| Outreach workbench | Human-controlled draft, approval, copy and exact manual-send history | Prospect Desk only | Dedicated gate green; no sending capability |
| Commercial analytics | Funnel quality, explicit value and keep/change/stop calibration | `/commercial-analytics` | Dedicated gate green |

## State boundary

Application code lives in `%LOCALAPPDATA%\Codistan\Acquisition\app-current` and the rollback slot in `app-previous`.

The following state is outside both application slots and must survive installation and rollback unchanged:

- `config\prospect-desk-sync.json`;
- each source's `records.jsonl`;
- each source's `seen.json` deduplication fingerprints;
- stable unpacked extension folders under `extensions\`.

Source `status.json`, generated review HTML, PIDs, locks and logs are regenerable operational files. They are not considered captured-record state.

## PR and issue state

| Item | Capability | Current state |
|---|---|---|
| PR #223 | Upwork + LinkedIn warm capture | Code-complete; live-source acceptance still required |
| PR #225 | Sales Navigator campaigns | Code-complete; live-source acceptance still required |
| PR #250 | Upwork account intelligence | Dedicated CI green |
| PR #251 | Operational BD workspace | Dedicated CI green |
| PR #252 | Human-controlled outreach workbench | Dedicated CI green |
| PR #253 | Commercial analytics and calibration | Dedicated CI green |
| Issue #244 | Final release consolidation | Pre-acceptance release tooling in progress |
| Issue #226 | Consolidated release baseline | Blocked from final merge until all live gates pass |

## Merge order

The dependency order is:

`#223 → #225 → #250 → #251 → #252 → #253 → #244 release consolidation`

Do not retarget or merge a dependent PR independently. The final release branch must be created from the accepted head after source and dashboard validation. `main` must not be updated merely because package CI is green.

## Required live gates

Before final consolidation:

1. Upwork: capture a real approved-search job and verify canonical evidence, qualification and Prospect Desk persistence.
2. LinkedIn warm: capture a real buyer-authored requirement and verify canonical post URL, correct classification and persistence.
3. Sales Navigator: capture an approved campaign lead and verify route, person/company identity, cold-stage separation and persistence.
4. Prospect Desk: verify existing owner, stage, task, audit, workbench and commercial-value history survive upgrade.
5. Rollback: verify the previous application slot starts and protected state hashes are unchanged.
6. Operator approval: Waseem explicitly approves final branch consolidation.

## External-action policy

All capture, review, scoring, workflow, drafting and analytics may be automated internally. External actions remain human-only:

- no Upwork proposal submission;
- no email sending;
- no LinkedIn message, InMail, connection request, follow, reaction or comment;
- no inferred off-platform route for an Upwork job.

The outreach workbench may record an action only after a user confirms it was already performed manually outside the system.
