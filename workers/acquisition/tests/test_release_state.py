from __future__ import annotations

import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from acquisition_v4.release_state import (
    compare_snapshots,
    release_diagnostics,
    snapshot_state,
    validate_release_manifest,
    verify_state,
    write_json,
)


class ReleaseStateTests(unittest.TestCase):
    def create_state(self, root: Path) -> None:
        (root / "config").mkdir(parents=True)
        (root / "config/prospect-desk-sync.json").write_text(
            json.dumps(
                {
                    "version": 1,
                    "enabled": True,
                    "endpoint": "https://example.test/api/acquisition-ingest",
                    "token": "secret-token-that-must-never-appear-in-diagnostics",
                    "sources": ["linkedin", "upwork", "sales_navigator"],
                    "interval_seconds": 60,
                }
            ),
            encoding="utf-8",
        )
        for source in ("upwork", "linkedin", "sales_navigator"):
            directory = root / source
            directory.mkdir(parents=True)
            (directory / "records.jsonl").write_text(
                json.dumps(
                    {
                        "id": f"{source}-1",
                        "dedupe_key": f"dedupe-{source}",
                        "description": "A private opportunity body that must not appear in diagnostics.",
                    }
                )
                + "\n",
                encoding="utf-8",
            )
            (directory / "seen.json").write_text(
                json.dumps([f"dedupe-{source}"]),
                encoding="utf-8",
            )
            (directory / "status.json").write_text(
                json.dumps({"ready": True, "last_error": None}),
                encoding="utf-8",
            )
        (root / "logs").mkdir()
        (root / "logs/runtime.log").write_text("runtime details", encoding="utf-8")

    def release_manifest(self, root: Path) -> Path:
        path = root / "RELEASE.json"
        path.write_text(
            json.dumps(
                {
                    "schema_version": "codistan-acquisition-release.v1",
                    "product_name": "Codistan Acquisition",
                    "release_version": "1.0.0-rc.1",
                    "release_status": "live-validation",
                    "components": {
                        "local_runtime_package": "1.0.0-rc.1",
                        "upwork_extension": "1.1.0",
                        "linkedin_sales_navigator_extension": "1.5.0",
                    },
                    "active_sources": [
                        {"id": "upwork", "acceptance_gate": "operator-live-validation-required"},
                        {"id": "linkedin", "acceptance_gate": "operator-live-validation-required"},
                        {"id": "sales_navigator", "acceptance_gate": "operator-live-validation-required"},
                    ],
                    "state_contract": {"protected_files": []},
                    "merge_gate": {"main_update_allowed": False},
                }
            ),
            encoding="utf-8",
        )
        return path

    def test_regenerable_status_and_logs_do_not_break_state_preservation(self) -> None:
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            self.create_state(root)
            before = snapshot_state(root)
            (root / "upwork/status.json").write_text(json.dumps({"ready": False}), encoding="utf-8")
            (root / "logs/runtime.log").write_text("new runtime log", encoding="utf-8")
            after = snapshot_state(root)
            comparison = compare_snapshots(before, after)
            self.assertTrue(comparison.preserved)
            self.assertEqual(comparison.changed, ())

    def test_record_or_dedupe_change_fails_preservation(self) -> None:
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            self.create_state(root)
            before = snapshot_state(root)
            with (root / "linkedin/records.jsonl").open("a", encoding="utf-8") as handle:
                handle.write(json.dumps({"id": "linkedin-2", "dedupe_key": "dedupe-linkedin-2"}) + "\n")
            (root / "sales_navigator/seen.json").write_text(json.dumps([]), encoding="utf-8")
            comparison = compare_snapshots(before, snapshot_state(root))
            self.assertFalse(comparison.preserved)
            self.assertIn("linkedin/records.jsonl", comparison.changed)
            self.assertIn("sales_navigator/seen.json", comparison.changed)

    def test_missing_protected_file_fails_preservation(self) -> None:
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            self.create_state(root)
            before_path = root / "before.json"
            write_json(before_path, snapshot_state(root))
            (root / "upwork/seen.json").unlink()
            result = verify_state(before_path, root)
            self.assertFalse(result["comparison"]["preserved"])
            self.assertIn("upwork/seen.json", result["comparison"]["missing_after"])

    def test_diagnostics_are_redacted_and_include_counts_and_versions(self) -> None:
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            self.create_state(root)
            manifest = self.release_manifest(root)
            diagnostics = release_diagnostics(root, manifest)
            serialized = json.dumps(diagnostics)
            self.assertNotIn("secret-token", serialized)
            self.assertNotIn("private opportunity body", serialized.lower())
            self.assertNotIn("https://example.test", serialized)
            self.assertEqual(diagnostics["release"]["release_version"], "1.0.0-rc.1")
            self.assertEqual(diagnostics["state"]["sources"]["upwork"]["record_count"], 1)
            self.assertTrue(diagnostics["state"]["sync_configuration"]["token_configured"])
            self.assertFalse(diagnostics["privacy"]["credentials_included"])

    def test_live_validation_manifest_cannot_allow_main_update(self) -> None:
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            manifest_path = self.release_manifest(root)
            value = json.loads(manifest_path.read_text(encoding="utf-8"))
            validate_release_manifest(value)
            value["merge_gate"]["main_update_allowed"] = True
            with self.assertRaisesRegex(ValueError, "must not allow a main update"):
                validate_release_manifest(value)

    def test_manifest_requires_exactly_three_active_sources(self) -> None:
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            manifest_path = self.release_manifest(root)
            value = json.loads(manifest_path.read_text(encoding="utf-8"))
            value["active_sources"] = value["active_sources"][:2]
            with self.assertRaisesRegex(ValueError, "exactly the three active acquisition sources"):
                validate_release_manifest(value)


if __name__ == "__main__":
    unittest.main()
