from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase

from acquisition.adapters.fixture import FixtureHtmlAdapter
from acquisition.checkpoints import CheckpointStore
from acquisition.cli import run_qualification_file
from acquisition.runner import AcquisitionRunner
from acquisition.storage import JsonlSink

ROOT = Path(__file__).parents[1]


class QualificationCliTest(TestCase):
    def test_jsonl_qualification_output(self) -> None:
        with TemporaryDirectory() as directory:
            base = Path(directory)
            raw = base / "raw.jsonl"
            AcquisitionRunner(
                adapter=FixtureHtmlAdapter(ROOT / "fixtures" / "opportunities.html"),
                sink=JsonlSink(raw),
                checkpoints=CheckpointStore(base / "checkpoint.json"),
                run_key="qualification-cli",
            ).run(limit=10, enabled_segments={"software-saas", "ai-automation"})
            output = base / "qualified.jsonl"
            code = run_qualification_file(raw, ROOT / "config" / "qualification.example.toml", output)
            self.assertEqual(code, 0)
            lines = output.read_text(encoding="utf-8").splitlines()
            self.assertEqual(len(lines), 2)
            self.assertTrue(all("configuration_version" in line for line in lines))
