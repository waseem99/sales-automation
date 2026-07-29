from __future__ import annotations

import json
from pathlib import Path
import tempfile
import unittest

from acquisition_v4.sales_automation_acceptance import build_report
from acquisition_v4.storage import AtomicRecordStore, atomic_write_text


class SalesAutomationAcceptanceTests(unittest.TestCase):
    def _record(self, source: str, index: int, *, external_action: bool = False) -> dict[str, object]:
        if source == "upwork":
            canonical = f"https://www.upwork.com/jobs/~01{index:08d}"
            commercial = {"buyer_verified": True, "budget": "$1,000"}
            headline = ""
            company = ""
            risks: list[str] = []
        elif source == "linkedin":
            canonical = f"https://www.linkedin.com/posts/buyer-{index}"
            commercial = {"buyer_authored": True}
            headline = "CTO at Example"
            company = "Example"
            risks = []
        else:
            canonical = f"https://www.linkedin.com/in/prospect-{index}/"
            commercial = {
                "campaign_id": "software_ai_overflow_partners",
                "campaign_name": "Software and AI Agencies — Overflow Delivery Partners",
                "offer_name": "Managed Software and AI Delivery Partnership",
            }
            headline = "Founder and Head of Delivery"
            company = f"Agency {index}"
            risks = ["No explicit buying intent has been established; this is a cold prospect."]
        return {
            "source": source,
            "canonical_url": canonical,
            "source_native_id": f"{source}-{index}",
            "dedupe_key": f"{source}-dedupe-{index}",
            "title": f"Prospect {index}",
            "body": "Visible evidence with enough detail to support human qualification and review.",
            "author_profile_url": canonical if source != "upwork" else "",
            "author_headline": headline,
            "company_name": company,
            "commercial_evidence": commercial,
            "qualification": {
                "disposition": "priority_a" if index % 2 == 0 else "priority_b",
                "risk_reasons": risks,
            },
            "raw_evidence": {"external_action_performed": external_action},
            "external_action_performed": external_action,
        }

    def _state(self, root: Path) -> None:
        counts = {"upwork": 100, "linkedin": 50, "sales_navigator": 75}
        for source, count in counts.items():
            store = AtomicRecordStore(root, source)
            store.persist_records([self._record(source, index) for index in range(count)])

    def _reviews(self, root: Path, accepted: int = 9) -> None:
        reviews = []
        identities = [
            *(f"upwork-dedupe-{index}" for index in range(5)),
            *(f"linkedin-dedupe-{index}" for index in range(5)),
            *(f"sales_navigator-dedupe-{index}" for index in range(5)),
        ]
        for index, identity in enumerate(identities):
            reviews.append({
                "dedupe_key": identity,
                "accepted_for_pursuit": index < accepted,
                "reviewer": "bd-reviewer@codistan.org",
                "reviewed_at": "2026-07-27T08:00:00.000Z",
                "notes": "Commercial relevance reviewed manually.",
            })
        atomic_write_text(
            root / "review" / "commercial-review.json",
            json.dumps({
                "schema_version": "codistan-sales-automation-commercial-review.v1",
                "reviews": reviews,
            }, indent=2) + "\n",
        )

    def test_technical_gate_waits_for_human_review(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            self._state(root)
            report = build_report(root)
            self.assertEqual(report["schema_version"], "codistan-sales-automation-acceptance.v1")
            self.assertEqual(report["product"], "Codistan Sales Automation")
            self.assertEqual(report["application"], "Prospect Desk")
            self.assertEqual(report["status"], "ready_for_human_commercial_review")
            self.assertTrue(all(item["status"] == "technical_gate_passed" for item in report["sources"].values()))
            self.assertFalse(report["release_decision"]["merge_allowed"])

    def test_commercial_gate_requires_sixty_percent_and_all_sources(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            self._state(root)
            self._reviews(root, accepted=9)
            report = build_report(root)
            self.assertEqual(report["status"], "commercial_gate_passed")
            self.assertEqual(report["human_commercial_review"]["acceptance_ratio"], 0.6)
            self.assertTrue(report["release_decision"]["merge_allowed"])
            self.assertFalse(report["release_decision"]["automatic_external_actions_allowed"])

    def test_external_action_evidence_blocks_release(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            self._state(root)
            store = AtomicRecordStore(root, "upwork")
            records = store.load_records()
            records[0] = self._record("upwork", 0, external_action=True)
            store.persist_records(records)
            self._reviews(root, accepted=15)
            report = build_report(root)
            self.assertEqual(report["status"], "blocked_external_action_evidence")
            self.assertFalse(report["release_decision"]["merge_allowed"])


if __name__ == "__main__":
    unittest.main()
