from __future__ import annotations

import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import uuid

from acquisition_v4.storage import (
    AtomicRecordStore,
    LOCAL_DATABASE_ENV,
    PostgresRecordStore,
    create_record_store,
)


class PostgresStorageTests(unittest.TestCase):
    def test_json_store_remains_default_without_explicit_database(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            with patch.dict(os.environ, {}, clear=False):
                os.environ.pop(LOCAL_DATABASE_ENV, None)
                store = create_record_store(Path(directory), "upwork")
            self.assertIsInstance(store, AtomicRecordStore)
            self.assertEqual(store.backend, "jsonl")

    @unittest.skipUnless(os.environ.get("TEST_POSTGRES_URL"), "TEST_POSTGRES_URL is required for PostgreSQL integration coverage")
    def test_postgres_imports_json_once_and_keeps_a_rollback_shadow(self) -> None:
        import psycopg

        database_url = str(os.environ["TEST_POSTGRES_URL"])
        source = f"test_{uuid.uuid4().hex}"
        first = {
            "dedupe_key": "fixture-key-1",
            "title": "Imported JSON opportunity",
            "source_url": "https://example.com/opportunity/1",
        }
        second = {
            "dedupe_key": "fixture-key-2",
            "title": "Database opportunity",
            "source_url": "https://example.com/opportunity/2",
        }

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            shadow = AtomicRecordStore(root, source)
            shadow.persist_records([first])
            shadow.persist_seen({"fixture-key-1"})
            shadow.persist_status({"ready": True, "received": 1, "storage_backend": "jsonl"})

            store = PostgresRecordStore(root, source, database_url)
            self.assertEqual(store.backend, "postgresql")
            self.assertEqual(store.load_records(), [first])
            self.assertEqual(store.load_seen(), {"fixture-key-1"})
            self.assertEqual(store.load_status()["received"], 1)

            store.persist_records([first, second])
            store.persist_seen({"fixture-key-1", "fixture-key-2"})
            store.persist_status({"ready": True, "received": 2, "storage_backend": "postgresql"})

            shadow_records = shadow.load_records()
            self.assertEqual([record["dedupe_key"] for record in shadow_records], ["fixture-key-1", "fixture-key-2"])
            self.assertEqual(shadow.load_seen(), {"fixture-key-1", "fixture-key-2"})
            self.assertEqual(shadow.load_status()["storage_backend"], "postgresql")

            shadow.persist_records([{"dedupe_key": "shadow-only", "title": "Must be replaced"}])
            restarted = PostgresRecordStore(root, source, database_url)
            self.assertEqual(
                [record["dedupe_key"] for record in restarted.load_records()],
                ["fixture-key-1", "fixture-key-2"],
            )
            self.assertNotIn("shadow-only", json.dumps(shadow.load_records()))

            with psycopg.connect(database_url) as connection:
                record_count = connection.execute(
                    "SELECT COUNT(*) FROM talenttrack_capture_records WHERE source = %s",
                    (source,),
                ).fetchone()[0]
                seen_count = connection.execute(
                    "SELECT COUNT(*) FROM talenttrack_capture_seen WHERE source = %s",
                    (source,),
                ).fetchone()[0]
                status = connection.execute(
                    "SELECT status FROM talenttrack_capture_status WHERE source = %s",
                    (source,),
                ).fetchone()[0]
                self.assertEqual(record_count, 2)
                self.assertEqual(seen_count, 2)
                self.assertEqual(status["storage_backend"], "postgresql")

                connection.execute("DELETE FROM talenttrack_capture_status WHERE source = %s", (source,))
                connection.execute("DELETE FROM talenttrack_capture_seen WHERE source = %s", (source,))
                connection.execute("DELETE FROM talenttrack_capture_records WHERE source = %s", (source,))

    def test_database_url_is_required_for_postgres_store(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(ValueError, "local PostgreSQL URL is required"):
                PostgresRecordStore(Path(directory), "upwork", "")


if __name__ == "__main__":
    unittest.main()
