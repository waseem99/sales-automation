from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from acquisition.upwork_pilot import (
    canonical_job_url,
    external_job_id,
    load_upwork_pilot_config,
    parse_upwork_metrics,
)


class UpworkPilotTests(unittest.TestCase):
    def test_metrics(self) -> None:
        value = parse_upwork_metrics(
            "Payment method verified $50K+ spent 80% hire rate "
            "Proposals: 5 to 10 Fixed-price Budget $6,000 "
            "Posted 2 hours ago Expert 1 to 3 months United States"
        )
        self.assertTrue(value["payment_verified"])
        self.assertEqual(value["client_spend_usd"], 50000)
        self.assertEqual(value["client_hire_rate"], 80)
        self.assertEqual(value["fixed_budget_usd"], 6000)
        self.assertEqual(value["proposal_activity"], "5 to 10")
        self.assertEqual(value["experience_level"], "Expert")

    def test_url_and_id(self) -> None:
        url = canonical_job_url(
            "https://www.upwork.com/freelance-jobs/apply/example_~0123456789abcdef/?source=rss"
        )
        self.assertEqual(
            url,
            "https://www.upwork.com/freelance-jobs/apply/example_~0123456789abcdef/",
        )
        self.assertEqual(external_job_id(url), "~0123456789abcdef")

    def test_config_limits_and_hosts(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "pilot.toml"
            path.write_text(
                """
[pilot]
version = "v1"
max_jobs_total = 10
min_description_chars = 80

[[searches]]
id = "ai"
enabled = true
url = "https://www.upwork.com/nx/search/jobs/?q=ai&sort=recency"
max_jobs = 3
delay_seconds = 8
""",
                encoding="utf-8",
            )
            config = load_upwork_pilot_config(path)
        self.assertEqual(config.max_jobs_total, 10)
        self.assertEqual(config.min_description_chars, 80)
        self.assertEqual(config.searches[0].id, "ai")
        self.assertEqual(config.searches[0].max_jobs, 3)


if __name__ == "__main__":
    unittest.main()
