from __future__ import annotations

import unittest

from acquisition_v4.qualification_router import qualify_record


class SalesNavigatorQualificationTests(unittest.TestCase):
    def strong_fintech_prospect(self) -> dict:
        return {
            "source": "sales_navigator",
            "canonical_url": "https://www.linkedin.com/sales/lead/ACwAAExample",
            "source_native_id": "ACwAAExample",
            "dedupe_key": "sales-nav-fintech-cto",
            "title": "Ayesha Khan — CTO at PayFlow",
            "body": "Prospect: Ayesha Khan | Role: Chief Technology Officer at PayFlow | Company: PayFlow fintech payments infrastructure | Location: UAE | Relationship: 2nd",
            "author_name": "Ayesha Khan",
            "author_profile_url": "https://www.linkedin.com/sales/lead/ACwAAExample",
            "author_headline": "Chief Technology Officer at PayFlow",
            "company_name": "PayFlow",
            "commercial_evidence": {
                "campaign_id": "fintech_backend_operations",
                "campaign_name": "FinTech Backend Operations Platform",
                "offer_name": "FinTech Backend Operations Platform + Managed Delivery",
                "offer_summary": "Backend operations platform and managed delivery for fintech companies.",
                "service_route": "software_product",
                "service_lanes": ["software_product", "delivery_partner", "ai_automation"],
                "target_industry_terms": ["fintech", "payments", "digital banking"],
                "industry_match": True,
                "target_geographies": ["UAE"],
                "geography_match": True,
            },
            "raw_evidence": {
                "location": "Dubai, UAE",
                "relationship": "2nd",
                "mutual_connections": 3,
                "posted_on_linkedin": True,
                "recent_activity": True,
            },
        }

    def test_strong_fintech_cto_is_priority_a(self) -> None:
        decision = qualify_record(self.strong_fintech_prospect())
        self.assertEqual(decision["disposition"], "priority_a")
        self.assertGreaterEqual(decision["total_score"], 76)
        self.assertEqual(decision["campaign_id"], "fintech_backend_operations")
        self.assertIn("cold prospect; no explicit buying intent has been established", decision["risk_reasons"])
        self.assertNotIn("buyer_intent", decision["dimensions"])

    def test_wrong_industry_is_rejected(self) -> None:
        record = self.strong_fintech_prospect()
        record["commercial_evidence"]["industry_match"] = False
        decision = qualify_record(record)
        self.assertEqual(decision["disposition"], "reject")
        self.assertIn("account falls outside the configured industry criteria", decision["risk_reasons"])

    def test_missing_campaign_is_rejected(self) -> None:
        record = self.strong_fintech_prospect()
        record["commercial_evidence"] = {}
        decision = qualify_record(record)
        self.assertEqual(decision["disposition"], "reject")
        self.assertIn("unregistered Sales Navigator campaign", decision["risk_reasons"])

    def test_mid_level_prospect_requires_research_or_priority_b(self) -> None:
        record = self.strong_fintech_prospect()
        record["author_headline"] = "Product Operations Manager at PayFlow"
        record["body"] = "Prospect: Ayesha Khan | Role: Product Operations Manager at PayFlow | Company: PayFlow fintech payments infrastructure"
        record["raw_evidence"] = {"location": "Dubai, UAE"}
        decision = qualify_record(record)
        self.assertIn(decision["disposition"], {"priority_b", "research"})
        self.assertNotEqual(decision["disposition"], "priority_a")


if __name__ == "__main__":
    unittest.main()
