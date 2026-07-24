from __future__ import annotations

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import tempfile
import threading
import unittest

from acquisition_v4.sync import ProspectDeskSync


class _SyncHandler(BaseHTTPRequestHandler):
    payloads: list[dict] = []
    token = "t" * 40

    def log_message(self, _format: str, *_args) -> None:
        return

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/api/acquisition-ingest":
            self.send_response(404)
            self.end_headers()
            return
        if self.headers.get("Authorization") != f"Bearer {self.token}":
            self.send_response(401)
            self.end_headers()
            return
        length = int(self.headers.get("Content-Length", "0"))
        payload = json.loads(self.rfile.read(length).decode("utf-8"))
        self.payloads.append(payload)
        body = json.dumps({
            "ok": True,
            "created": len(payload.get("records", [])),
            "updated": 0,
            "unchanged": 0,
            "rejected": 0,
        }).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


class ProspectDeskSyncTests(unittest.TestCase):
    def setUp(self) -> None:
        _SyncHandler.payloads = []
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), _SyncHandler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.temp = tempfile.TemporaryDirectory()
        self.state_root = Path(self.temp.name)
        self.records = [self._record("first body")]
        config_dir = self.state_root / "config"
        config_dir.mkdir(parents=True)
        (config_dir / "prospect-desk-sync.json").write_text(json.dumps({
            "version": 1,
            "enabled": True,
            "endpoint": f"http://127.0.0.1:{self.server.server_port}/api/acquisition-ingest",
            "token": _SyncHandler.token,
            "sources": ["linkedin"],
            "interval_seconds": 30,
        }), encoding="utf-8")

    def tearDown(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.temp.cleanup()

    def _record(self, body: str) -> dict:
        return {
            "schema_version": "codistan-opportunity.v4",
            "parser_version": "linkedin-extension-1.3.0",
            "source": "linkedin",
            "source_subtype": "content_search_post",
            "canonical_url": "https://www.linkedin.com/feed/update/urn:li:activity:1234567890123456789",
            "source_native_id": "urn:li:activity:1234567890123456789",
            "dedupe_key": "linkedin-dedupe-1",
            "title": "Looking for a development partner",
            "body": body,
            "author_name": "Buyer Name",
            "author_profile_url": "https://www.linkedin.com/in/buyer",
            "author_headline": "Director at Buyer Company",
            "company_name": "Buyer Company",
            "captured_at": "2026-07-24T12:00:00+00:00",
            "commercial_evidence": {"contact_routes": ["direct_message"]},
            "raw_evidence": {},
            "qualification": {
                "disposition": "priority_b",
                "total_score": 70,
                "confidence": "high",
                "service_route": "software_product",
                "service_lanes": ["software_product"],
                "positive_reasons": ["explicit buyer requirement"],
                "missing_evidence": [],
                "risk_reasons": [],
                "recommended_next_action": "Review and respond manually.",
            },
            "external_action_performed": False,
        }

    def test_syncs_once_then_resends_only_after_enrichment(self) -> None:
        sync = ProspectDeskSync(
            state_root=self.state_root,
            source="linkedin",
            records_provider=lambda: json.loads(json.dumps(self.records)),
        )
        first = sync.run_once_for_test()
        self.assertEqual(1, len(_SyncHandler.payloads))
        self.assertEqual(1, first["last_created"])
        self.assertEqual("", first["last_error"])
        self.assertNotIn(_SyncHandler.token, json.dumps(first))

        sync.run_once_for_test()
        self.assertEqual(1, len(_SyncHandler.payloads))

        self.records[0]["body"] = "first body with richer buyer, scope and response evidence"
        self.records[0]["last_enriched_at"] = "2026-07-24T12:05:00+00:00"
        sync.run_once_for_test()
        self.assertEqual(2, len(_SyncHandler.payloads))
        self.assertIn("richer buyer", _SyncHandler.payloads[-1]["records"][0]["body"])

    def test_reject_records_are_not_synced(self) -> None:
        self.records[0]["qualification"]["disposition"] = "reject"
        sync = ProspectDeskSync(
            state_root=self.state_root,
            source="linkedin",
            records_provider=lambda: self.records,
        )
        status = sync.run_once_for_test()
        self.assertEqual([], _SyncHandler.payloads)
        self.assertEqual(0, status["pending_records"])

    def test_disabled_config_keeps_local_capture_independent(self) -> None:
        config_path = self.state_root / "config" / "prospect-desk-sync.json"
        value = json.loads(config_path.read_text(encoding="utf-8"))
        value["enabled"] = False
        config_path.write_text(json.dumps(value), encoding="utf-8")
        sync = ProspectDeskSync(
            state_root=self.state_root,
            source="linkedin",
            records_provider=lambda: self.records,
        )
        status = sync.run_once_for_test()
        self.assertFalse(status["enabled"])
        self.assertEqual([], _SyncHandler.payloads)


if __name__ == "__main__":
    unittest.main()
