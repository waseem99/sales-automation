from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Callable, Iterable, Protocol


LOCAL_DATABASE_ENV = "TALENTTRACK_LOCAL_DATABASE_URL"


def atomic_write_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    temporary.write_text(content, encoding="utf-8")
    os.replace(temporary, path)


def load_json(path: Path, default: object) -> object:
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return default


class RecordStore(Protocol):
    backend: str
    records_path: Path
    checkpoint_path: Path
    status_path: Path

    def load_records(self) -> list[dict[str, object]]: ...
    def load_status(self) -> dict[str, object]: ...
    def load_seen(self) -> set[str]: ...
    def persist_records(self, records: Iterable[dict[str, object]]) -> None: ...
    def persist_seen(self, seen: set[str]) -> None: ...
    def persist_status(self, status: dict[str, object]) -> None: ...
    def append_atomically(
        self,
        existing: list[dict[str, object]],
        accepted: list[dict[str, object]],
    ) -> None: ...


class AtomicRecordStore:
    backend = "jsonl"

    def __init__(self, root: Path, source: str) -> None:
        self.root = root / source
        self.records_path = self.root / "records.jsonl"
        self.checkpoint_path = self.root / "seen.json"
        self.status_path = self.root / "status.json"
        self.root.mkdir(parents=True, exist_ok=True)

    def load_records(self) -> list[dict[str, object]]:
        if not self.records_path.exists():
            return []
        records: list[dict[str, object]] = []
        for line in self.records_path.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            try:
                value = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(value, dict):
                records.append(value)
        return records

    def load_status(self) -> dict[str, object]:
        value = load_json(self.status_path, {})
        return value if isinstance(value, dict) else {}

    def load_seen(self) -> set[str]:
        value = load_json(self.checkpoint_path, [])
        seen = {str(item) for item in value} if isinstance(value, list) else set()
        for record in self.load_records():
            key = record.get("dedupe_key")
            if key:
                seen.add(str(key))
        return seen

    def persist_records(self, records: Iterable[dict[str, object]]) -> None:
        content = "".join(
            json.dumps(record, ensure_ascii=False, sort_keys=True) + "\n"
            for record in records
        )
        atomic_write_text(self.records_path, content)

    def persist_seen(self, seen: set[str]) -> None:
        atomic_write_text(
            self.checkpoint_path,
            json.dumps(sorted(seen), ensure_ascii=False, indent=2) + "\n",
        )

    def persist_status(self, status: dict[str, object]) -> None:
        atomic_write_text(
            self.status_path,
            json.dumps(status, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        )

    def append_atomically(
        self,
        existing: list[dict[str, object]],
        accepted: list[dict[str, object]],
    ) -> None:
        self.persist_records([*existing, *accepted])


class PostgresRecordStore:
    """PostgreSQL-primary capture store with a JSONL rollback shadow.

    The PostgreSQL URL is never written to health output or repository files. Existing
    JSONL records are imported only when the source table is empty. Every committed
    database write is mirrored to the historical JSON files so disabling the local
    database or rolling back the application cannot hide captured state.
    """

    backend = "postgresql"

    def __init__(
        self,
        root: Path,
        source: str,
        database_url: str,
        connection_factory: Callable[..., object] | None = None,
    ) -> None:
        if not database_url.strip():
            raise ValueError("A local PostgreSQL URL is required when PostgreSQL storage is enabled.")
        self.source = source
        self.database_url = database_url.strip()
        self.shadow = AtomicRecordStore(root, source)
        self.root = self.shadow.root
        self.records_path = self.shadow.records_path
        self.checkpoint_path = self.shadow.checkpoint_path
        self.status_path = self.shadow.status_path
        self._connection_factory = connection_factory
        self._jsonb_type: object | None = None
        self._load_driver()
        self._ensure_schema()
        self._reconcile_shadow_and_database()

    def _load_driver(self) -> None:
        if self._connection_factory is not None:
            return
        try:
            import psycopg
            from psycopg.types.json import Jsonb
        except ImportError as error:
            raise RuntimeError(
                'Local PostgreSQL is enabled but Psycopg is unavailable. Run START-HERE-TALENTTRACK again or install "psycopg[binary]".'
            ) from error
        self._connection_factory = psycopg.connect
        self._jsonb_type = Jsonb

    def _connect(self):
        if self._connection_factory is None:
            raise RuntimeError("PostgreSQL connection factory is unavailable.")
        return self._connection_factory(self.database_url, connect_timeout=5)

    def _jsonb(self, value: object) -> object:
        if self._jsonb_type is None:
            return json.dumps(value, ensure_ascii=False, sort_keys=True)
        return self._jsonb_type(value)  # type: ignore[operator]

    def _ensure_schema(self) -> None:
        with self._connect() as connection:
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS talenttrack_capture_records (
                    source TEXT NOT NULL,
                    dedupe_key TEXT NOT NULL,
                    record JSONB NOT NULL,
                    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    PRIMARY KEY (source, dedupe_key)
                )
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS talenttrack_capture_seen (
                    source TEXT NOT NULL,
                    dedupe_key TEXT NOT NULL,
                    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    PRIMARY KEY (source, dedupe_key)
                )
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS talenttrack_capture_status (
                    source TEXT PRIMARY KEY,
                    status JSONB NOT NULL,
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
                """
            )
            connection.execute(
                "CREATE INDEX IF NOT EXISTS talenttrack_capture_records_updated_idx ON talenttrack_capture_records (source, updated_at DESC)"
            )

    def _reconcile_shadow_and_database(self) -> None:
        database_records = self._load_database_records()
        shadow_records = self.shadow.load_records()
        if not database_records and shadow_records:
            self.persist_records(shadow_records)
            self.persist_seen(self.shadow.load_seen())
            shadow_status = self.shadow.load_status()
            if shadow_status:
                self.persist_status(shadow_status)
            return
        if database_records:
            self.shadow.persist_records(database_records)
            self.shadow.persist_seen(self._load_database_seen())
            database_status = self._load_database_status()
            if database_status:
                self.shadow.persist_status(database_status)

    def _load_database_records(self) -> list[dict[str, object]]:
        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT record
                FROM talenttrack_capture_records
                WHERE source = %s
                ORDER BY first_seen_at ASC, dedupe_key ASC
                """,
                (self.source,),
            ).fetchall()
        return [value for row in rows if (value := _as_mapping(row[0])) is not None]

    def _load_database_seen(self) -> set[str]:
        with self._connect() as connection:
            rows = connection.execute(
                "SELECT dedupe_key FROM talenttrack_capture_seen WHERE source = %s",
                (self.source,),
            ).fetchall()
        seen = {str(row[0]) for row in rows if row and row[0]}
        for record in self._load_database_records():
            key = record.get("dedupe_key")
            if key:
                seen.add(str(key))
        return seen

    def _load_database_status(self) -> dict[str, object]:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT status FROM talenttrack_capture_status WHERE source = %s",
                (self.source,),
            ).fetchone()
        return _as_mapping(row[0]) if row else {}

    def load_records(self) -> list[dict[str, object]]:
        return self._load_database_records()

    def load_status(self) -> dict[str, object]:
        return self._load_database_status()

    def load_seen(self) -> set[str]:
        return self._load_database_seen()

    def persist_records(self, records: Iterable[dict[str, object]]) -> None:
        materialized = [dict(record) for record in records]
        rows: list[tuple[str, str, object]] = []
        for record in materialized:
            key = str(record.get("dedupe_key", "")).strip()
            if not key:
                raise ValueError("Every PostgreSQL capture record must include a dedupe_key.")
            rows.append((self.source, key, self._jsonb(record)))
        if rows:
            with self._connect() as connection:
                connection.executemany(
                    """
                    INSERT INTO talenttrack_capture_records (source, dedupe_key, record, first_seen_at, updated_at)
                    VALUES (%s, %s, %s, NOW(), NOW())
                    ON CONFLICT (source, dedupe_key) DO UPDATE SET
                        record = EXCLUDED.record,
                        updated_at = NOW()
                    """,
                    rows,
                )
        self.shadow.persist_records(materialized)

    def persist_seen(self, seen: set[str]) -> None:
        rows = [(self.source, key) for key in sorted({item.strip() for item in seen if item.strip()})]
        if rows:
            with self._connect() as connection:
                connection.executemany(
                    """
                    INSERT INTO talenttrack_capture_seen (source, dedupe_key, first_seen_at)
                    VALUES (%s, %s, NOW())
                    ON CONFLICT (source, dedupe_key) DO NOTHING
                    """,
                    rows,
                )
        self.shadow.persist_seen(seen)

    def persist_status(self, status: dict[str, object]) -> None:
        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO talenttrack_capture_status (source, status, updated_at)
                VALUES (%s, %s, NOW())
                ON CONFLICT (source) DO UPDATE SET
                    status = EXCLUDED.status,
                    updated_at = NOW()
                """,
                (self.source, self._jsonb(status)),
            )
        self.shadow.persist_status(status)

    def append_atomically(
        self,
        existing: list[dict[str, object]],
        accepted: list[dict[str, object]],
    ) -> None:
        self.persist_records([*existing, *accepted])


def create_record_store(root: Path, source: str) -> RecordStore:
    database_url = os.environ.get(LOCAL_DATABASE_ENV, "").strip()
    if database_url:
        return PostgresRecordStore(root, source, database_url)
    return AtomicRecordStore(root, source)


def _as_mapping(value: object) -> dict[str, object] | None:
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            return None
        return parsed if isinstance(parsed, dict) else None
    return None
