from __future__ import annotations

import unittest

from acquisition.upwork_card import (
    canonical_visible_job_url,
    clean_visible_description,
    parse_visible_card_metrics,
)


class UpworkCardTests(unittest.TestCase):
    def test_rejects_generic_search_url(self) -> None:
        self.assertIsNone(canonical_visible_job_url("https://www.upwork.com/nx/search/jobs/"))
        self.assertIsNone(canonical_visible_job_url("https://www.upwork.com/jobs/"))

    def test_accepts_concrete_job_url(self) -> None:
        value = canonical_visible_job_url(
            "https://www.upwork.com/jobs/Senior-Engineer_~022077770760696635841/?source=search"
        )
        self.assertEqual(
            value,
            "https://www.upwork.com/jobs/Senior-Engineer_~022077770760696635841/",
        )

    def test_parses_fixed_budget_and_visible_client_signals(self) -> None:
        value = parse_visible_card_metrics(
            "Posted 41 minutes ago Proposals: 5 to 10 Fixed-price - Expert - "
            "Est. Budget: $5,000 Payment verified $50K+ spent United States"
        )
        self.assertEqual(value["fixed_budget_usd"], 5000)
        self.assertEqual(value["budget_usd"], 5000)
        self.assertEqual(value["budget_basis"], "fixed")
        self.assertEqual(value["client_spend_usd"], 50000)
        self.assertEqual(value["proposal_activity"], "5 to 10")
        self.assertEqual(value["competition_level"], "medium")
        self.assertEqual(value["payment_status"], "verified")

    def test_parses_hourly_range_without_hr_suffix(self) -> None:
        value = parse_visible_card_metrics(
            "Hourly: $30-$60 - Intermediate - Less than 1 month - "
            "Proposals: 50+ Payment verified $60K+ spent"
        )
        self.assertEqual(value["hourly_min_usd"], 30)
        self.assertEqual(value["hourly_max_usd"], 60)
        self.assertEqual(value["budget_usd"], 9600)
        self.assertEqual(value["budget_basis"], "hourly_monthly_estimate")
        self.assertEqual(value["competition_level"], "very_high")

    def test_removes_feedback_menu_from_description(self) -> None:
        body, metadata = clean_visible_description(
            title="AI Expert to enable natural language queries on SaaS app",
            description="",
            card_text=(
                "Posted 1 hour ago Proposals: 50+ AI Expert to enable natural language queries on SaaS app "
                "We need a specialist to implement natural language analytics in our SaaS product, including "
                "secure query translation, permissions and evaluation. Job feedback Just not interested "
                "Vague Description Unrealistic Expectations"
            ),
        )
        self.assertIn("secure query translation", body)
        self.assertNotIn("Job feedback", body)
        self.assertEqual(metadata["description_source"], "derived_from_visible_card")
        self.assertIn(metadata["capture_quality"], {"medium", "high"})


if __name__ == "__main__":
    unittest.main()
