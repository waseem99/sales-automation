from __future__ import annotations

import json
from pathlib import Path
import tempfile
import unittest

from acquisition_v4.release_acceptance import REQUIRED_PHASES, build_report


class ReleaseAcceptanceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.evidence = self.root / "evidence"
        self.state = self.root / "state"
        self.evidence.mkdir()
        (self.state / "review").mkdir(parents=True)
        self.baseline_file = {
            "relative_path": "upwork/records.jsonl",
            "sha256": "a" * 64,
            "bytes": 100,
            "last_write_utc": "2026-07-31T10:00:00Z",
        }
        for phase in REQUIRED_PHASES:
            self._write_snapshot(phase)
        (self.state / "review" / "sales-automation-pilot-acceptance.json").write_text(json.dumps({
            "schema_version": "codistan-sales-automation-acceptance.v1",
            "status": "commercial_gate_passed",
            "release_decision": {
                "merge_allowed": True,
                "automatic_external_actions_allowed": False,
            },
        }), encoding="utf-8")
        self._write_attestation(final_approved=False)

    def tearDown(self) -> None:
        self.temp.cleanup()

    def _write_snapshot(self, phase: str) -> None:
        startup_count = 1 if phase in {"after_autostart_opt_in", "after_opt_in_restart"} else 0
        process_count = 1 if phase in {"after_manual_start", "after_opt_in_restart"} else 0
        startup_entries = [{"name": "Codistan Sales Automation.lnk"}] if startup_count else []
        snapshot = {
            "schema_version": "codistan-sales-automation-windows-evidence.v1",
            "phase": phase,
            "release_identity": {
                "release_version": "1.0.0-rc.2",
                "linkedin_sales_navigator_extension": "1.6.1",
                "linkedin_manifest_version": "1.6.1",
                "upwork_extension": "1.1.1",
                "upwork_manifest_version": "1.1.1",
                "external_actions_enabled": False,
            },
            "protected_state_manifest": [self.baseline_file],
            "startup": {
                "startup_folder_entries": startup_entries,
                "run_key_entries": [],
                "startup_approved_entries": [],
                "scheduled_tasks": [],
            },
            "runtime": {
                "managed_processes": [{"process_id": 1}] if process_count else [],
                "all_collectors_ready": phase == "after_manual_start",
                "all_external_actions_disabled": True,
            },
            "safety": {
                "state_root_preserved": True,
                "capture_is_read_only": True,
                "external_action_performed": False,
            },
        }
        (self.evidence / f"{phase}.json").write_text(json.dumps(snapshot), encoding="utf-8")

    def _write_attestation(self, final_approved: bool) -> None:
        attestation = {
            "schema_version": "codistan-sales-automation-release-attestation.v1",
            "release_version": "1.0.0-rc.2",
            "tested_integration_head": "1" * 40,
            "tested_pr255_head": "2" * 40,
            "operator": "operator@codistan.org",
            "reviewer": "reviewer@codistan.org",
            "recorded_at": "2026-07-31T15:00:00Z",
            "windows_results": {
                "clean_install_no_default_autostart": True,
                "clean_install_runtime_stopped": True,
                "supported_upgrade_removed_legacy_autostart": True,
                "restart_remained_manual_start_only": True,
                "manual_launcher_started_all_three_collectors": True,
                "all_health_endpoints_external_actions_disabled": True,
                "explicit_autostart_opt_in_worked": True,
                "cleanup_command_idempotent": True,
                "stop_command_idempotent": True,
                "rollback_restored_previous_application": True,
                "rollback_left_runtime_stopped": True,
                "protected_state_preserved": True,
            },
            "pilot_results": {
                "upwork_real_authorized_pilot_completed": True,
                "linkedin_warm_real_authorized_pilot_completed": True,
                "licensed_sales_navigator_pilot_completed": True,
                "repeated_sync_no_duplicate_active_opportunities": True,
                "seller_owned_fields_and_history_preserved": True,
                "cold_no_confirmed_intent_preserved": True,
                "pending_retry_dead_letter_records_locatable": True,
                "human_commercial_review_completed": True,
                "zero_automatic_external_actions_observed": True,
            },
            "evidence_references": ["before_install.json", "sales-automation-pilot-acceptance.json"],
            "final_approval": {
                "approved": final_approved,
                "approved_by": "release-owner@codistan.org" if final_approved else "",
                "approved_at": "2026-07-31T16:00:00Z" if final_approved else "",
                "approved_in_issue_comment_url": "https://github.com/waseem99/sales-automation/issues/277#issuecomment-test" if final_approved else "",
                "exact_head_confirmed": final_approved,
            },
        }
        (self.evidence / "operator-attestation.json").write_text(json.dumps(attestation), encoding="utf-8")

    def test_ready_requires_separate_final_approval(self) -> None:
        report = build_report(self.evidence, self.state)
        self.assertEqual(report["status"], "ready_for_explicit_release_approval")
        self.assertTrue(all(report["gates"].values()))
        self.assertFalse(report["release_decision"]["squash_merge_allowed"])
        self.assertFalse(report["release_decision"]["automatic_external_actions_allowed"])
        self.assertFalse(report["release_decision"]["automatic_merge_performed"])

    def test_explicit_exact_head_approval_unlocks_release_only(self) -> None:
        self._write_attestation(final_approved=True)
        report = build_report(self.evidence, self.state)
        self.assertEqual(report["status"], "release_approved")
        self.assertTrue(report["release_decision"]["squash_merge_allowed"])
        self.assertFalse(report["release_decision"]["automatic_merge_performed"])

    def test_state_loss_blocks_release(self) -> None:
        rollback_path = self.evidence / "after_rollback.json"
        rollback = json.loads(rollback_path.read_text(encoding="utf-8"))
        rollback["protected_state_manifest"] = []
        rollback_path.write_text(json.dumps(rollback), encoding="utf-8")
        report = build_report(self.evidence, self.state)
        self.assertEqual(report["status"], "release_blocked")
        self.assertFalse(report["gates"]["protected_pre_upgrade_state_preserved_after_rollback"])
        self.assertEqual(report["protected_state_comparison"]["missing_files"], ["upwork/records.jsonl"])

    def test_missing_evidence_is_incomplete(self) -> None:
        (self.evidence / "after_upgrade.json").unlink()
        report = build_report(self.evidence, self.state)
        self.assertEqual(report["status"], "evidence_incomplete")
        self.assertFalse(report["gates"]["all_required_evidence_files_present"])


if __name__ == "__main__":
    unittest.main()
