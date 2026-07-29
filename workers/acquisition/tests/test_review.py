from __future__ import annotations

import json
from pathlib import Path
import tempfile
import unittest

from acquisition_v4.review import write_review_outputs


class ReviewTests(unittest.TestCase):
    def test_combined_queue_prioritizes_a_and_writes_clickable_html(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "upwork").mkdir()
            (root / "linkedin").mkdir()
            upwork = {
                "source": "upwork", "title": "B job", "canonical_url": "https://www.upwork.com/jobs/~b",
                "qualification": {"disposition": "priority_b", "total_score": 65, "service_route": "software_product", "recommended_next_action": "Review."},
            }
            linkedin = {
                "source": "linkedin", "title": "A lead", "canonical_url": "https://www.linkedin.com/feed/update/urn:li:activity:1",
                "author_name": "Buyer", "qualification": {"disposition": "priority_a", "total_score": 90, "service_route": "digital_growth", "recommended_next_action": "Respond."},
            }
            (root / "upwork" / "records.jsonl").write_text(json.dumps(upwork) + "\n", encoding="utf-8")
            (root / "linkedin" / "records.jsonl").write_text(json.dumps(linkedin) + "\n", encoding="utf-8")
            output = write_review_outputs(root)
            queue = json.loads(Path(output["json_path"]).read_text(encoding="utf-8"))
            self.assertEqual(queue["records"][0]["title"], "A lead")
            self.assertEqual(queue["summary"]["priority_a"], 1)
            html = Path(output["html_path"]).read_text(encoding="utf-8")
            self.assertIn("https://www.linkedin.com/feed/update/urn:li:activity:1", html)
            self.assertIn("Every external action remains manual", html)


if __name__ == "__main__":
    unittest.main()
