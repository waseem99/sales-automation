from pathlib import Path
from unittest import TestCase

from acquisition.deduplication import build_dedupe_key
from acquisition.models import OpportunityRecord, SourceEvidence
from acquisition.qualification import load_qualification_config, qualify

CONFIG = Path(__file__).parents[1] / "config" / "qualification.example.toml"


class QualificationTest(TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.config = load_qualification_config(CONFIG)

    def record(self, *, title: str, body: str, attributes: dict[str, object]) -> OpportunityRecord:
        evidence = SourceEvidence(
            source="upwork",
            source_id=f"job-{abs(hash(title))}",
            source_url="https://example.test/jobs/1",
            captured_at="2026-07-16T00:00:00Z",
            title=title,
            body=body,
            segment="pilot",
            attributes=attributes,
        )
        return OpportunityRecord(dedupe_key=build_dedupe_key(evidence), evidence=evidence)

    def test_routes_strong_ai_opportunity(self) -> None:
        decision = qualify(self.record(
            title="Private RAG and AI agent platform",
            body="Build a secure RAG document intelligence assistant with citations, permissions, evaluation and an AI agent workflow for our internal teams.",
            attributes={
                "budget_usd": 18000,
                "client_spend_usd": 50000,
                "client_hire_rate": 70,
                "payment_verified": True,
                "urgency_days": 21,
            },
        ), self.config)
        self.assertEqual(decision.business_unit, "Hilarious AI")
        self.assertEqual(decision.disposition, "proposal_ready")
        self.assertGreaterEqual(decision.score, 80)
        self.assertIn("private-rag", decision.proof_ids)

    def test_low_budget_is_not_contact_ready(self) -> None:
        decision = qualify(self.record(
            title="React Native application",
            body="Build a complete React Native marketplace application with admin portal and payment flows.",
            attributes={"budget_usd": 300, "payment_verified": True},
        ), self.config)
        self.assertIn(decision.disposition, {"reject", "research"})
        self.assertIn("budget_below_minimum", decision.risks)

    def test_missing_buyer_evidence_stays_research(self) -> None:
        decision = qualify(self.record(
            title="SOC 2 and ISO 27001 support",
            body="We need cybersecurity compliance support for SOC 2 and ISO 27001 readiness across our cloud environment.",
            attributes={"budget_usd": 5000},
        ), self.config)
        self.assertEqual(decision.business_unit, "Cytas")
        self.assertEqual(decision.disposition, "research")
        self.assertIn("buyer credibility evidence", decision.missing_evidence)

    def test_prohibited_work_is_rejected(self) -> None:
        decision = qualify(self.record(
            title="Academic assignment help",
            body="Complete my academic assignment and exam help project.",
            attributes={"budget_usd": 5000, "payment_verified": True},
        ), self.config)
        self.assertEqual(decision.disposition, "reject")
        self.assertEqual(decision.score, 0)
        self.assertTrue(decision.risks)
