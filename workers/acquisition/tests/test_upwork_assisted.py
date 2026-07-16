from __future__ import annotations

import unittest

from acquisition.upwork_assisted import VisibleJobCard, _search_label


class UpworkAssistedTests(unittest.TestCase):
    def test_visible_card_normalizes_to_source_evidence(self) -> None:
        card = VisibleJobCard(
            source_url="https://www.upwork.com/jobs/~0123456789abcdef",
            title="Build a production RAG automation platform",
            description=(
                "We need an experienced team to build a production RAG automation platform "
                "with document ingestion, workflows, and a secure administration dashboard."
            ),
            card_text=(
                "Build a production RAG automation platform Payment method verified "
                "$50K+ spent 80% hire rate Proposals: 5 to 10 Fixed-price Budget $6,000 "
                "United States"
            ),
            skills=("Python", "OpenAI", "n8n"),
        )
        evidence = card.to_evidence("ai-automation")
        self.assertEqual(evidence.source, "upwork")
        self.assertEqual(evidence.source_id, "~0123456789abcdef")
        self.assertEqual(evidence.segment, "ai-automation")
        self.assertEqual(evidence.attributes["capture_mode"], "human_navigated_visible_results")
        self.assertEqual(evidence.attributes["fixed_budget_usd"], 6000)
        self.assertEqual(evidence.attributes["client_spend_usd"], 50000)

    def test_search_label_uses_readable_query(self) -> None:
        label = _search_label(
            "software-saas",
            "https://www.upwork.com/nx/search/jobs/?q=react%20native%20saas&sort=recency",
        )
        self.assertEqual(label, "software-saas (react native saas)")


if __name__ == "__main__":
    unittest.main()
