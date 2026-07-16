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
            source_url="https://www.upwork.com/jobs/test_~022077770760696635841/",
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
                "payment_status": "verified",
                "capture_quality": "high",
                "urgency_days": 21,
            },
        ), self.config)
        self.assertEqual(decision.business_unit, "Hilarious AI")
        self.assertEqual(decision.disposition, "proposal_ready")
        self.assertGreaterEqual(decision.score, 80)
        self.assertIn("private-rag", decision.proof_ids)

    def test_routes_natural_language_saas_ai_to_hilarious_ai(self) -> None:
        decision = qualify(self.record(
            title="AI Expert to enable natural language queries on SaaS app",
            body="Implement natural language queries, an LLM layer and secure evaluation for an existing SaaS analytics product.",
            attributes={
                "budget_usd": 8000,
                "client_spend_usd": 60000,
                "payment_verified": True,
                "payment_status": "verified",
                "capture_quality": "high",
                "proposal_activity": "10 to 15",
                "competition_level": "medium",
            },
        ), self.config)
        self.assertEqual(decision.business_unit, "Hilarious AI")
        self.assertEqual(decision.service_id, "ai-automation")

    def test_low_budget_is_not_contact_ready(self) -> None:
        decision = qualify(self.record(
            title="React Native application",
            body="Build a complete React Native marketplace application with admin portal and payment flows.",
            attributes={
                "budget_usd": 300,
                "payment_verified": True,
                "payment_status": "verified",
                "capture_quality": "high",
            },
        ), self.config)
        self.assertIn(decision.disposition, {"reject", "research"})
        self.assertIn("budget_below_minimum", decision.risks)

    def test_missing_buyer_evidence_stays_research(self) -> None:
        decision = qualify(self.record(
            title="SOC 2 and ISO 27001 support",
            body="We need cybersecurity compliance support for SOC 2 and ISO 27001 readiness across our cloud environment.",
            attributes={"budget_usd": 5000, "capture_quality": "high"},
        ), self.config)
        self.assertEqual(decision.business_unit, "Cytas")
        self.assertEqual(decision.disposition, "research")
        self.assertIn("buyer credibility evidence", decision.missing_evidence)

    def test_very_high_competition_is_visible_but_not_a_blocking_risk(self) -> None:
        decision = qualify(self.record(
            title="AI automation and workflow implementation",
            body="Build an AI agent and n8n workflow automation for a customer operations platform.",
            attributes={
                "budget_usd": 12000,
                "client_spend_usd": 50000,
                "payment_verified": True,
                "payment_status": "verified",
                "capture_quality": "high",
                "proposal_activity": "50+",
                "competition_level": "very_high",
            },
        ), self.config)
        self.assertIn("very_high_competition", decision.risks)
        self.assertNotEqual(decision.disposition, "research")

    def test_low_capture_quality_cannot_be_proposal_ready(self) -> None:
        decision = qualify(self.record(
            title="AI engineer",
            body="Posted 1 hour ago Proposals 50+ Job feedback Too Many Applicants Save job",
            attributes={
                "budget_usd": 8000,
                "client_spend_usd": 50000,
                "payment_verified": True,
                "payment_status": "verified",
                "capture_quality": "low",
            },
        ), self.config)
        self.assertIn("low_capture_quality", decision.risks)
        self.assertIn(decision.disposition, {"reject", "research"})

    def test_prohibited_work_is_rejected(self) -> None:
        decision = qualify(self.record(
            title="Academic assignment help",
            body="Complete my academic assignment and exam help project.",
            attributes={"budget_usd": 5000, "payment_verified": True},
        ), self.config)
        self.assertEqual(decision.disposition, "reject")
        self.assertEqual(decision.score, 0)
        self.assertTrue(decision.risks)
