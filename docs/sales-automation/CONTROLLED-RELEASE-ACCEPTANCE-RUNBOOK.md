# Codistan Sales Automation Controlled Release Acceptance Runbook

Release candidate: `1.0.0-rc.2`  
Governing issue: #277  
Authoritative release PR: #255  
Final integration Draft: created from the exact green privacy/reliability stack.

## Non-negotiable rules

- Keep every PR Draft until all evidence below is complete.
- Do not merge PR #255 or any dependency during evidence collection.
- Preserve `%LOCALAPPDATA%\Codistan\Acquisition` and all pre-existing records, fingerprints, configuration, review, synchronization, rollback and audit state.
- Do not automatically submit an Upwork proposal.
- Do not automatically send a LinkedIn message, InMail, connection request, follow, reaction or comment.
- Do not automatically send email.
- Use normal user-authorized platform sessions only. Do not bypass login, verification, checkpoints or platform controls.

## Evidence directory

Use a directory outside the installation and state roots, for example:

```powershell
$EvidenceRoot = "$env:USERPROFILE\Desktop\Sales-Automation-RC2-Evidence"
```

The capture script never deletes the application or state root. It writes redacted JSON snapshots only to the chosen evidence directory.

## 1. Record the exact candidate

From GitHub, record:

- final integration PR number;
- exact integration head SHA;
- exact PR #255 head SHA;
- all required green workflow run URLs;
- Windows machine edition/build and current user.

Do not continue if the tested checkout does not match the exact integration head.

## 2. Baseline before installation or upgrade

Run from an elevated PowerShell terminal when required by your environment:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\workers\acquisition\scripts\windows\capture-release-acceptance-evidence.ps1 `
  -Phase before_install `
  -EvidenceRoot $EvidenceRoot
```

This records:

- hashes and sizes for protected state files;
- existing Startup folder links;
- Run and RunOnce values;
- Scheduled Tasks containing Codistan, Sales Automation or Acquisition;
- StartupApproved values;
- managed collector processes and ports;
- extension and release-manifest versions.

## 3. Clean-install test

Use a clean supported Windows user profile or machine with no prior Sales Automation installation.

1. Run the installer without `-EnableAutoStart`.
2. Confirm installation finishes with the runtime stopped.
3. Capture:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\workers\acquisition\scripts\windows\capture-release-acceptance-evidence.ps1 `
  -Phase after_clean_install `
  -EvidenceRoot $EvidenceRoot
```

Required result:

- no Sales Automation startup registration;
- no managed collector left running;
- one manual desktop launcher;
- Acquisition state root preserved;
- external actions disabled in every health response.

## 4. Supported V4/V5 upgrade test

Use a machine/profile containing the supported previous installation and representative state.

1. Record `before_upgrade` evidence.
2. Install RC.2 without autostart.
3. Record `after_upgrade` evidence.
4. Verify legacy Startup, Run/RunOnce, Scheduled Task and StartupApproved registrations are absent.
5. Verify every protected pre-upgrade file still exists with the same SHA-256 hash.

## 5. Restart/manual-start test

1. Restart Windows.
2. Before launching anything, record `after_restart`.
3. Confirm no collector starts automatically.
4. Run **Run Sales Automation** manually.
5. Wait for all three local health endpoints.
6. Record `after_manual_start`.

Required health endpoints:

- Upwork: `http://127.0.0.1:8765/health`
- LinkedIn warm demand: `http://127.0.0.1:8775/health`
- Sales Navigator: `http://127.0.0.1:8785/health`

Every response must report ready/healthy and external actions disabled.

## 6. Explicit autostart opt-in test

1. Stop Sales Automation.
2. Install with `-EnableAutoStart`.
3. Record `after_autostart_opt_in`.
4. Restart Windows and confirm only the documented Sales Automation startup registration launches the runtime.
5. Record `after_opt_in_restart`.
6. Run **Cleanup Sales Automation Autostart** twice.
7. Record `after_cleanup_first` and `after_cleanup_second`.

Both cleanup runs must succeed; the second must make no destructive change.

## 7. Rollback test

1. Ensure representative records, outbox state, seller feedback and review state exist.
2. Run the supported rollback command.
3. Record `after_rollback`.

Required result:

- runtime is stopped;
- autostart is absent;
- app-previous is restored;
- every protected baseline state file is present with the original hash;
- no records, fingerprints, campaign definitions, seller state, outbox/reconciliation state or audit history are lost.

## 8. Three-source controlled pilot

Run approved captures using real authorized sessions:

- Upwork approved saved searches;
- LinkedIn buyer-authored warm-demand searches;
- licensed Sales Navigator campaigns.

Run each synchronization at least twice. Confirm:

- repeated sync creates no duplicate active opportunity;
- duplicate/merge/conflict outcomes are visible;
- seller-owned owner, stage, notes, follow-up, outcome and commercial decisions remain unchanged;
- unresolved records remain locatable in pending/retry/dead-letter views;
- cold Sales Navigator records retain the no-confirmed-intent warning;
- warm evidence remains separate and traceable;
- no automatic external action occurs.

Use the existing command:

```text
CHECK-SALES-AUTOMATION-PILOT.cmd
```

Complete `%LOCALAPPDATA%\Codistan\Acquisition\review\commercial-review.json` with real Priority A/B reviews. The generated pilot report must reach `commercial_gate_passed`.

## 9. Operator attestation

Copy `workers/acquisition/release-acceptance-attestation.template.json` to:

```text
<EvidenceRoot>\operator-attestation.json
```

Replace every placeholder and set a result to `true` only after observing it. Include reviewer identity, timestamp, machine, tested head SHA and evidence references.

## 10. Evaluate release evidence

Run:

```powershell
set PYTHONPATH=workers\acquisition
python -m acquisition_v4.release_acceptance `
  --evidence-root "$EvidenceRoot" `
  --state-root "$env:LOCALAPPDATA\Codistan\Acquisition"
```

Possible results:

- `evidence_incomplete` — required snapshots, pilot report or attestations are missing.
- `release_blocked` — state loss, unsafe startup behavior, duplicate/source failure or external-action evidence exists.
- `ready_for_explicit_release_approval` — technical, Windows, pilot and commercial evidence pass, but no merge is authorized yet.
- `release_approved` — an authorized human separately recorded final approval for the same exact head.

The checker never merges, tags, deploys, starts an external action or modifies captured state.

## 11. Final approval and merge

Only after `ready_for_explicit_release_approval`:

1. Review the complete evidence package.
2. Record explicit final approval on issue #277 for the same exact head.
3. Add the approval to `operator-attestation.json` and rerun the checker.
4. Confirm the final exact-head CI is still green.
5. Mark PR #255 ready only with explicit authorization.
6. Squash merge PR #255.
7. Create the approved release tag.
8. Verify deployment identity, health endpoints, RC/release version and external-action-disabled state.

Any head change invalidates prior final approval and requires exact-head CI and evidence review again.
