# Prospecting OS Pilot Usability Runbook

## Purpose

Use this runbook during the first live Upwork, LinkedIn warm-demand and Sales Navigator pilots. The objective is to identify real operator friction without expanding the release scope or weakening the human-control boundary.

## Before each pilot session

1. Run `CHECK-PROSPECTING-OS-RELEASE.cmd`.
2. Confirm all three collector health endpoints report the expected runtime version and `external_actions_enabled: false`.
3. Confirm Prospect Desk synchronization is configured for all three sources.
4. Record the installed release, extension versions, Windows user and pilot start time.
5. Confirm the operator is using the approved saved search, campaign and browser profile.

Do not start a live capture when the release check exits `1`. An exit `2` is acceptable only for local capture diagnosis; it is not acceptable for a full synchronized pilot.

## Operator workflow

For each captured Priority A/B record, the operator should be able to complete this sequence without using a spreadsheet or private notes:

1. Open the record from My Queue or Manager Review.
2. Confirm source, canonical URL, identity and visible evidence.
3. Confirm whether the record represents warm buyer demand or a cold campaign prospect.
4. Review closeability, missing evidence, risks and prohibited claims.
5. Assign an owner, stage, next action, due date and permitted channel.
6. Select relevant proof or record that proof is missing.
7. Create or import an outreach draft only when commercially permitted.
8. Submit, request changes, approve or reject the exact draft revision.
9. Copy the approved revision and perform the external action manually.
10. Mark the exact approved revision as manually sent only after the external action has occurred.

## Usability observations to record

Create one finding for each distinct problem. Do not combine unrelated issues.

Required fields:

- source: Upwork, LinkedIn warm demand or Sales Navigator;
- record ID and canonical URL;
- operator;
- time observed;
- exact screen or action;
- expected result;
- actual result;
- whether work could continue safely;
- screenshot or diagnostic file when available;
- severity and suggested next step.

### Severity

- **P0 — safety or state integrity:** external action occurred automatically, approval was bypassed, sent history changed, records were lost, or cross-owner data was exposed. Stop the pilot immediately.
- **P1 — release blocker:** capture, synchronization, authentication, owner scoping, deduplication or the main review workflow cannot be completed. Stop the affected source pilot.
- **P2 — material operator friction:** the task can be completed, but the operator is likely to make an error or needs an undocumented workaround. Fix before broad team rollout.
- **P3 — minor clarity:** wording, ordering or visual presentation causes avoidable hesitation but does not change the decision or data. Batch after the pilot gate.

## Allowed release-candidate changes

Changes during the pilot are limited to documented findings in these categories:

- incorrect or missing queue membership;
- broken filters or links;
- misleading source, intent or commercial-readiness labels;
- unclear empty, error or blocked states;
- missing diagnostics required to identify a failed source or sync step;
- next-best-action guidance contradicted by verified workflow state;
- duplicate records or state-loss defects;
- approval, revision or manually-sent history defects;
- accessibility or layout defects that prevent normal operation.

Do not add a new acquisition source, automated sending, autonomous campaign expansion, paid enrichment provider or predictive scoring model during this release candidate.

## Daily pilot review

At the end of each pilot day:

1. Export or preserve collector status, review output and relevant diagnostics.
2. Reconcile captured counts against Prospect Desk counts by source.
3. Review duplicate and failed-sync records.
4. Review all P0/P1 findings before continuing.
5. Confirm no automatic external-action evidence exists.
6. Confirm every pursued record has an owner, stage, next action, due date, permitted channel and proof.
7. Update `commercial-review.json` only for records actually reviewed by a named person.
8. Run `CHECK-PROSPECTING-OS-PILOT.cmd` and preserve the result.

## Release decision

The release remains draft when any of the following is true:

- a P0 or unresolved P1 finding exists;
- installer rollback has not been proven on the real workstation;
- Prospect Desk synchronization is incomplete or duplicates/state loss are unexplained;
- any source has not met its technical gate;
- fewer than 15 valid Priority A/B human reviews exist;
- fewer than three valid reviews exist for any source;
- fewer than 60% of counted reviews are accepted for pursuit;
- automatic external-action evidence exists.

A P2 may be accepted temporarily only when the workaround is documented, safe, reversible and approved by the release owner. P3 findings do not block the release unless several indicate a common decision-quality problem.
