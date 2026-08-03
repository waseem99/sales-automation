from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
from typing import Any

from .storage import atomic_write_text, load_json

SCHEMA_VERSION = "codistan-sales-automation-release-acceptance.v1"
ATTESTATION_SCHEMA = "codistan-sales-automation-release-attestation.v1"
WINDOWS_SCHEMA = "codistan-sales-automation-windows-evidence.v1"
PILOT_SCHEMA = "codistan-sales-automation-acceptance.v1"
RELEASE_VERSION = "1.0.0-rc.2"

REQUIRED_PHASES = (
    "before_install",
    "after_clean_install",
    "before_upgrade",
    "after_upgrade",
    "after_restart",
    "after_manual_start",
    "after_autostart_opt_in",
    "after_opt_in_restart",
    "after_cleanup_first",
    "after_cleanup_second",
    "after_rollback",
)

WINDOWS_ATTESTATIONS = (
    "clean_install_no_default_autostart",
    "clean_install_runtime_stopped",
    "supported_upgrade_removed_legacy_autostart",
    "restart_remained_manual_start_only",
    "manual_launcher_started_all_three_collectors",
    "all_health_endpoints_external_actions_disabled",
    "explicit_autostart_opt_in_worked",
    "cleanup_command_idempotent",
    "stop_command_idempotent",
    "rollback_restored_previous_application",
    "rollback_left_runtime_stopped",
    "protected_state_preserved",
)

PILOT_ATTESTATIONS = (
    "upwork_real_authorized_pilot_completed",
    "linkedin_warm_real_authorized_pilot_completed",
    "licensed_sales_navigator_pilot_completed",
    "repeated_sync_no_duplicate_active_opportunities",
    "seller_owned_fields_and_history_preserved",
    "cold_no_confirmed_intent_preserved",
    "pending_retry_dead_letter_records_locatable",
    "human_commercial_review_completed",
    "zero_automatic_external_actions_observed",
)


