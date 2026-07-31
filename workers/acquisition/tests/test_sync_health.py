from __future__ import annotations

import json
from pathlib import Path
import tempfile
import unittest

from acquisition_v4.sync_health import collect_sync_health, prepare_safe_replay, redact_diagnostic


class SyncHealthTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        (self.root / "config").mkdir(parents=True)
        (self.root / "sync" / "outbox").mkdir(parents=True)
        (self.root / "sync" / "reconciliation").mkdir(parents=True)
        (self.root / "config" / "prospect-desk-sync.json").write_text(json.dumps({
            "enabled": True,
            "endpoint": "https://sales.example.com/api/acquisition-ingest?token=secret",
            "token": "x" * 40,
            "sources": ["linkedin"],
        }), encoding="utf-8")
        (self.root / "sync" / "outbox" / "linkedin.json").write_text(json.dumps({
            "version": 1,
            "source": "linkedin",
            "entries": {
                "sync-linkedin-a": {
                    "idempotency_key": "sync-linkedin-a",
                    "dedupe_key": "person-a",
                    "record": {"private_message": "must never appear", "title": "source evidence"},
                    "status": "dead_letter",
                    "attempts": 5,
                    "created_at": "2026-07-31T10:00:00+00:00",
                    "updated_at": "2026-07-31T10:00:02+00:00",
                    "next_attempt_at": "",
                    "last_error": "Authorization: Bearer private-token",
                },
                "sync-linkedin-conflict": {
                    "idempotency_key": "sync-linkedin-conflict",
                    "dedupe_key": "person-b",
                    "record": {"title": "conflicted evidence"},
                    "status": "conflicted",
                    "attempts": 1,
                    "created_at": "2026-07-31T10:00:00+00:00",
                    "updated_at": "2026-07-31T10:00:03+00:00",
                    "last_error": "seller field conflict",
                },
            },
            "external_action_automated": False,
        }), encoding="utf-8")
        (self.root / "sync" / "reconciliation" / "linkedin.jsonl").write_text(
            json.dumps({
                "version": "acquisition-reconciliation.v1",
                "occurred_at": "2026-07-31T10:00:05+00:00",
                "source": "linkedin",
                "idempotency_key": "sync-linkedin-a",
                "status": "failed",
                "reason": "Bearer private-token transport failure",
                "external_action_automated": False,
            }) + "\n",
            encoding="utf-8",
        )

    def tearDown(self) -> None:
        self.temp.cleanup()

    def test_health_is_redacted_and_locates_records(self) -> None:
        report = collect_sync_health(self.root, "linkedin", collected_at="2026-07-31T10:01:00+00:00")
        encoded = json.dumps(report)
        self.assertEqual(report["deadLetter"], 1)
        self.assertEqual(report["conflicted"], 1)
        self.assertEqual(report["averageLatencyMs"], 2500)
        self.assertEqual(report["endpointPath"], "/api/acquisition-ingest")
        self.assertNotIn("private-token", encoded)
        self.assertNotIn("must never appear", encoded)
        self.assertNotIn("source evidence", encoded)
        self.assertEqual(report["externalActionAutomated"], False)
        self.assertEqual(report["stateRootPreserved"], True)

    def test_replay_requires_permission_and_preserves_key(self) -> None:
        with self.assertRaises(PermissionError):
            prepare_safe_replay(
                self.root,
                "linkedin",
                ["sync-linkedin-a"],
                actor="operator@codistan.org",
                permission_confirmed=False,
            )
        result = prepare_safe_replay(
            self.root,
            "linkedin",
            ["sync-linkedin-a", "sync-linkedin-conflict", "missing"],
            actor="operator@codistan.org",
            permission_confirmed=True,
            requested_at="2026-07-31T10:02:00+00:00",
        )
        self.assertEqual(result["replayed"], ["sync-linkedin-a"])
        self.assertEqual(len(result["skipped"]), 2)
        outbox = json.loads((self.root / "sync" / "outbox" / "linkedin.json").read_text(encoding="utf-8"))
        item = outbox["entries"]["sync-linkedin-a"]
        self.assertEqual(item["idempotency_key"], "sync-linkedin-a")
        self.assertEqual(item["status"], "pending")
        self.assertEqual(item["record"]["title"], "source evidence")
        self.assertEqual(outbox["external_action_automated"], False)

    def test_redaction(self) -> None:
        redacted = redact_diagnostic({"cookie": "secret", "authorization": "Bearer abc", "error": "safe"})
        self.assertNotIn("secret", redacted)
        self.assertNotIn("Bearer abc", redacted)
        self.assertIn("safe", redacted)


if __name__ == "__main__":
    unittest.main()
