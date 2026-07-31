from __future__ import annotations

import json
from pathlib import Path
import unittest

from acquisition_v4.linkedin_intent import (
    ACTIONABLE_CATEGORIES,
    INTENT_CATEGORIES,
    STRONG_NEGATIVE_CATEGORIES,
    classify_linkedin_intent,
)
from acquisition_v4.qualification import qualify_record


FIXTURES = Path(__file__).with_name("fixtures") / "linkedin_intent_cases.json"


def load_cases() -> list[dict[str, object]]:
    return json.loads(FIXTURES.read_text(encoding="utf-8"))


class LinkedInIntentClassificationTests(unittest.TestCase):
    def test_representative_fixtures_cover_every_required_category(self) -> None:
        cases = load_cases()
        covered = {str(case["expected_category"]) for case in cases}
        self.assertEqual(covered, set(INTENT_CATEGORIES))

    def test_every_fixture_has_traceable_category_reasons_and_evidence(self) -> None:
        for case in load_cases():
            with self.subTest(case=case["name"]):
                record = dict(case["record"])
                result = classify_linkedin_intent(record)
                self.assertEqual(result["category"], case["expected_category"])
                self.assertEqual(result["disposition"], case["expected_disposition"])
                self.assertTrue(result["matched_signals"])
                self.assertTrue(result["positive_reasons"] or result["negative_reasons"])
                self.assertEqual(result["evidence"]["title"], record["title"])
                self.assertEqual(result["evidence"]["body"], record["body"])
                self.assertEqual(result["evidence"]["canonical_url"], record["canonical_url"])
                self.assertEqual(len(result["evidence_hash"]), 64)
                self.assertEqual(result["human_review_required"], True)
                self.assertEqual(result["external_action_automated"], False)
                self.assertEqual(result["original_source_classification_preserved"], True)

                repeated = classify_linkedin_intent(record)
                self.assertEqual(repeated["evidence_hash"], result["evidence_hash"])
                self.assertEqual(repeated["category"], result["category"])

    def test_actionable_categories_require_current_traceable_buyer_authored_evidence(self) -> None:
        for case in load_cases():
            category = str(case["expected_category"])
            result = classify_linkedin_intent(dict(case["record"]))
            if category in ACTIONABLE_CATEGORIES and case["expected_disposition"] == "actionable":
                with self.subTest(case=case["name"]):
                    self.assertEqual(result["buyer_authored"], True)
                    self.assertEqual(result["buyer_intent_confirmed"], True)
                    self.assertEqual(result["actionable_warm_demand"], True)
                    self.assertEqual(result["freshness_status"], "current")
                    self.assertEqual(result["traceable_post"], True)

    def test_strong_negatives_never_enter_actionable_warm_queue(self) -> None:
        cases_by_category = {
            str(case["expected_category"]): case
            for case in load_cases()
        }
        for category in STRONG_NEGATIVE_CATEGORIES:
            with self.subTest(category=category):
                case = cases_by_category[category]
                result = classify_linkedin_intent(dict(case["record"]))
                self.assertEqual(result["strong_negative"], True)
                self.assertEqual(result["actionable_warm_demand"], False)
                self.assertEqual(result["buyer_intent_confirmed"], False)
                self.assertEqual(result["disposition"], "reject")

    def test_unclear_evidence_is_research_only(self) -> None:
        case = next(case for case in load_cases() if case["name"] == "unclear research")
        result = classify_linkedin_intent(dict(case["record"]))
        self.assertEqual(result["category"], "unclear_research")
        self.assertEqual(result["disposition"], "research")
        self.assertEqual(result["buyer_intent_confirmed"], False)
        self.assertEqual(result["actionable_warm_demand"], False)

    def test_stale_closed_and_repost_evidence_is_not_actionable(self) -> None:
        names = {"stale request", "closed request", "repost without buyer context"}
        for case in load_cases():
            if case["name"] not in names:
                continue
            with self.subTest(case=case["name"]):
                result = classify_linkedin_intent(dict(case["record"]))
                self.assertEqual(result["disposition"], "reject")
                self.assertEqual(result["buyer_intent_confirmed"], False)
                self.assertEqual(result["actionable_warm_demand"], False)

    def test_cold_fit_is_never_converted_into_confirmed_warm_intent(self) -> None:
        case = next(case for case in load_cases() if case["name"] == "cold fit never becomes warm intent")
        result = classify_linkedin_intent(dict(case["record"]))
        self.assertEqual(result["cold_source_preserved"], True)
        self.assertEqual(result["original_source_classification_preserved"], True)
        self.assertEqual(result["buyer_intent_confirmed"], False)
        self.assertEqual(result["actionable_warm_demand"], False)
        self.assertEqual(result["disposition"], "research")

    def test_qualification_uses_structured_intent_and_fail_closed_queue_rules(self) -> None:
        cases = {str(case["name"]): case for case in load_cases()}

        direct = qualify_record(dict(cases["explicit vendor request"]["record"]))
        self.assertIn(direct["disposition"], {"priority_a", "priority_b"})
        self.assertEqual(direct["linkedin_intent"]["category"], "explicit_project_vendor_request")
        self.assertEqual(direct["buyer_intent_confirmed"], True)
        self.assertEqual(direct["external_action_automated"], False)

        unclear = qualify_record(dict(cases["unclear research"]["record"]))
        self.assertEqual(unclear["disposition"], "research")
        self.assertEqual(unclear["linkedin_intent"]["category"], "unclear_research")

        employee = qualify_record(dict(cases["employee hiring"]["record"]))
        self.assertEqual(employee["disposition"], "reject")
        self.assertEqual(employee["linkedin_intent"]["category"], "employee_hiring")

        stale = qualify_record(dict(cases["stale request"]["record"]))
        self.assertEqual(stale["disposition"], "reject")
        self.assertEqual(stale["buyer_intent_confirmed"], False)

        cold = qualify_record(dict(cases["cold fit never becomes warm intent"]["record"]))
        self.assertEqual(cold["disposition"], "research")
        self.assertEqual(cold["linkedin_intent"]["cold_source_preserved"], True)
        self.assertEqual(cold["buyer_intent_confirmed"], False)


if __name__ == "__main__":
    unittest.main()
