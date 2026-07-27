# Codistan Prospecting OS 1.0.0-rc.1

## Purpose

This is the first consolidated release candidate for Codistan's warm-demand, cold-campaign, qualification, BD workflow and human-controlled outreach system.

It replaces mixed operator vocabulary such as Acquisition V4 and Acquisition V5 with one product identity while preserving the older filenames as compatibility entry points. No captured record, deduplication fingerprint, campaign, Prospect Desk configuration, BD history or on-hold feature is deleted by this release.

## Release composition

| Component | Version | State |
|---|---:|---|
| Local three-source runtime | 0.3.0 | Code-complete; live validation required |
| Upwork Chrome extension | 1.1.0 | Code-complete; real saved-search pilot required |
| LinkedIn and Sales Navigator extension | 1.5.0 | Code-complete; real LinkedIn and licensed Sales Navigator pilots required |
| Prospect Desk ingestion | acquisition-ingest v1 | Code-complete; deployed three-source test required |
| Identity graph | identity-graph v1 | Code-complete; real duplicate review required |
| Evidence enrichment | enrichment v1 | Source-visible mode active; paid providers on hold |
| Campaign engine | campaign-engine v1 | Direct buyer, channel and overflow lanes active |
| Upwork account intelligence | v1 | Code-complete; real buyer-account review required |
| BD workflow | bd-workflow.v1 | Code-complete; daily-team-use pilot required |
| Outreach workbench | outreach-workbench.v1 | Code-complete; human review/send logging pilot required |

## Active commercial routes

### FinTech Backend Operations Platform

- direct FinTech buyers;
- channel and implementation partners;
- referral or reseller partners.

### Managed Software and AI Delivery Partnership

- overflow delivery;
- white-label backend team;
- specialist subcontracting;
- long-term managed delivery.

Campaign fit is not treated as confirmed buyer intent. Cold prospects remain cold until separate evidence shows an active requirement.

## Canonical operator entry points

- `START-HERE-PROSPECTING-OS.cmd`
- `CHECK-PROSPECTING-OS-RELEASE.cmd`
- desktop shortcut: **Start Prospecting OS**
- desktop shortcut: **Check Prospecting OS Release**
- desktop shortcut: **Configure Prospect Desk Sync**
- desktop shortcut: **Open Acquisition Review**
- desktop shortcut: **Check Sales Navigator Pilot**

The previous V4/V5 commands and shortcuts remain available as compatibility aliases.

## State and rollback contract

The following root is never replaced or deleted during an upgrade:

```text
%LOCALAPPDATA%\Codistan\Acquisition
```

The installer rotates only the application package:

```text
app-current → app-previous
new package → app-current
```

The release preserves:

- source records;
- seen and deduplication fingerprints;
- review outputs;
- capture and health status;
- Prospect Desk sync configuration;
- sync fingerprints and retry state;
- registered Sales Navigator campaigns;
- BD owner, task, stage and activity history;
- outreach drafts, revisions, approvals and sent-version history.

If the three collectors do not become healthy with the expected runtime version and external actions disabled, installation restores the previous application package.

## Safety boundary

The release does not automatically:

- submit an Upwork proposal;
- send an email;
- send a LinkedIn message or InMail;
- send a connection request;
- comment, follow or react;
- bypass login, verification, checkpoint or platform controls.

The outreach workbench records a manual action only after a human confirms that the exact approved revision was sent outside the system.

## Readiness command

Run:

```text
CHECK-PROSPECTING-OS-RELEASE.cmd
```

It validates:

- installed release manifest;
- current application package;
- rollback package availability;
- Upwork extension version;
- LinkedIn/Sales Navigator extension version;
- all three collector health endpoints;
- runtime version and source identity;
- absence of collector errors;
- external actions disabled;
- three-source Prospect Desk sync configuration;
- local review output availability.

It writes:

```text
%LOCALAPPDATA%\Codistan\Acquisition\review\prospecting-os-release-readiness.json
```

Possible results:

- exit `0`: ready for the full commercial pilot;
- exit `2`: local capture is ready, but Prospect Desk synchronization is not fully configured;
- exit `1`: blocking local release failure.

## Live acceptance sequence

### Upwork

Review at least 100 captured jobs across the approved saved searches. Confirm canonical URLs, deduplication, qualification precision, budget/buyer evidence, profile recommendation and proposal usefulness.

### LinkedIn warm demand

Review at least 50 captured buyer-authored posts. Confirm permalink recovery, vacancy rejection, author/profile extraction, correct service categorization and acceptable false-positive rate.

### Sales Navigator cold campaigns

Review at least 75 prospects split across direct FinTech buyers, FinTech channel partners and software/AI overflow partners. Confirm ICP fit, decision-maker relevance, company fit, contactability and duplicate-person/account handling.

### Human commercial gate

At least 60% of reviewed Priority A/B records must be accepted by a human BD reviewer as worth pursuing. Every pursued record must have an owner, stage, next action, due date, permitted channel and relevant proof.

## On hold

The following work is preserved but excluded from this release:

- automatic external outreach;
- paid enrichment providers;
- additional acquisition sources;
- autonomous campaign expansion;
- advanced predictive scoring without conversion evidence.

Reactivation requires a separate approved issue and explicit release authorization.

## Merge policy

This release candidate remains a draft until:

1. its dedicated release CI passes;
2. the Windows installer and rollback are tested on the real workstation;
3. the three source pilots pass their technical gates;
4. the human commercial gate passes;
5. Prospect Desk synchronization is verified without duplication or state loss.
