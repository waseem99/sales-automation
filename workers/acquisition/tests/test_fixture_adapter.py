from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase

from acquisition.adapters.fixture import FixtureHtmlAdapter
from acquisition.checkpoints import CheckpointStore
from acquisition.runner import AcquisitionRunner
from acquisition.storage import JsonlSink


FIXTURE = Path(__file__).parents[1] / "fixtures" / "opportunities.html"


class FixtureAdapterTest(TestCase):
    def test_enabled_segments_and_resume(self) -> None:
        with TemporaryDirectory() as directory:
            root = Path(directory)
            runner = AcquisitionRunner(
                adapter=FixtureHtmlAdapter(FIXTURE),
                sink=JsonlSink(root / "output.jsonl"),
                checkpoints=CheckpointStore(root / "checkpoint.json"),
                run_key="fixture",
            )
            first = runner.run(limit=10, enabled_segments={"software-saas", "ai-automation"})
            second = runner.run(limit=10, enabled_segments={"software-saas", "ai-automation"})
            self.assertEqual(first.extracted, 2)
            self.assertEqual(first.duplicates, 0)
            self.assertEqual(second.extracted, 0)
            self.assertEqual(second.duplicates, 2)
            self.assertEqual(len((root / "output.jsonl").read_text(encoding="utf-8").splitlines()), 2)
