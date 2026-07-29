# Codistan Sales Automation / Prospect Desk 1.0.0-rc.1

## Purpose

This is the consolidated release candidate for Codistan's warm-demand capture, cold-campaign research, qualification, BD workflow and human-controlled outreach system.

The canonical product is **Codistan Sales Automation**. The production application is **Prospect Desk**. Acquisition V4/V5 and the older operator command names remain implementation or compatibility vocabulary only.

No captured record, deduplication fingerprint, campaign, Prospect Desk configuration, BD history or on-hold feature is deleted by this release.

## Release composition

| Component | Version | State |
|---|---:|---|
| Local three-source runtime | 0.3.0 | Code-complete; live validation required |
| Upwork Chrome extension | 1.1.0 | Real saved-search pilot required |
| LinkedIn and Sales Navigator extension | 1.5.0 | Real LinkedIn and licensed Sales Navigator pilots required |
| Prospect Desk ingestion | acquisition-ingest v1 | Deployed three-source test required |
| Identity graph | identity-graph v1 | Real duplicate review required |
| Evidence enrichment | enrichment v1 | Source-visible mode active; paid providers on hold |
| Campaign engine | campaign-engine v1 | Direct buyer, channel and overflow lanes active |
| Upwork account intelligence | v1 | Real buyer-account review required |
| BD workflow | bd-workflow.v1 | Daily-team-use pilot required |
| Outreach workbench | outreach-workbench.v1 | Human review and manual-send logging pilot required |
| Commercial readiness | commercial-readiness.v1 | Enforced before cold-outreach approval |
| Combined pilot acceptance | codistan-sales-automation-acceptance.v1 | Technical and human commercial release gate |

## Active commercial routes

### FinTech Backend Operations Platform

Routes retained for research:

- direct FinTech buyers;
- channel and implementation partners;
- referral or reseller partners.

**Current status: research-only for cold outreach.**

Cold outreach approval remains blocked until the offer owner approves exact workflows, an externally usable demo or architecture, supported integrations, deployment boundaries, pilot scope, pricing assumptions, relevant proof, and approved security/privacy/compliance statements.

Warm buyer requirements may receive a human-reviewed response within verified service capability. The response must not present the platform as production-ready.

### Managed Software and AI Delivery Partnership

Approved routes include overflow delivery, white-label delivery teams, specialist subcontracting and long-term managed delivery.

**Current status: outreach-ready with limitations.**

Before approval, the operator must confirm the delivery lane, relevant proof, team availability, mobilisation timing and white-label/NDA boundaries. Campaign fit is not confirmed buyer intent.

## Canonical operator entry points

- `START-HERE-SALES-AUTOMATION.cmd`
- `START-SALES-AUTOMATION.cmd`
- `CHECK-SALES-AUTOMATION-RELEASE.cmd`
- `CHECK-SALES-AUTOMATION-PILOT.cmd`
- `DIAGNOSE-SALES-AUTOMATION.cmd`
- `ROLLBACK-SALES-AUTOMATION.cmd`
- desktop shortcut: **Start Sales Automation**
- desktop shortcut: **Check Sales Automation Release**
- desktop shortcut: **Check Sales Automation Pilot**
- desktop shortcut: **Configure Prospect Desk Sync**
- desktop shortcut: **Open Acquisition Review**
- desktop shortcut: **Check Sales Navigator Pilot**

Historical command filenames remain as explicitly labelled compatibility aliases. They must not be used in new documentation, shortcuts or release evidence.

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

The release preserves source records, seen fingerprints, review outputs, capture status, Prospect Desk sync configuration, retry state, campaigns, BD history, outreach revisions and approvals, sent-version history, and human commercial reviews.

If all three collectors do not become healthy with the expected runtime version and external actions disabled, the installer restores the previous application package.

## Safety boundary

The release does not automatically:

- submit an Upwork proposal;
- send an email;
- send a LinkedIn message or InMail;
- send a connection request;
- comment, follow or react;
- bypass login, verification, checkpoint or platform controls.

Automatic external outreach remains on hold. A sent-version record is created only after a human confirms that the exact approved revision was sent outside the system.

## Release readiness command

Run:

```text
CHECK-SALES-AUTOMATION-RELEASE.cmd
```

It validates the release identity and manifest, current and rollback packages, extension versions, all three health endpoints, runtime/source identity, external-action disablement, Prospect Desk sync configuration and local review output.

It writes:

```text
%LOCALAPPDATA%\Codistan\Acquisition\review\sales-automation-release-readiness.json
```

Results:

- exit `0`: ready for the full commercial pilot;
- exit `2`: local capture is ready, but Prospect Desk synchronization is incomplete;
- exit `1`: blocking release failure.

## Combined pilot acceptance command

Run:

```text
CHECK-SALES-AUTOMATION-PILOT.cmd
```

It writes:

```text
%LOCALAPPDATA%\Codistan\Acquisition\review\sales-automation-pilot-acceptance.json
```

The human review input remains:

```text
%LOCALAPPDATA%\Codistan\Acquisition\review\commercial-review.json
```

Only Priority A/B records with a valid reviewer, review time and accepted-for-pursuit decision count toward the gate.

Results:

- exit `0`: technical source gates and the human commercial gate passed;
- exit `2`: additional records or human reviews are required;
- exit `1`: a safety failure or external-action evidence was detected;
- exit `3`: a required collector is unavailable or unsafe.

## Live acceptance thresholds

### Upwork

- at least 100 unique records;
- at least 15 Priority A/B records;
- at least 95% canonical URL, identity, title and body coverage;
- at least 70% buyer or job evidence coverage;
- zero external-action records.

### LinkedIn warm demand

- at least 50 unique buyer-authored posts;
- at least 10 Priority A/B records;
- at least 95% canonical permalink, identity, title and body coverage;
- at least 70% author-profile coverage;
- zero external-action records.

### Sales Navigator cold campaigns

- at least 75 unique prospects;
- at least 15 Priority A/B records;
- at least 95% canonical identity and campaign metadata coverage;
- at least 80% role and company evidence;
- cold/no-confirmed-intent warnings on at least 95%;
- zero external-action records.

### Human commercial gate

- at least 15 valid Priority A/B reviews;
- at least three reviews from each source;
- at least 60% accepted for pursuit;
- reviewer and review-time evidence for every counted decision.

Every pursued record must have an owner, stage, next action, due date, permitted channel and relevant proof.

## Merge policy

This release remains draft until:

1. repository identity, repository CI, acquisition runtime CI, production build and release-contract checks pass on the exact head;
2. Windows clean install, upgrade and rollback are tested without state loss;
3. all three live source pilots pass;
4. the combined human commercial gate passes;
5. Prospect Desk synchronization is verified without duplication or history loss;
6. no automatic external action is observed.
