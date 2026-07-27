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
| Commercial readiness | commercial-readiness.v1 | Enforced before cold-outreach approval |
| Combined pilot acceptance | codistan-prospecting-os-acceptance.v1 | Technical and human commercial release gate |

## Active commercial routes

### FinTech Backend Operations Platform

Routes retained for research:

- direct FinTech buyers;
- channel and implementation partners;
- referral or reseller partners.

**Current status: research-only for cold outreach.**

Cold outreach approval remains blocked until the offer owner approves:

- exact operational workflows and user roles;
- an externally usable demo, screenshots or architecture;
- supported integrations and deployment boundaries;
- pilot scope and pricing hypothesis;
- financial-services proof or conservative proxy proof;
- approved security, privacy and compliance statements.

Warm buyer requirements may still receive a human-reviewed response, but the response must stay within verified service capability and must not present the product as production-ready.

### Managed Software and AI Delivery Partnership

Approved routes:

- overflow delivery;
- white-label backend team;
- specialist subcontracting;
- long-term managed delivery.

**Current status: outreach-ready with limitations.**

Before approval, the operator must confirm the relevant delivery lane, proof, team availability, mobilisation timing and white-label/NDA boundaries. The system prohibits unlimited-capacity or immediate-start promises without confirmation.

Campaign fit is not treated as confirmed buyer intent. Cold prospects remain cold until separate evidence shows an active requirement.

## Commercial approval enforcement

The Prospect Desk outreach workbench displays the applicable commercial-readiness profile.

For cold campaigns:

- `research_only` or `on_hold` offers cannot be approved;
- unknown or unmapped offers cannot be approved;
- `outreach_ready_limited` offers may be approved only within their documented claims, proof and capacity limits;
- editing an approved draft invalidates the approval;
- the exact approved revision must be the revision manually marked as sent.

The authenticated API enforces the same rule. Hiding or bypassing the browser control does not bypass the server-side check.

## Canonical operator entry points

- `START-HERE-PROSPECTING-OS.cmd`
- `CHECK-PROSPECTING-OS-RELEASE.cmd`
- `CHECK-PROSPECTING-OS-PILOT.cmd`
- desktop shortcut: **Start Prospecting OS**
- desktop shortcut: **Check Prospecting OS Release**
- desktop shortcut: **Check Prospecting OS Pilot**
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
- outreach drafts, revisions, approvals and sent-version history;
- human commercial review evidence.

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

## Release readiness command

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

## Combined pilot acceptance command

Run:

```text
CHECK-PROSPECTING-OS-PILOT.cmd
```

It evaluates all three sources together and writes:

```text
%LOCALAPPDATA%\Codistan\Acquisition\review\prospecting-os-pilot-acceptance.json
```

The human review input is:

```text
%LOCALAPPDATA%\Codistan\Acquisition\review\commercial-review.json
```

A template is created automatically on first use. Only Priority A/B records with a valid reviewer, review time and accepted-for-pursuit decision count toward the gate.

Possible results:

- exit `0`: all technical source gates and the human commercial gate passed;
- exit `2`: more records or human reviews are required;
- exit `1`: external-action evidence or another blocking safety failure was detected.

## Live acceptance sequence

### Upwork

Review at least 100 captured jobs across the approved saved searches. The automated gate requires:

- at least 100 unique records;
- at least 15 Priority A/B records;
- at least 95% canonical URL, identity, title and body coverage;
- at least 70% buyer or job evidence coverage;
- zero external-action records.

Human reviewers must also confirm qualification precision, irrelevant-job rejection, profile recommendation, account-intelligence usefulness and proposal usefulness.

### LinkedIn warm demand

Review at least 50 captured buyer-authored posts. The automated gate requires:

- at least 50 unique records;
- at least 10 Priority A/B records;
- at least 95% canonical permalink, identity, title and body coverage;
- at least 70% author-profile coverage;
- zero external-action records.

Human reviewers must also confirm genuine buyer intent, vacancy rejection, author extraction, service categorisation and false-positive quality.

### Sales Navigator cold campaigns

Review at least 75 prospects split across direct FinTech buyers, FinTech channel partners and software/AI overflow partners. The automated gate requires:

- at least 75 unique records;
- at least 15 Priority A/B records;
- at least 95% canonical identity and campaign-metadata coverage;
- at least 80% role and company evidence;
- cold/no-buyer-intent warnings on at least 95% of records;
- zero external-action records.

Human reviewers must also confirm ICP fit, decision-maker relevance, contactability and duplicate-person/account handling.

### Human commercial gate

The combined gate requires:

- at least 15 valid Priority A/B reviews;
- at least three reviews from each source;
- at least 60% accepted for pursuit;
- reviewer and review-time evidence for every counted decision.

Every pursued record must then have an owner, stage, next action, due date, permitted channel and relevant proof.

## On hold

The following work is preserved but excluded from this release:

- automatic external outreach;
- paid enrichment providers;
- additional acquisition sources;
- autonomous campaign expansion;
- advanced predictive scoring without conversion evidence;
- cold FinTech platform outreach until its commercial-readiness blockers are resolved.

Reactivation requires a separate approved issue and explicit release authorization.

## Merge policy

This release candidate remains a draft until:

1. its dedicated release CI passes;
2. the Windows installer and rollback are tested on the real workstation;
3. the three source pilots pass their technical gates;
4. the combined human commercial gate passes;
5. Prospect Desk synchronization is verified without duplication or state loss.
