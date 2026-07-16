from __future__ import annotations

import unittest

from acquisition_worker.models import Opportunity


class OpportunityTests(unittest.TestCase):
    def test_dedupe_prefers_external_id(self) -> None:
        first = Opportunity(
            source="upwork",
            external_id="job-1",
            title="One",
            description="Description",
            search_segment="pilot",
            source_url="https://www.upwork.com/jobs/job-1?x=1#fragment",
        )
        second = Opportunity(
            source="upwork",
            external_id="job-1",
            title="Changed title",
            description="Changed",
            search_segment="pilot",
            source_url="https://www.upwork.com/jobs/other",
        )
        self.assertEqual(first.dedupe_key, second.dedupe_key)

    def test_external_action_is_not_part_of_model(self) -> None:
        value = Opportunity(
            source="upwork",
            title="One",
            description="Description",
            search_segment="pilot",
        ).as_dict()
        self.assertNotIn("proposal", value)
        self.assertNotIn("message", value)
        self.assertNotIn("send", value)


if __name__ == "__main__":
    unittest.main()
