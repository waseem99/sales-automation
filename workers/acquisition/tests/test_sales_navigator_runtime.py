from __future__ import annotations

import json
from pathlib import Path
import tempfile
import unittest

from acquisition_v4.runtime_v5 import CollectorState


class SalesNavigatorRuntimeTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.state_root = Path(self.temp.name)
        self.state = CollectorState(
            source="sales_navigator",
            state_root=self.state_root,
            parser_version="sales-navigator-extension-1.0.0",
        )

    def tearDown(self) -> None:
        self.temp.cleanup()

    def payload(self, body_suffix: str = "") -> dict:
        return {
            "source": "sales_navigator",
            "source_subtype": "campaign_lead_search",
            "parser_version": "sales-navigator-extension-1.0.0",
            "page_url": "https://www.linkedin.com/sales/search/people?query=SANITIZED",
            "page_identity": "fintech_backend_operations — FinTech Backend Operations Platform",
            "external_action_performed": False,
            "records": [{
                "source_url": "https://www.linkedin.com/sales/lead/ACwAASanitizedLead",
                "source_native_id": "ACwAASanitizedLead",
                "title": "Ayesha Khan — Chief Technology Officer at PayFlow",
                "body": f"Prospect Ayesha Khan is Chief Technology Officer at PayFlow, a fintech payments infrastructure company. {body_suffix}",
                "author": {
                    "name": "Ayesha Khan",
                    "profile_url": "https://www.linkedin.com/sales/lead/ACwAASanitizedLead",
                    "headline": "Chief Technology Officer at PayFlow",
                    "company": "PayFlow",
                },
                "commercial_evidence": {
                    "campaign_id": "fintech_backend_operations",
                    "campaign_name": "FinTech Backend Operations Platform",
                    "offer_name": "FinTech Backend Operations Platform + Managed Delivery",
                    "offer_summary": "Backend operations and managed delivery for fintech companies.",
                    "service_route": "software_product",
                    "service_lanes": ["software_product", "delivery_partner", "ai_automation"],
                    "target_industry_terms": ["fintech", "payments"],
                    "industry_match": True,
                },
                "raw_evidence": {
                    "location": "Dubai, UAE",
                    "relationship": "2nd",
                    "mutual_connections": 3,
                    "posted_on_linkedin": True,
                },
            }],
        }

    def test_capture_duplicate_and_enrichment(self) -> None:
        first = self.state.capture(self.payload())
        self.assertEqual(first["accepted"], 1)
        self.assertEqual(first["accepted_priority_counts"]["priority_a"], 1)
        self.assertEqual(self.state.records[0]["source"], "sales_navigator")
        self.assertEqual(self.state.records[0]["qualification"]["campaign_id"], "fintech_backend_operations")
        self.assertIn("no explicit buying intent", " ".join(self.state.records[0]["qualification"]["risk_reasons"]))

        duplicate = self.state.capture(self.payload())
        self.assertEqual(duplicate["accepted"], 0)
        self.assertEqual(duplicate["duplicates"], 1)
        self.assertEqual(duplicate["enriched"], 0)

        richer = self.state.capture(self.payload("Recent LinkedIn activity and a visible platform integration remit."))
        self.assertEqual(richer["accepted"], 0)
        self.assertEqual(richer["duplicates"], 1)
        self.assertEqual(richer["enriched"], 1)
        self.assertIn("integration remit", self.state.records[0]["body"])

        records = [json.loads(line) for line in (self.state_root / "sales_navigator" / "records.jsonl").read_text(encoding="utf-8").splitlines() if line]
        self.assertEqual(len(records), 1)


if __name__ == "__main__":
    unittest.main()
