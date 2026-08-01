from __future__ import annotations

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import tempfile
import threading
import unittest

from acquisition_v4.sync import MAX_RETRY_ATTEMPTS, ProspectDeskSync


class _SyncHandler(BaseHTTPRequestHandler):
    payloads: list[dict] = []
    token = "t" * 40
    failures_remaining = 0
    mixed_failure_keys: set[str] = set()

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
        type(self).payloads.append(payload)
        if type(self).failures_remaining > 0:
            type(self).failures_remaining -= 1
            self.send_response(503)
            self.end_headers()
            return

        reconciliation = []
        applied = 0
        failed = 0
        for index, record in enumerate(payload.get("records", [])):
            key = str(record.get("idempotency_key", ""))
            if key in type(self).mixed_failure_keys:
                type(self).mixed_failure_keys.remove(key)
                failed += 1
                reconciliation.append({
                    "index": index,
                    "idempotencyKey": key,
                    "status": "failed",
                    "outcome": "rejected",
                    "reason": "Synthetic partial failure; safe replay required.",
                })
            else:
                applied += 1
                reconciliation.append({
                    "index": index,
                    "idempotencyKey": key,
                    "status": "applied",
                    "outcome": "created",
                    "reason": "Applied idempotently.",
                })
        body = json.dumps({
            "ok": True,
            "created": applied,
            "updated": 0,
            "unchanged": 0,
            "rejected": failed,
            "reconciliation": {
                "version": "acquisition-reconciliation.v1",
                "records": reconciliation,
            },
        }).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


