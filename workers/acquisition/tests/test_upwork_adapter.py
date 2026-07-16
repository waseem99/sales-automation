import json
from pathlib import Path
from unittest import TestCase

from acquisition.adapters.upwork import (
    UpworkSavedSearch,
    is_human_action_required,
    load_upwork_search_config,
    parse_upwork_card_payload,
)

ROOT = Path(__file__).parents[1]


class UpworkAdapterTest(TestCase):
    def test_loads_configured_searches(self) -> None:
        config = load_upwork_search_config(ROOT / "config" / "upwork-searches.example.toml")
        self.assertEqual(len(config.searches), 5)
        self.assertEqual(config.searches[0].segment, "software-saas")

    def test_parses_complete_job_evidence(self) -> None:
        payload = json.loads((ROOT / "fixtures" / "upwork-card.json").read_text(encoding="utf-8"))
        search = UpworkSavedSearch("ai", "ai-automation", "https://www.upwork.com/nx/search/jobs/?q=rag", True, 25)
        evidence = parse_upwork_card_payload(payload, search)
        self.assertIsNotNone(evidence)
        assert evidence is not None
        self.assertEqual(evidence.source, "upwork")
        self.assertEqual(evidence.source_id, "~01abc123")
        self.assertEqual(evidence.attributes["budget_usd"], 18000.0)
        self.assertEqual(evidence.attributes["client_spend_usd"], 50000.0)
        self.assertEqual(evidence.attributes["client_hire_rate"], 75.0)
        self.assertTrue(evidence.attributes["payment_verified"])
        self.assertEqual(evidence.attributes["engagement_type"], "fixed")

    def test_detects_manual_verification(self) -> None:
        self.assertTrue(is_human_action_required(
            "https://www.upwork.com/ab/account-security/login",
            "Security check: Verify you are human",
        ))
        self.assertFalse(is_human_action_required(
            "https://www.upwork.com/nx/search/jobs/",
            "Jobs matching your saved search",
        ))
