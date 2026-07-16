from __future__ import annotations

import unittest

from acquisition_worker.ingestion import DashboardIngestionClient
from acquisition_worker.models import Opportunity


class IngestionTests(unittest.TestCase):
    def test_upwork_uses_existing_manual_batch_contract(self) -> None:
        client = DashboardIngestionClient("https://example.test/", "private-cookie")
        payload = client.build_payload(
            Opportunity(
                source="upwork",
                title="AI project",
                description="Need RAG and automation",
                search_segment="ai",
                source_url="https://www.upwork.com/jobs/~123",
                budget_signal="$5,000",
            )
        )
        self.assertEqual(payload["sourceKind"], "auto_batch")
        self.assertIn("https://www.upwork.com/jobs/~123", payload["content"])

    def test_linkedin_uses_signal_contract(self) -> None:
        client = DashboardIngestionClient("https://example.test/", "private-cookie")
        payload = client.build_payload(
            Opportunity(
                source="sales_navigator",
                title="Trigger",
                description="Company is hiring an AI implementation lead",
                search_segment="sales-nav",
                source_url="https://www.linkedin.com/company/example",
                company_name="Example",
            )
        )
        self.assertEqual(payload["sourceKind"], "linkedin_signal")
        self.assertEqual(payload["sourceUrl"], "https://www.linkedin.com/company/example")


if __name__ == "__main__":
    unittest.main()
