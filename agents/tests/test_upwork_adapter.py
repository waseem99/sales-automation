from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from acquisition_worker.adapters.upwork import (
    UpworkCardSnapshot,
    load_upwork_searches,
    parse_upwork_card_metrics,
    snapshot_to_opportunity,
)


class UpworkAdapterTests(unittest.TestCase):
    def test_metrics_and_normalization(self) -> None:
        metrics = parse_upwork_card_metrics(
            "Payment verified $50K+ spent 80% hire rate Proposals: 8 "
            "Fixed-price Budget $6,000 United States"
        )
        self.assertTrue(metrics["payment_verified"])
        self.assertEqual(metrics["client_spend_usd"], 50000)
        self.assertEqual(metrics["hire_rate_percent"], 80)
        self.assertEqual(metrics["proposal_count"], 8)
        self.assertEqual(metrics["fixed_budget_usd"], 6000)

    def test_config_and_snapshot(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "config.json"
            path.write_text(json.dumps({
                "searches": [{
                    "id": "ai",
                    "url": "https://www.upwork.com/nx/search/jobs/?q=ai",
                    "service_hint": "ai_automation",
                    "business_unit_hint": "hilarious_ai",
                    "keywords": ["ai"],
                    "exclusions": ["homework"],
                    "min_fixed_budget": 2000,
                    "min_hourly_rate": 20,
                    "max_pages": 1,
                    "delay_seconds": 3
                }]
            }), encoding="utf-8")
            search = load_upwork_searches(path)[0]
        opportunity = snapshot_to_opportunity(
            UpworkCardSnapshot(
                external_id="~123",
                source_url="https://www.upwork.com/jobs/~123",
                title="AI automation",
                description="Build a production AI automation workflow and dashboard.",
                card_text="Payment verified $10K+ spent Proposals: 5 Budget $5,000",
                skills=("OpenAI", "n8n"),
            ),
            search,
        )
        self.assertEqual(opportunity.source, "upwork")
        self.assertEqual(opportunity.metadata["service_hint"], "ai_automation")
        self.assertEqual(opportunity.metadata["proposal_count"], 5)


if __name__ == "__main__":
    unittest.main()
