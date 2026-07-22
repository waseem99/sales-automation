from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Iterable

from .models import NormalizedRecord


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


class AtomicRecordStore:
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

    def append_atomically(self, existing: list[dict[str, object]], accepted: list[NormalizedRecord]) -> None:
        combined = [*existing, *(record.as_dict() for record in accepted)]
        self.persist_records(combined)
