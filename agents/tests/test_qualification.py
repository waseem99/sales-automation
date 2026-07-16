from __future__ import annotations

import unittest

from acquisition_worker.models import Opportunity
from acquisition_worker.qualification import qualify_opportunity


class QualificationTests(unittest.TestCase):
    def test_routes_strong_ai_job_to_hilarious_ai(self) -> None:
        decision = qualify_opportunity(
            Opportunity(
                source="upwork",
                external_id="~ai1",
                source_url="https://www.upwork.com/jobs/~ai1",
                title="Build an AI agent and RAG automation platform",
                description=(
                    "We need an experienced implementation partner to build an internal RAG assistant, "
                    "n8n workflow automation, admin dashboard, approvals, integrations and production rollout. "
                    "The team should propose architecture, delivery phases, testing and launch support. "
                    "This is a funded engagement for an operating SaaS company with a clear owner and timeline."
                ),
                search_segment="ai-automation",
                budget_signal="$8,000 fixed",
                metadata={
                    "payment_verified": True,
                    "client_spend_usd": 50000,
                    "hire_rate_percent": 80,
                    "proposal_count": 8,
                    "service_hint": "ai_automation",
                },
            )
        )
        self.assertEqual(decision.business_unit, "hilarious_ai")
        self.assertIn(decision.disposition, {"contact_ready", "proposal_ready"})
        self.assertIn("portfolio-ai-rag-assistant", decision.portfolio_item_ids)

    def test_rejects_academic_cheating(self) -> None:
        decision = qualify_opportunity(
            Opportunity(
                source="upwork",
                external_id="~bad1",
                source_url="https://www.upwork.com/jobs/~bad1",
                title="Complete my university assignment",
                description="Do my coursework and exam project for me.",
                search_segment="software-saas",
            )
        )
        self.assertEqual(decision.disposition, "reject")
        self.assertIn("academic_cheating", decision.risk_flags)


if __name__ == "__main__":
    unittest.main()
