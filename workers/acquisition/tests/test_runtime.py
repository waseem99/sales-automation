from __future__ import annotations

import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from acquisition_v4.models import canonical_source_url
from acquisition_v4.runtime import CollectorState


def upwork_payload() -> dict[str, object]:
    return {
        "source": "upwork",
        "source_subtype": "saved_search_card",
        "parser_version": "upwork-fixture-1",
        "page_url": "https://www.upwork.com/nx/find-work/9652811",
        "page_identity": "AI + Fullstack AI 16 July 2026",
        "external_action_performed": False,
        "records": [
            {
                "source_url": "https://www.upwork.com/jobs/~0123456789abcdef?source=rss",
                "source_native_id": "~0123456789abcdef",
                "title": "Build a private RAG workflow",
                "body": "We need an experienced team to build a secure private RAG workflow and admin portal.",
                "commercial_evidence": {"fixed_budget_usd": 12000, "payment_verified": True},
                "raw_evidence": {"proposal_range": "Less than 5"},
            }
        ],
    }


def linkedin_payload() -> dict[str, object]:
    return {
        "source": "linkedin",
        "source_subtype": "content_search_post",
        "parser_version": "linkedin-fixture-1",
        "page_url": "https://www.linkedin.com/search/results/content/?keywords=agency",
        "page_identity": "agency requirement",
        "external_action_performed": False,
        "records": [
            {
                "source_url": "https://www.linkedin.com/posts/jane-doe_we-are-looking-for-a-digital-marketing-agency-activity-1234567890123456789-abcd?utm_source=share",
                "source_native_id": "urn:li:activity:1234567890123456789",
                "title": "Digital marketing agency requirement",
                "body": "We are looking for a digital marketing agency for social media, content and performance campaigns.",
                "author": {
                    "name": "Jane Doe",
                    "profile_url": "https://www.linkedin.com/posts/jane-doe_example-activity-1234567890123456789-abcd",
                    "headline": "Marketing Director",
                    "company": "Example Company",
                },
                "posted_age": "2h",
                "raw_evidence": {"request_phrase": "looking for a digital marketing agency"},
            }
        ],
    }


class RuntimeTests(unittest.TestCase):
    def test_url_normalization_removes_tracking(self) -> None:
        self.assertEqual(
            canonical_source_url("upwork", "https://upwork.com/jobs/~abc/?foo=bar"),
            "https://www.upwork.com/jobs/~abc",
        )
        self.assertEqual(
            canonical_source_url(
                "linkedin",
                "https://linkedin.com/feed/update/urn:li:activity:123/?utm_source=x",
            ),
            "https://www.linkedin.com/feed/update/urn:li:activity:123",
        )

    def test_source_isolation_and_restart_safe_dedupe(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            upwork = CollectorState("upwork", root, "test")
            first = upwork.capture(upwork_payload())
            self.assertEqual(first["accepted"], 1)
            self.assertEqual(first["duplicates"], 0)

            duplicate = upwork.capture(upwork_payload())
            self.assertEqual(duplicate["accepted"], 0)
            self.assertEqual(duplicate["duplicates"], 1)
            last_capture_at = upwork.health()["last_capture_at"]

            restarted = CollectorState("upwork", root, "test")
            self.assertEqual(restarted.health()["last_capture_at"], last_capture_at)
            self.assertEqual(restarted.health()["duplicates"], 1)
            after_restart = restarted.capture(upwork_payload())
            self.assertEqual(after_restart["duplicates"], 1)
            self.assertEqual(restarted.health()["duplicates"], 2)

            linkedin = CollectorState("linkedin", root, "test")
            linked = linkedin.capture(linkedin_payload())
            self.assertEqual(linked["accepted"], 1)
            self.assertEqual(len(linkedin.records), 1)
            self.assertEqual(len(restarted.records), 1)

    def test_wrong_source_and_external_action_are_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            state = CollectorState("upwork", Path(directory), "test")
            wrong = upwork_payload()
            wrong["source"] = "linkedin"
            with self.assertRaisesRegex(ValueError, "only upwork"):
                state.capture(wrong)

            unsafe = upwork_payload()
            unsafe["external_action_performed"] = True
            with self.assertRaisesRegex(ValueError, "external action"):
                state.capture(unsafe)

    def test_atomic_failure_does_not_advance_seen_checkpoint(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            state = CollectorState("upwork", Path(directory), "test")
            original_seen = set(state.seen)
            with patch.object(state.store, "persist_records", side_effect=OSError("disk full")):
                with self.assertRaises(OSError):
                    state.capture(upwork_payload())
            self.assertEqual(state.seen, original_seen)
            self.assertFalse(state.store.checkpoint_path.exists())

    def test_health_contains_no_capture_body(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            state = CollectorState("linkedin", Path(directory), "test")
            state.capture(linkedin_payload())
            serialized = json.dumps(state.health())
            self.assertNotIn("digital marketing agency", serialized)
            self.assertFalse(state.health()["external_actions_enabled"])


if __name__ == "__main__":
    unittest.main()
