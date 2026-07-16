from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase

from acquisition.checkpoints import CheckpointState, CheckpointStore


class CheckpointStoreTest(TestCase):
    def test_atomic_round_trip_and_resume(self) -> None:
        with TemporaryDirectory() as directory:
            store = CheckpointStore(Path(directory) / "checkpoint.json")
            state = CheckpointState(cursor="job-2", seen_keys={"b", "a"})
            store.save("upwork-ai", state)
            restored = store.load("upwork-ai")
            self.assertEqual(restored.cursor, "job-2")
            self.assertEqual(restored.seen_keys, {"a", "b"})
