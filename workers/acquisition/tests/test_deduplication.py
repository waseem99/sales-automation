from unittest import TestCase

from acquisition.deduplication import build_dedupe_key, normalize_source_url
from acquisition.models import SourceEvidence


class DeduplicationTest(TestCase):
    def evidence(self, source_id: str, url: str) -> SourceEvidence:
        return SourceEvidence(
            source="Upwork",
            source_id=source_id,
            source_url=url,
            captured_at="2026-07-16T00:00:00Z",
            title="AI SaaS Build",
            body="Build an AI SaaS platform",
            segment="ai-automation",
        )

    def test_source_identifier_is_stable(self) -> None:
        left = build_dedupe_key(self.evidence(" JOB-123 ", "https://example.test/a?x=1"))
        right = build_dedupe_key(self.evidence("job-123", "https://example.test/b"))
        self.assertEqual(left, right)

    def test_url_normalization_drops_tracking(self) -> None:
        self.assertEqual(
            normalize_source_url("HTTPS://Example.Test/jobs/1/?utm_source=x#details"),
            "https://example.test/jobs/1",
        )