def _mapping(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def _has_text(value: Any) -> bool:
    return bool(str(value or "").strip())


def _load_required_json(path: Path) -> tuple[dict[str, Any], str | None]:
    value = load_json(path, None)
    if not isinstance(value, dict):
        return {}, f"Missing or invalid JSON: {path}"
    return value, None


def _startup_count(snapshot: dict[str, Any]) -> int:
    startup = _mapping(snapshot.get("startup"))
    return sum(len(_list(startup.get(key))) for key in (
        "startup_folder_entries",
        "run_key_entries",
        "startup_approved_entries",
        "scheduled_tasks",
    ))


def _managed_process_count(snapshot: dict[str, Any]) -> int:
    return len(_list(_mapping(snapshot.get("runtime")).get("managed_processes")))


def _state_manifest(snapshot: dict[str, Any]) -> dict[str, dict[str, Any]]:
    output: dict[str, dict[str, Any]] = {}
    for item in _list(snapshot.get("protected_state_manifest")):
        if not isinstance(item, dict):
            continue
        relative = str(item.get("relative_path") or "").strip()
        if relative:
            output[relative] = item
    return output


def _compare_protected_state(before: dict[str, Any], after: dict[str, Any]) -> dict[str, Any]:
    baseline = _state_manifest(before)
    final = _state_manifest(after)
    missing = sorted(path for path in baseline if path not in final)
    changed = sorted(
        path for path, item in baseline.items()
        if path in final and str(item.get("sha256")) != str(final[path].get("sha256"))
    )
    return {
        "baseline_files": len(baseline),
        "final_files": len(final),
        "missing_files": missing,
        "changed_files": changed,
        "preserved": not missing and not changed,
    }


def _snapshot_gate(phase: str, snapshot: dict[str, Any]) -> dict[str, Any]:
    runtime = _mapping(snapshot.get("runtime"))
    identity = _mapping(snapshot.get("release_identity"))
    schema_ok = snapshot.get("schema_version") == WINDOWS_SCHEMA
    release_ok = identity.get("release_version") == RELEASE_VERSION
    versions_ok = (
        identity.get("linkedin_sales_navigator_extension") == identity.get("linkedin_manifest_version") == "1.6.1"
        and identity.get("upwork_extension") == identity.get("upwork_manifest_version") == "1.1.1"
    )
    external_disabled = identity.get("external_actions_enabled") is False
    capture_safe = _mapping(snapshot.get("safety")).get("external_action_performed") is False
    return {
        "phase": phase,
        "schema_valid": schema_ok,
        "release_version_valid": release_ok,
        "extension_versions_valid": versions_ok,
        "release_external_actions_disabled": external_disabled,
        "capture_external_action_performed_false": capture_safe,
        "startup_registration_count": _startup_count(snapshot),
        "managed_process_count": _managed_process_count(snapshot),
        "all_collectors_ready": runtime.get("all_collectors_ready") is True,
        "all_reachable_collectors_external_actions_disabled": runtime.get("all_external_actions_disabled") is True,
        "passed_identity_and_safety": all((schema_ok, release_ok, versions_ok, external_disabled, capture_safe)),
    }


def _attestation_report(attestation: dict[str, Any]) -> dict[str, Any]:
    windows = _mapping(attestation.get("windows_results"))
    pilot = _mapping(attestation.get("pilot_results"))
    final = _mapping(attestation.get("final_approval"))
    windows_missing = [key for key in WINDOWS_ATTESTATIONS if windows.get(key) is not True]
    pilot_missing = [key for key in PILOT_ATTESTATIONS if pilot.get(key) is not True]
    placeholders = [
        field for field in ("tested_integration_head", "tested_pr255_head", "operator", "reviewer", "recorded_at")
        if not _has_text(attestation.get(field)) or "REPLACE_WITH" in str(attestation.get(field))
    ]
    exact_heads = all(
        len(str(attestation.get(field) or "").strip()) == 40
        and all(character in "0123456789abcdefABCDEF" for character in str(attestation.get(field)).strip())
        for field in ("tested_integration_head", "tested_pr255_head")
    )
    final_approved = (
        final.get("approved") is True
        and final.get("exact_head_confirmed") is True
        and _has_text(final.get("approved_by"))
        and _has_text(final.get("approved_at"))
        and _has_text(final.get("approved_in_issue_comment_url"))
    )
    return {
        "schema_valid": attestation.get("schema_version") == ATTESTATION_SCHEMA,
        "release_version_valid": attestation.get("release_version") == RELEASE_VERSION,
        "placeholder_fields": placeholders,
        "exact_heads_valid": exact_heads,
        "windows_missing_or_false": windows_missing,
        "pilot_missing_or_false": pilot_missing,
        "evidence_reference_count": len(_list(attestation.get("evidence_references"))),
        "operator_evidence_complete": not placeholders and exact_heads and not windows_missing and not pilot_missing,
        "final_approval_recorded": final_approved,
    }


def _pilot_report(state_root: Path) -> dict[str, Any]:
    path = state_root / "review" / "sales-automation-pilot-acceptance.json"
    report, error = _load_required_json(path)
    release = _mapping(report.get("release_decision"))
    return {
        "path": str(path),
        "error": error,
        "schema_valid": report.get("schema_version") == PILOT_SCHEMA,
        "status": report.get("status"),
        "commercial_gate_passed": report.get("status") == "commercial_gate_passed",
        "merge_allowed_by_pilot": release.get("merge_allowed") is True,
        "automatic_external_actions_allowed": release.get("automatic_external_actions_allowed"),
        "external_action_boundary_passed": release.get("automatic_external_actions_allowed") is False,
    }


def build_report(evidence_root: Path, state_root: Path) -> dict[str, Any]:
    errors: list[str] = []
    snapshots: dict[str, dict[str, Any]] = {}
    for phase in REQUIRED_PHASES:
        snapshot, error = _load_required_json(evidence_root / f"{phase}.json")
        if error:
            errors.append(error)
        snapshots[phase] = snapshot

    attestation, attestation_error = _load_required_json(evidence_root / "operator-attestation.json")
    if attestation_error:
        errors.append(attestation_error)

    snapshot_gates = {phase: _snapshot_gate(phase, snapshot) for phase, snapshot in snapshots.items() if snapshot}
    baseline = snapshots.get("before_upgrade") or snapshots.get("before_install") or {}
    state_comparison = _compare_protected_state(baseline, snapshots.get("after_rollback") or {})
    attestation_result = _attestation_report(attestation)
    pilot = _pilot_report(state_root)
    if pilot["error"]:
        errors.append(str(pilot["error"]))

    no_default_startup = all(
        snapshot_gates.get(phase, {}).get("startup_registration_count") == 0
        for phase in ("after_clean_install", "after_upgrade", "after_restart", "after_cleanup_first", "after_cleanup_second", "after_rollback")
    )
    stopped_when_required = all(
        snapshot_gates.get(phase, {}).get("managed_process_count") == 0
        for phase in ("after_clean_install", "after_upgrade", "after_restart", "after_cleanup_first", "after_cleanup_second", "after_rollback")
    )
    opt_in_present = (
        snapshot_gates.get("after_autostart_opt_in", {}).get("startup_registration_count", 0) >= 1
        and snapshot_gates.get("after_opt_in_restart", {}).get("startup_registration_count", 0) >= 1
    )
    manual_collectors = snapshot_gates.get("after_manual_start", {}).get("all_collectors_ready") is True
    manual_collectors_safe = snapshot_gates.get("after_manual_start", {}).get("all_reachable_collectors_external_actions_disabled") is True
    snapshot_identity_safe = bool(snapshot_gates) and all(item.get("passed_identity_and_safety") for item in snapshot_gates.values())

    gates = {
        "all_required_evidence_files_present": not errors,
        "all_snapshots_match_release_and_safety_identity": snapshot_identity_safe,
        "no_default_or_residual_autostart": no_default_startup,
        "runtime_stopped_at_required_lifecycle_points": stopped_when_required,
        "explicit_autostart_opt_in_observed": opt_in_present,
        "manual_launcher_started_all_collectors": manual_collectors,
        "manual_collector_health_external_actions_disabled": manual_collectors_safe,
        "protected_pre_upgrade_state_preserved_after_rollback": state_comparison["preserved"],
        "operator_attestation_complete": attestation_result["operator_evidence_complete"],
        "pilot_commercial_gate_passed": pilot["commercial_gate_passed"],
        "pilot_external_action_boundary_passed": pilot["external_action_boundary_passed"],
    }
    evidence_complete = all(gates.values())
    if not evidence_complete:
        status = "evidence_incomplete" if errors or not attestation_result["operator_evidence_complete"] else "release_blocked"
    elif attestation_result["final_approval_recorded"]:
        status = "release_approved"
    else:
        status = "ready_for_explicit_release_approval"

    return {
        "schema_version": SCHEMA_VERSION,
        "product": "Codistan Sales Automation",
        "release_version": RELEASE_VERSION,
        "generated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "status": status,
        "tested_integration_head": attestation.get("tested_integration_head"),
        "tested_pr255_head": attestation.get("tested_pr255_head"),
        "gates": gates,
        "errors": errors,
        "windows_snapshots": snapshot_gates,
        "protected_state_comparison": state_comparison,
        "operator_attestation": attestation_result,
        "pilot": pilot,
        "release_decision": {
            "mark_pr255_ready_allowed": status == "release_approved",
            "squash_merge_allowed": status == "release_approved",
            "tag_allowed": status == "release_approved",
            "automatic_external_actions_allowed": False,
            "automatic_merge_performed": False,
        },
        "next_actions": _next_actions(status, gates, errors, attestation_result),
    }


def _next_actions(status: str, gates: dict[str, bool], errors: list[str], attestation: dict[str, Any]) -> list[str]:
    if status == "release_approved":
        return [
            "Reconfirm exact-head CI immediately before the explicitly authorized squash merge.",
            "Squash merge PR #255, create the approved tag and verify deployed release identity.",
        ]
    actions: list[str] = []
    for error in errors:
        actions.append(error)
    for gate, passed in gates.items():
        if not passed:
            actions.append(f"Complete or correct release gate: {gate}.")
    if status == "ready_for_explicit_release_approval":
        actions.append("Review the complete evidence package and record explicit final approval on issue #277 for the same exact head.")
        actions.append("Update operator-attestation.json final_approval and rerun this checker.")
    elif not attestation.get("final_approval_recorded"):
        actions.append("Do not approve or merge until every technical, Windows, pilot and commercial gate passes.")
    return list(dict.fromkeys(actions))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Evaluate final Codistan Sales Automation Windows, state, pilot and explicit-approval evidence.")
    default_state = Path(os.environ.get("LOCALAPPDATA", ".")) / "Codistan" / "Acquisition"
    parser.add_argument("--evidence-root", type=Path, required=True)
    parser.add_argument("--state-root", type=Path, default=default_state)
    parser.add_argument("--json", action="store_true", dest="as_json")
    args = parser.parse_args(argv)

    report = build_report(args.evidence_root, args.state_root)
    output_path = args.evidence_root / "sales-automation-release-acceptance.json"
    atomic_write_text(output_path, json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n")

    if args.as_json:
        print(json.dumps(report, indent=2, sort_keys=True))
    else:
        print(f"SALES AUTOMATION RELEASE: {report['status'].upper()}")
        for gate, passed in report["gates"].items():
            print(f"{'PASS' if passed else 'FAIL'}  {gate}")
        for action in report["next_actions"]:
            print(f"NEXT  {action}")
        print(f"Report: {output_path}")

    if report["status"] == "release_approved":
        return 0
    if report["status"] == "ready_for_explicit_release_approval":
        return 2
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
