from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path
import unittest

from acquisition.models import OpportunityRecord, SourceEvidence
from acquisition.qualification import QualificationDecision
from acquisition.upwork_market import annotate_profile_and_market, apply_market_policy
from acquisition.upwork_pilot import load_upwork_pilot_config
from acquisition.upwork_schedule import evaluate_acquisition_schedule, load_acquisition_schedule


CONFIG_PATH = Path(__file__).resolve().parents[1] / "config" / "upwork-automation.toml"


class UpworkMarketScheduleTests(unittest.TestCase):
    def test_every_active_run_contains_exactly_three_saved_searches(self) -> None:
        config = load_upwork_pilot_config(CONFIG_PATH)
        self.assertEqual(
            [search.id for search in config.searches],
            ["ai-jobs", "roshana-2d-3d", "nadir-game-ar-vr"],
        )
        self.assertEqual(
            [search.url for search in config.searches],
            [
                "https://www.upwork.com/nx/find-work/9652811",
                "https://www.upwork.com/nx/find-work/9652860",
                "https://www.upwork.com/nx/find-work/9652877",
            ],
        )

    def test_schedule_is_30_minutes_and_dst_aware_for_us_and_australia(self) -> None:
        schedule = load_acquisition_schedule(CONFIG_PATH)
        self.assertEqual(schedule.cadence_minutes, 30)
        self.assertEqual(schedule.start_offset_minutes, 7)
        self.assertEqual(
            [window.timezone for window in schedule.windows],
            ["America/New_York", "Australia/Sydney"],
        )

        us_active = evaluate_acquisition_schedule(
            CONFIG_PATH,
            now_utc=datetime(2026, 7, 16, 14, 0, tzinfo=UTC),
        )
        self.assertTrue(us_active.active)
        self.assertIn("us-east-through-pacific", us_active.matched_windows)

        australia_active = evaluate_acquisition_schedule(
            CONFIG_PATH,
            now_utc=datetime(2026, 7, 16, 22, 0, tzinfo=UTC),
        )
        self.assertTrue(australia_active.active)
        self.assertIn("australia-early", australia_active.matched_windows)

        inactive = evaluate_acquisition_schedule(
            CONFIG_PATH,
            now_utc=datetime(2026, 7, 16, 5, 0, tzinfo=UTC),
        )
        self.assertFalse(inactive.active)

    def test_us_fixed_price_job_matches_both_market_presets(self) -> None:
        evidence = _evidence(
            segment="ai-jobs",
            country="United States",
            attributes={"fixed_budget_usd": 5000},
        )
        annotated = annotate_profile_and_market(evidence, "ai-jobs")
        self.assertEqual(annotated.attributes["market_scopes"], ["us_only", "worldwide"])
        self.assertEqual(annotated.attributes["commercial_filter_status"], "pass")
        self.assertEqual(annotated.attributes["profile_url"], "https://www.upwork.com/freelancers/~016e9a7bda2340dcd9")

    def test_worldwide_hourly_job_requires_more_than_30_hours_and_duration(self) -> None:
        evidence = _evidence(
            segment="nadir-game-ar-vr",
            country="Australia",
            attributes={
                "hourly_min_usd": 35,
                "hourly_max_usd": 60,
                "estimated_hours_per_week": 30,
                "weekly_hours_basis": "more_than",
                "duration": "3 to 6 months",
            },
        )
        annotated = annotate_profile_and_market(evidence, "nadir-game-ar-vr")
        self.assertEqual(annotated.attributes["market_scopes"], ["worldwide"])
        self.assertEqual(annotated.attributes["commercial_filter_status"], "pass")

        exactly_thirty = annotate_profile_and_market(
            _evidence(
                segment="nadir-game-ar-vr",
                country="Australia",
                attributes={
                    "hourly_min_usd": 35,
                    "hourly_max_usd": 60,
                    "estimated_hours_per_week": 30,
                    "weekly_hours_basis": "range_maximum",
                    "duration": "3 to 6 months",
                },
            ),
            "nadir-game-ar-vr",
        )
        self.assertEqual(exactly_thirty.attributes["commercial_filter_status"], "fail")

    def test_pakistan_gcc_and_low_budget_jobs_are_archived(self) -> None:
        for country in ("Pakistan", "UAE", "Saudi Arabia", "Qatar", "Kuwait", "Bahrain", "Oman"):
            with self.subTest(country=country):
                annotated = annotate_profile_and_market(
                    _evidence(segment="roshana-2d-3d", country=country, attributes={"fixed_budget_usd": 6000}),
                    "roshana-2d-3d",
                )
                decision = apply_market_policy(
                    OpportunityRecord(dedupe_key=f"test-{country}", evidence=annotated),
                    _decision(priority="A", score=85),
                )
                self.assertEqual(decision.priority, "C")
                self.assertEqual(decision.disposition, "reject")

        low_budget = annotate_profile_and_market(
            _evidence(segment="ai-jobs", country="United States", attributes={"fixed_budget_usd": 999}),
            "ai-jobs",
        )
        decision = apply_market_policy(
            OpportunityRecord(dedupe_key="low-budget", evidence=low_budget),
            _decision(priority="A", score=85),
        )
        self.assertEqual(decision.priority, "C")

    def test_missing_filter_evidence_cannot_be_priority_a(self) -> None:
        annotated = annotate_profile_and_market(
            _evidence(segment="ai-jobs", country="", attributes={}),
            "ai-jobs",
        )
        decision = apply_market_policy(
            OpportunityRecord(dedupe_key="missing-evidence", evidence=annotated),
            _decision(priority="A", score=88),
        )
        self.assertEqual(decision.priority, "B")
        self.assertEqual(decision.disposition, "bd_review")

    def test_description_country_mentions_do_not_override_visible_client_location(self) -> None:
        evidence = SourceEvidence(
            source="upwork",
            source_id="~012345678901234567890",
            source_url="https://www.upwork.com/jobs/Test_~012345678901234567890/",
            captured_at="2026-07-16T00:00:00Z",
            title="US platform rollout",
            body="The United States client needs a platform that will later serve teams in Pakistan and the UAE.",
            segment="ai-jobs",
            attributes={"fixed_budget_usd": 5000, "client_country": "United States"},
        )
        annotated = annotate_profile_and_market(
            evidence,
            "ai-jobs",
            visible_client_card_text="Payment verified $20K spent United States",
        )
        self.assertEqual(annotated.attributes["client_country"], "united states")
        self.assertEqual(annotated.attributes["market_scopes"], ["us_only", "worldwide"])
        self.assertEqual(annotated.attributes["market_policy_status"], "eligible")


def _evidence(*, segment: str, country: str, attributes: dict[str, object]) -> SourceEvidence:
    values = dict(attributes)
    if country:
        values["client_country"] = country
    return SourceEvidence(
        source="upwork",
        source_id="~012345678901234567890",
        source_url="https://www.upwork.com/jobs/Test_~012345678901234567890/",
        captured_at="2026-07-16T00:00:00Z",
        title="Test opportunity",
        body="A sufficiently detailed opportunity description for deterministic acquisition policy testing.",
        segment=segment,
        attributes=values,
    )


def _decision(*, priority: str, score: int) -> QualificationDecision:
    return QualificationDecision(
        disposition="proposal_ready",
        priority=priority,
        score=score,
        confidence="high",
        business_unit="Codistan",
        service_id="software-saas",
        dimensions={"commercial_potential": 25, "technical_fit": 25, "buyer_quality": 18, "competition_timing": 17},
        reasons=("Strong fit",),
        missing_evidence=(),
        risks=(),
        proof_ids=(),
        recommended_action="Review now",
        configuration_version="test",
    )


if __name__ == "__main__":
    unittest.main()
