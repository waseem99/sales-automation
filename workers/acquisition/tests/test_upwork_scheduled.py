from __future__ import annotations

import json
from pathlib import Path
import tempfile
import unittest

from acquisition.upwork_stability_guard import _same_saved_search
from acquisition.upwork_scheduled_runtime import (
    _recover_title,
    _visible_state,
    load_automation_settings,
)
from acquisition import upwork_scheduled as scheduled


class _FakeLocator:
    def __init__(self, body: str = "", count: int = 0) -> None:
        self._body = body
        self._count = count

    def inner_text(self, timeout: int = 0) -> str:
        del timeout
        return self._body

    def count(self) -> int:
        return self._count


class _FakePage:
    def __init__(self, url: str, body: str, title: str = "Upwork") -> None:
        self.url = url
        self._body = body
        self._title = title

    def is_closed(self) -> bool:
        return False

    def title(self) -> str:
        return self._title

    def locator(self, selector: str) -> _FakeLocator:
        if selector == "body":
            return _FakeLocator(self._body)
        return _FakeLocator(count=0)


class ScheduledUpworkTests(unittest.TestCase):
    def test_loads_and_clamps_automation_settings(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "automation.toml"
            path.write_text(
                """
[pilot]
version = "test"
max_jobs_total = 25
min_description_chars = 80

[automation]
version = "scheduled-test"
navigation_wait_seconds = 1
challenge_wait_seconds = 99999
challenge_poll_seconds = 1
max_runtime_minutes = 5
max_detail_enrichments = 99
detail_wait_seconds = 2
installed_browser_only = true
retention_days = 2

[[searches]]
id = "ai-automation"
enabled = true
url = "https://www.upwork.com/nx/search/jobs/?q=ai"
max_jobs = 5
delay_seconds = 15
""",
                encoding="utf-8",
            )
            value = load_automation_settings(path)
        self.assertEqual(value.version, "scheduled-test")
        self.assertEqual(value.navigation_wait_seconds, 8)
        self.assertEqual(value.challenge_wait_seconds, 3600)
        self.assertEqual(value.challenge_poll_seconds, 5)
        self.assertEqual(value.max_runtime_minutes, 10)
        self.assertEqual(value.max_detail_enrichments, 25)
        self.assertEqual(value.detail_wait_seconds, 8)
        self.assertEqual(value.retention_days, 7)
        self.assertTrue(value.installed_browser_only)

    def test_production_stability_config_disables_detail_tabs(self) -> None:
        path = Path(__file__).resolve().parents[1] / "config" / "upwork-automation.toml"
        value = load_automation_settings(path)
        self.assertEqual(value.version, "upwork-stability.v3")
        self.assertEqual(value.max_detail_enrichments, 0)

    def test_card_evidence_parses_visible_commercial_signals(self) -> None:
        evidence = scheduled._card_evidence(
            {
                "source_url": "https://www.upwork.com/jobs/AI-Agent_~022077770760696635841/",
                "title": "AI Voice Agent for SaaS Product",
                "description": (
                    "Build a production AI voice agent for our SaaS product with website knowledge, "
                    "customer support workflows, integrations, analytics and a long-term enhancement roadmap."
                ),
                "card_text": (
                    "Posted 20 minutes ago Proposals: 5 to 10 Fixed-price Expert "
                    "Est. Budget: $8,000 Payment verified $50K+ spent United States "
                    "AI Voice Agent for SaaS Product"
                ),
                "skills": ["AI Agent Development", "Voice AI"],
            },
            segment="ai-automation",
        )
        self.assertEqual(evidence.attributes["budget_usd"], 8000)
        self.assertEqual(evidence.attributes["client_spend_usd"], 50000)
        self.assertEqual(evidence.attributes["payment_status"], "verified")
        self.assertEqual(evidence.attributes["proposal_activity"], "5 to 10")
        self.assertEqual(evidence.source_id, "~022077770760696635841")

    def test_pending_queue_deduplicates_by_idempotency_key(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "pending.jsonl"
            payload = {"idempotency_key": "abc", "qualification": {"priority": "A"}}
            scheduled._append_pending(path, [payload, payload])
            scheduled._append_pending(path, [payload])
            values = scheduled._read_jsonl(path)
        self.assertEqual(len(values), 1)
        self.assertEqual(values[0]["idempotency_key"], "abc")

    def test_blank_page_is_not_misclassified_as_human_verification(self) -> None:
        blank = _FakePage(
            "https://www.upwork.com/nx/find-work/9652877",
            "",
        )
        state, reason = _visible_state(blank)
        self.assertEqual(state, "blank")
        self.assertIn("blank", reason.casefold())

    def test_detects_normal_page_and_explicit_security_challenge(self) -> None:
        ready = _FakePage(
            "https://www.upwork.com/nx/search/jobs/",
            "Find work Best Matches Recent jobs My feed and saved searches",
        )
        state, _reason = _visible_state(ready)
        self.assertEqual(state, "ready")

        challenge = _FakePage(
            "https://www.upwork.com/nx/search/jobs/",
            "Verify you are human. Performing security verification.",
            title="Just a moment",
        )
        state, reason = _visible_state(challenge)
        self.assertEqual(state, "verification")
        self.assertIn("Security", reason)

    def test_saved_search_guard_rejects_previous_search_page(self) -> None:
        self.assertTrue(_same_saved_search(
            "https://www.upwork.com/nx/find-work/9652877/",
            "https://www.upwork.com/nx/find-work/9652877",
        ))
        self.assertFalse(_same_saved_search(
            "https://www.upwork.com/nx/find-work/9652811",
            "https://www.upwork.com/nx/find-work/9652877",
        ))

    def test_recovers_job_title_from_url_instead_of_neighbouring_card(self) -> None:
        value = _recover_title(
            "Website Copy and Content for a Law Firm",
            "A private AI operating system for litigation documents and drafting.",
            "https://www.upwork.com/jobs/Lead-Engineer-Solutions-Architect-Build-Private-Native-Legal-Operating-System_~022077485423388552826/",
        )
        self.assertEqual(
            value,
            "Lead Engineer Solutions Architect Build Private Native Legal Operating System",
        )

    def test_status_json_contains_no_credentials(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "status.json"
            result = scheduled.ScheduledRunResult(
                run_id="test",
                status="completed",
                started_at="2026-07-16T00:00:00Z",
                completed_at="2026-07-16T00:10:00Z",
                output_directory="C:/safe/output",
                searches_completed=3,
                links_found=25,
                reviewed=20,
                extracted=18,
                duplicates=5,
                failed=0,
                priority_a_count=2,
                priority_b_count=5,
                priority_c_count=11,
                detail_enrichments=0,
                ingested=7,
                ingestion_pending=0,
                dashboard_ingestion_enabled=True,
                human_action_required=False,
                message="Completed",
            )
            scheduled._write_status(path, result)
            rendered = path.read_text(encoding="utf-8")
            value = json.loads(rendered)
        self.assertEqual(value["priority_a_count"], 2)
        self.assertNotIn("token", rendered.casefold())
        self.assertNotIn("authorization", rendered.casefold())


if __name__ == "__main__":
    unittest.main()
