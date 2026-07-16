from __future__ import annotations

import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from acquisition.deduplication import build_dedupe_key
from acquisition.models import OpportunityRecord, SourceEvidence
from acquisition.pilot_v2_output import write_pilot_v2_outputs
from acquisition.qualification import QualificationDecision
from acquisition.upwork_pilot import PilotItem, PilotSummary


class PilotV2OutputTests(unittest.TestCase):
    def item(self, priority: str, disposition: str, suffix: str) -> PilotItem:
        evidence = SourceEvidence(
            source="upwork",
            source_id=f"~job{suffix}12345678",
            source_url=f"https://www.upwork.com/jobs/test_~job{suffix}12345678/",
            captured_at="2026-07-16T00:00:00Z",
            title=f"Opportunity {suffix}",
            body="Build a complete enterprise SaaS and AI implementation with clear requirements and integrations.",
            segment="software-saas",
            attributes={
                "budget_usd": 5000,
                "payment_status": "verified",
                "capture_quality": "high",
            },
        )
        decision = QualificationDecision(
            disposition=disposition,
            priority=priority,
            score={"A": 80, "B": 60, "C": 30}[priority],
            confidence="high",
            business_unit="Codistan",
            service_id="software-saas",
            dimensions={
                "commercial_potential": 20,
                "technical_fit": 25,
                "buyer_quality": 15,
                "competition_timing": 10,
            },
            reasons=("Test reason",),
            missing_evidence=(),
            risks=(),
            proof_ids=("acmetel-esim",),
            recommended_action="Test action",
            configuration_version="test.v1",
        )
        record = OpportunityRecord(dedupe_key=build_dedupe_key(evidence), evidence=evidence)
        return PilotItem(record=record, qualification=decision)

    def test_dashboard_ready_contains_only_priority_a_and_b(self) -> None:
        with TemporaryDirectory() as directory:
            output = Path(directory)
            summary = PilotSummary(started_at="2026-07-16T00:00:00Z", extracted=3, links_found=3, reviewed=3)
            write_pilot_v2_outputs(
                output_directory=output,
                summary=summary,
                items=[
                    self.item("A", "contact_ready", "a"),
                    self.item("B", "bd_review", "b"),
                    self.item("C", "reject", "c"),
                ],
                config_version="test.v1",
            )
            lines = [json.loads(line) for line in (output / "dashboard-ready.jsonl").read_text(encoding="utf-8").splitlines()]
            self.assertEqual(len(lines), 2)
            self.assertEqual({line["qualification"]["priority"] for line in lines}, {"A", "B"})
            self.assertTrue((output / "report.html").exists())
            self.assertTrue((output / "opportunities.csv").exists())


if __name__ == "__main__":
    unittest.main()
