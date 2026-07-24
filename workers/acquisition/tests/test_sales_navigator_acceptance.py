from __future__ import annotations

import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from acquisition_v4.sales_navigator_acceptance import build_report


class SalesNavigatorAcceptanceTests(unittest.TestCase):
    def test_complete_pilot_requires_quality_and_safety_evidence(self) -> None:
        with TemporaryDirectory() as directory:
            state_root = Path(directory)
            records_path = state_root / "sales_navigator" / "records.jsonl"
            records_path.parent.mkdir(parents=True)
            records = []
            for index in range(25):
                records.append({
                    "source": "sales_navigator",
                    "canonical_url": f"https://www.linkedin.com/sales/lead/lead-{index}",
                    "source_native_id": f"lead-{index}",
                    "author_name": f"Prospect {index}",
                    "author_headline": "Chief Technology Officer",
                    "company_name": f"FinTech Company {index}",
                    "external_action_performed": False,
                    "commercial_evidence": {
                        "campaign_id": "fintech_backend_operations",
                        "campaign_name": "FinTech Backend Operations Platform",
                        "offer_name": "FinTech Backend Operations Platform + Managed Delivery",
                    },
                    "raw_evidence": {"external_action_performed": False},
                    "qualification": {
                        "disposition": "priority_a" if index < 10 else "priority_b" if index < 20 else "research",
                        "risk_reasons": ["cold prospect; no explicit buying intent has been established"],
                    },
                })
            records_path.write_text("\n".join(json.dumps(record) for record in records) + "\n", encoding="utf-8")

            report = build_report(state_root)

            self.assertEqual(report["status"], "ready_for_human_commercial_review")
            self.assertEqual(report["metrics"]["total_records"], 25)
            self.assertEqual(report["metrics"]["reviewable_priority_a_b"], 20)
            self.assertTrue(all(report["gates"].values()))

    def test_pilot_stays_incomplete_when_evidence_is_thin(self) -> None:
        with TemporaryDirectory() as directory:
            state_root = Path(directory)
            records_path = state_root / "sales_navigator" / "records.jsonl"
            records_path.parent.mkdir(parents=True)
            records_path.write_text(json.dumps({
                "source": "sales_navigator",
                "canonical_url": "https://www.linkedin.com/sales/lead/one",
                "source_native_id": "one",
                "author_name": "One Prospect",
                "external_action_performed": False,
                "commercial_evidence": {},
                "raw_evidence": {},
                "qualification": {"disposition": "research", "risk_reasons": []},
            }) + "\n", encoding="utf-8")

            report = build_report(state_root)

            self.assertEqual(report["status"], "pilot_incomplete")
            self.assertFalse(report["gates"]["at_least_25_unique_prospects"])
            self.assertFalse(report["gates"]["role_evidence"])
            self.assertFalse(report["gates"]["company_evidence"])
            self.assertTrue(report["gates"]["no_external_actions"])


if __name__ == "__main__":
    unittest.main()
