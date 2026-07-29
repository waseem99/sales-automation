# Prospecting OS Pilot Usability Runbook

## Purpose

Use this runbook during the first live Upwork, LinkedIn warm-demand and Sales Navigator pilots for Codistan Sales Automation and Prospect Desk. The objective is to identify real operator friction without expanding the release scope or weakening the human-control boundary.

## Before each pilot session

1. Run `CHECK-PROSPECTING-OS-RELEASE.cmd`.
2. Confirm all three collector health endpoints report the expected runtime version and `external_actions_enabled: false`.
3. Confirm Prospect Desk synchronization is configured for all three sources.
4. Record the installed release, extension versions, Windows user and pilot start time.
5. Confirm the operator is using the approved saved search, campaign and browser profile.

Do not start a live capture when the release check exits `1`. An exit `2` is acceptable only for local capture diagnosis; it is not acceptable for a full synchronized pilot.

## Operator workflow

For each captured Priority A/B record, the operator should be able to complete this sequence without using a spreadsheet or private notes:

1. verify source identity and evidence;
2. confirm or assign the owner;
3. review qualification, missing evidence and risks;
4. select the permitted human-controlled channel;
5. identify approved proof relevant to the record;
6. create or review a draft;
7. submit the exact revision for review;
8. approve or request changes;
9. copy the exact approved revision;
10. complete the external action manually;
11. confirm the exact sent version and time;
12. create the next follow-up task.

The system must never perform step 10.

## Required fields before pursuit

A record accepted for pursuit must retain:

- source and canonical identity;
- Priority A/B disposition and reasons;
- owner;
- stage;
- next action;
- due date;
- permitted channel;
- relevant approved proof;
- unresolved evidence and risk warnings;
- exact approved outreach revision when contact is planned;
- exact sent-version record only after manual external action.

## Severity model

### P0 — safety or data-loss blocker

Examples:

- any automatic external platform action;
- credentials, cookies or tokens written to reports;
- source records or durable BD history deleted;
- approval bypass;
- wrong revision recorded as sent;
- rollback destroys operational state.

Stop the affected pilot immediately. Preserve evidence and do not work around the issue.

### P1 — release blocker

Examples:

- duplicate Prospect Desk records from unchanged captures;
- owner, task, stage or outreach history overwritten;
- cold prospects shown as confirmed buyer demand;
- wrong source, campaign or canonical identity;
- research-only or on-hold offers approved for cold outreach;
- synchronization silently loses accepted records.

Pause the affected source until a reproducible fix and regression test exist.

### P2 — material operator friction

Examples:

- queue, filter or action labels are unclear;
- required evidence is present but difficult to find;
- error messages do not explain a recoverable failure;
- diagnostics do not distinguish zero results from source failure;
- operator requires repeated unnecessary navigation.

Fix during RC1 only when supported by a reproducible pilot example.

### P3 — non-blocking improvement

Examples:

- cosmetic spacing or copy;
- optional convenience filters;
- minor ordering preferences.

Record for a later release unless the change is exceptionally small and low risk.

## Daily reconciliation

At the end of each pilot day:

1. compare local unique-record counts with Prospect Desk;
2. review duplicate and identity-conflict warnings;
3. confirm failed sync items remain queued for retry;
4. verify enrichment did not erase owner or workflow history;
5. review overdue tasks and missing pursuit fields;
6. verify manually contacted records have exact approved and sent-version history;
7. log each defect with source, record ID, expected result, observed result and severity;
8. confirm no automatic external action occurred.

## Allowed RC1 changes

During the pilot, changes are limited to:

- confirmed P0–P2 defect fixes;
- clearer diagnostics and error text;
- directly evidenced queue, filter or field-location improvements;
- installer, synchronization and rollback corrections;
- regression tests for confirmed pilot failures.

Do not add new sources, automatic sending, paid enrichment, speculative scoring redesigns or unrelated features.

## Release decision

The release can advance only when:

- source and human-review thresholds pass;
- no P0 or P1 defect remains open;
- installation, synchronization and rollback evidence is retained;
- any accepted P2 workaround is documented;
- management records source and campaign keep/change/stop decisions;
- automatic external action remains disabled.
