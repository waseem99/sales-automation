from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from acquisition_worker.adapters import FixtureHtmlAdapter
from acquisition_worker.checkpoint import Checkpoint
from acquisition_worker.runner import run_collection


class FixtureRunnerTests(unittest.TestCase):
    def test_fixture_dedup_and_resume(self) -> None:
        fixture = Path(__file__).parents[1] / "fixtures" / "sample_opportunities.html"
        adapter = FixtureHtmlAdapter(fixture, "upwork", "test-pilot")
        with tempfile.TemporaryDirectory() as directory:
            checkpoint_path = Path(directory) / "checkpoint.json"
            output_path = Path(directory) / "output.jsonl"
            first = run_collection(
                adapter.collect(),
                Checkpoint.load(checkpoint_path),
                str(output_path),
            )
            self.assertEqual(first.reviewed, 2)
            self.assertEqual(first.written, 2)
            self.assertEqual(first.duplicates, 0)
            second = run_collection(
                adapter.collect(),
                Checkpoint.load(checkpoint_path),
                str(output_path),
            )
            self.assertEqual(second.reviewed, 2)
            self.assertEqual(second.written, 0)
            self.assertEqual(second.duplicates, 2)
            rows = [
                json.loads(line)
                for line in output_path.read_text(encoding="utf-8").splitlines()
            ]
            self.assertEqual(len(rows), 2)
            self.assertTrue(all(row["source_url"].startswith("https://") for row in rows))


if __name__ == "__main__":
    unittest.main()