class ProspectDeskSyncTests(unittest.TestCase):
    def setUp(self) -> None:
        _SyncHandler.payloads = []
        _SyncHandler.failures_remaining = 0
        _SyncHandler.mixed_failure_keys = set()
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), _SyncHandler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.temp = tempfile.TemporaryDirectory()
        self.state_root = Path(self.temp.name)
        config_dir = self.state_root / "config"
        config_dir.mkdir(parents=True)
        (config_dir / "prospect-desk-sync.json").write_text(json.dumps({
            "version": 1,
            "enabled": True,
            "endpoint": f"http://127.0.0.1:{self.server.server_port}/api/acquisition-ingest",
            "token": _SyncHandler.token,
            "sources": ["linkedin", "upwork", "sales_navigator"],
            "interval_seconds": 30,
        }), encoding="utf-8")

    def tearDown(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.temp.cleanup()

    @staticmethod
    def _linkedin_record(body: str = "We are looking for a development partner for an active software platform project.") -> dict:
        return {
            "schema_version": "codistan-opportunity.v4",
            "parser_version": "linkedin-extension-1.3.0",
            "source": "linkedin",
            "source_subtype": "content_search_post",
            "canonical_url": "https://www.linkedin.com/feed/update/urn:li:activity:1234567890123456789?utm_source=test",
            "source_native_id": "urn:li:activity:1234567890123456789",
            "dedupe_key": "linkedin-dedupe-1",
            "title": "Looking for a development partner",
            "body": body,
            "author_name": "Buyer Name",
            "author_profile_url": "https://www.linkedin.com/in/buyer",
            "company_name": "Buyer Company",
            "captured_at": "2026-07-24T12:00:00+00:00",
            "commercial_evidence": {"contact_routes": ["direct_message"]},
            "raw_evidence": {"visible_post": True},
            "qualification": {
                "disposition": "priority_b",
                "total_score": 70,
                "confidence": "high",
                "service_route": "software_product",
                "positive_reasons": ["explicit buyer requirement"],
                "recommended_next_action": "Review and respond manually.",
            },
            "external_action_performed": False,
        }

    @staticmethod
    def _upwork_record(body: str = "Build a production SaaS application with Node.js, React and API integrations.") -> dict:
        return {
            "schema_version": "codistan-opportunity.v4",
            "parser_version": "upwork-extension-1.0.2",
            "source": "upwork",
            "source_subtype": "approved_saved_search_job",
            "canonical_url": "https://www.upwork.com/jobs/~0123456789abcdef?utm_campaign=test",
            "source_native_id": "~0123456789abcdef",
            "dedupe_key": "upwork-dedupe-1",
            "title": "Full-stack SaaS implementation partner",
            "body": body,
            "captured_at": "2026-07-24T12:00:00+00:00",
            "commercial_evidence": {"fixed_budget_usd": 8000, "payment_verified": True},
            "raw_evidence": {"skills": ["Node.js", "React", "SaaS"]},
            "qualification": {
                "disposition": "priority_a",
                "total_score": 86,
                "confidence": "high",
                "service_route": "software_product",
                "positive_reasons": ["strong fixed-price commercial value"],
                "recommended_next_action": "Review and submit manually.",
            },
            "external_action_performed": False,
        }

    @staticmethod
    def _sales_navigator_record(body: str = "Cold account and person evidence for a managed delivery partnership hypothesis.") -> dict:
        return {
            "schema_version": "codistan-opportunity.v4",
            "parser_version": "linkedin-extension-1.4.1",
            "source": "sales_navigator",
            "source_subtype": "licensed_sales_navigator_lead",
            "canonical_url": "https://www.linkedin.com/sales/lead/ACwAA-test,NAME_SEARCH",
            "source_native_id": "ACwAA-test",
            "dedupe_key": "salesnav-dedupe-1",
            "title": "Delivery director at example agency",
            "body": body,
            "author_name": "Cold Prospect",
            "company_name": "Example Agency",
            "captured_at": "2026-07-24T12:00:00+00:00",
            "commercial_evidence": {"campaign_id": "software_ai_overflow_partners"},
            "raw_evidence": {"relationship": "2nd"},
            "qualification": {
                "disposition": "priority_b",
                "total_score": 74,
                "confidence": "medium",
                "service_route": "delivery_partner",
                "campaign_id": "software_ai_overflow_partners",
                "campaign_name": "Software and AI Agencies — Overflow Delivery Partners",
                "offer_name": "Managed Software and AI Delivery Partnership",
                "positive_reasons": ["account and role fit"],
                "risk_reasons": ["no confirmed buying intent"],
            },
            "external_action_performed": False,
        }

    def _sync(self, source: str, records: list[dict]) -> ProspectDeskSync:
        return ProspectDeskSync(
            state_root=self.state_root,
            source=source,
            records_provider=lambda: json.loads(json.dumps(records)),
        )

    def test_each_source_syncs_once_and_uses_deterministic_idempotency(self) -> None:
        fixtures = {
            "linkedin": [self._linkedin_record()],
            "upwork": [self._upwork_record()],
            "sales_navigator": [self._sales_navigator_record()],
        }
        first_keys: dict[str, str] = {}
        for source, records in fixtures.items():
            sync = self._sync(source, records)
            status = sync.run_once_for_test()
            payload = _SyncHandler.payloads[-1]
            key = payload["records"][0]["idempotency_key"]
            self.assertTrue(key.startswith(f"sync-{source}-"))
            first_keys[source] = key
            self.assertEqual(0, status["pending_records"])
            self.assertEqual(False, payload["external_action_performed"])
            sync.run_once_for_test()
            self.assertEqual(1, len([item for item in _SyncHandler.payloads if item["source"] == source]))

        restarted = self._sync("linkedin", fixtures["linkedin"])
        restarted.run_once_for_test()
        self.assertEqual(1, len([item for item in _SyncHandler.payloads if item["source"] == "linkedin"]))
        reconciliation = self.state_root / "sync" / "reconciliation" / "linkedin.jsonl"
        self.assertTrue(reconciliation.exists())
        self.assertIn(first_keys["linkedin"], reconciliation.read_text(encoding="utf-8"))

    def test_outbox_survives_restart_and_retry_converges(self) -> None:
        records = [self._upwork_record()]
        _SyncHandler.failures_remaining = 1
        first = self._sync("upwork", records)
        status = first.run_once_for_test()
        self.assertEqual(1, status["retrying_records"])
        outbox_path = self.state_root / "sync" / "outbox" / "upwork.json"
        self.assertTrue(outbox_path.exists())
        saved = json.loads(outbox_path.read_text(encoding="utf-8"))
        self.assertEqual(1, len(saved["entries"]))

        restarted = self._sync("upwork", records)
        status = restarted.run_once_for_test()
        self.assertEqual(0, status["pending_records"])
        saved = json.loads(outbox_path.read_text(encoding="utf-8"))
        self.assertEqual({}, saved["entries"])
        self.assertEqual(2, len(_SyncHandler.payloads))

        restarted.run_once_for_test()
        self.assertEqual(2, len(_SyncHandler.payloads), "terminal fingerprint prevents another replay")

    def test_partial_failure_replays_only_failed_record(self) -> None:
        first = self._linkedin_record()
        second = self._linkedin_record("A separate visible buyer requirement with enough detail for safe qualification.")
        second["dedupe_key"] = "linkedin-dedupe-2"
        second["canonical_url"] = "https://www.linkedin.com/feed/update/urn:li:activity:2234567890123456789"
        records = [first, second]
        sync = self._sync("linkedin", records)

        # Discover deterministic keys without completing the batch.
        _SyncHandler.failures_remaining = 1
        sync.run_once_for_test()
        first_payload = _SyncHandler.payloads[-1]
        failed_key = first_payload["records"][1]["idempotency_key"]
        _SyncHandler.mixed_failure_keys = {failed_key}

        sync.run_once_for_test()
        self.assertEqual(2, len(_SyncHandler.payloads[-1]["records"]))
        status = sync.health()
        self.assertEqual(1, status["retrying_records"])

        sync.run_once_for_test()
        self.assertEqual(1, len(_SyncHandler.payloads[-1]["records"]), "only failed entry should be replayed")
        self.assertEqual(failed_key, _SyncHandler.payloads[-1]["records"][0]["idempotency_key"])
        self.assertEqual(0, sync.health()["pending_records"])

    def test_bounded_failures_move_record_to_dead_letter(self) -> None:
        records = [self._sales_navigator_record()]
        _SyncHandler.failures_remaining = MAX_RETRY_ATTEMPTS
        sync = self._sync("sales_navigator", records)
        for _ in range(MAX_RETRY_ATTEMPTS):
            sync.run_once_for_test()
        status = sync.health()
        self.assertEqual(1, status["dead_letter_records"])
        self.assertEqual(0, status["pending_records"])
        outbox = json.loads((self.state_root / "sync" / "outbox" / "sales_navigator.json").read_text(encoding="utf-8"))
        entry = next(iter(outbox["entries"].values()))
        self.assertEqual("dead_letter", entry["status"])
        self.assertEqual(MAX_RETRY_ATTEMPTS, entry["attempts"])
        self.assertIn("record", entry, "source evidence remains available for reconciliation")

    def test_enrichment_queues_new_fingerprint_without_duplicate_active_record(self) -> None:
        records = [self._upwork_record()]
        sync = self._sync("upwork", records)
        sync.run_once_for_test()
        original_key = _SyncHandler.payloads[-1]["records"][0]["idempotency_key"]
        records[0]["commercial_evidence"]["fixed_budget_usd"] = 12000
        records[0]["last_enriched_at"] = "2026-07-24T12:10:00+00:00"
        sync.run_once_for_test()
        self.assertEqual(2, len(_SyncHandler.payloads))
        self.assertEqual(original_key, _SyncHandler.payloads[-1]["records"][0]["idempotency_key"])
        self.assertEqual(12000, _SyncHandler.payloads[-1]["records"][0]["commercial_evidence"]["fixed_budget_usd"])

    def test_rejected_records_and_disabled_config_never_leave_local_state(self) -> None:
        for source, record in (
            ("linkedin", self._linkedin_record()),
            ("upwork", self._upwork_record()),
            ("sales_navigator", self._sales_navigator_record()),
        ):
            record["qualification"]["disposition"] = "reject"
            status = self._sync(source, [record]).run_once_for_test()
            self.assertEqual(0, status["pending_records"])
        self.assertEqual([], _SyncHandler.payloads)

        config_path = self.state_root / "config" / "prospect-desk-sync.json"
        value = json.loads(config_path.read_text(encoding="utf-8"))
        value["enabled"] = False
        config_path.write_text(json.dumps(value), encoding="utf-8")
        status = self._sync("linkedin", [self._linkedin_record()]).run_once_for_test()
        self.assertFalse(status["enabled"])
        self.assertEqual([], _SyncHandler.payloads)


if __name__ == "__main__":
    unittest.main()
