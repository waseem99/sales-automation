from __future__ import annotations

import unittest

from acquisition_v4.qualification import qualify_record


class QualificationTests(unittest.TestCase):
    def test_strong_upwork_job_is_priority_a(self) -> None:
        decision = qualify_record({
            "source": "upwork",
            "canonical_url": "https://www.upwork.com/jobs/~strong",
            "source_native_id": "~strong",
            "title": "Build a private RAG SaaS platform",
            "body": "We need an experienced development team to build a secure private RAG SaaS platform and admin portal.",
            "posted_age": "2 hours ago",
            "page_identity": "Waseem AI search",
            "commercial_evidence": {
                "fixed_budget_usd": 12000,
                "payment_verified": True,
                "client_spend_usd": 50000,
                "hire_rate_percent": 75,
                "proposals": "Less than 5 proposals",
            },
            "raw_evidence": {"skills": ["Python", "RAG", "SaaS"]},
        })
        self.assertEqual(decision["disposition"], "priority_a")
        self.assertGreaterEqual(decision["total_score"], 75)
        self.assertIn("ai_automation", decision["service_lanes"])

    def test_missing_budget_credible_upwork_job_remains_reviewable(self) -> None:
        decision = qualify_record({
            "source": "upwork",
            "canonical_url": "https://www.upwork.com/jobs/~review",
            "source_native_id": "~review",
            "title": "React Native mobile app development",
            "body": "We require a React Native team to complete a customer mobile app and API integration.",
            "posted_age": "1 hour ago",
            "page_identity": "Waseem AI search",
            "commercial_evidence": {
                "payment_verified": True,
                "client_spend_usd": 75000,
                "hire_rate_percent": 80,
                "proposals": "5 to 10 proposals",
            },
            "raw_evidence": {"skills": ["React Native", "API"]},
        })
        self.assertEqual(decision["disposition"], "priority_b")
        self.assertIn("budget or hourly range", decision["missing_evidence"])

    def test_low_value_upwork_job_is_rejected(self) -> None:
        decision = qualify_record({
            "source": "upwork",
            "canonical_url": "https://www.upwork.com/jobs/~low",
            "source_native_id": "~low",
            "title": "Build a complete SaaS platform",
            "body": "Need a development team for a complete SaaS web platform with admin, payments and mobile apps.",
            "posted_age": "1 hour ago",
            "page_identity": "Waseem AI search",
            "commercial_evidence": {"fixed_budget_usd": 150},
            "raw_evidence": {},
        })
        self.assertEqual(decision["disposition"], "reject")
        self.assertIn("fixed-price value below operating minimum", decision["risk_reasons"])

    def test_direct_linkedin_requirement_is_priority_a(self) -> None:
        decision = qualify_record({
            "source": "linkedin",
            "canonical_url": "https://www.linkedin.com/feed/update/urn:li:activity:123",
            "source_native_id": "urn:li:activity:123",
            "title": "Looking for a digital marketing agency",
            "body": "We are looking for a digital marketing agency for social media, content and paid ads. Please send a proposal.",
            "author_name": "Marketing Director",
            "author_profile_url": "https://www.linkedin.com/in/marketing-director",
            "author_headline": "Marketing Director at Example Company",
            "posted_age": "2h",
            "page_identity": "digital marketing agency",
            "commercial_evidence": {
                "signal_type": "direct_service_requirement",
                "service_lanes": ["digital_growth"],
                "intent_phrases": ["looking for"],
                "contact_routes": ["proposal"],
            },
            "raw_evidence": {},
        })
        self.assertEqual(decision["disposition"], "priority_a")
        self.assertIn("digital_growth", decision["service_lanes"])

    def test_linkedin_without_access_route_is_priority_b(self) -> None:
        decision = qualify_record({
            "source": "linkedin",
            "canonical_url": "https://www.linkedin.com/feed/update/urn:li:activity:456",
            "source_native_id": "urn:li:activity:456",
            "title": "Seeking AI automation partner",
            "body": "We are seeking an AI automation partner to build a private RAG workflow for our operations team.",
            "author_name": "Operations Lead",
            "author_profile_url": "https://www.linkedin.com/in/operations-lead",
            "posted_age": "1 day ago",
            "page_identity": "AI automation partner",
            "commercial_evidence": {
                "signal_type": "direct_service_requirement",
                "service_lanes": ["ai_automation"],
                "intent_phrases": ["seeking"],
                "contact_routes": [],
            },
            "raw_evidence": {},
        })
        self.assertEqual(decision["disposition"], "priority_b")
        self.assertIn("clear response route", decision["missing_evidence"])

    def test_prohibited_work_is_rejected(self) -> None:
        decision = qualify_record({
            "source": "upwork",
            "title": "Take my exam",
            "body": "I need someone to take my exam and complete my assignment.",
            "commercial_evidence": {"fixed_budget_usd": 10000},
            "raw_evidence": {},
        })
        self.assertEqual(decision["disposition"], "reject")
        self.assertIn("prohibited or deceptive work", decision["risk_reasons"])


if __name__ == "__main__":
    unittest.main()
