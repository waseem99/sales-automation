from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from pathlib import Path
from tempfile import NamedTemporaryFile
from typing import Any


@dataclass(slots=True)
class Checkpoint:
    path: Path
    seen_keys: set[str] = field(default_factory=set)
    cursors: dict[str, str] = field(default_factory=dict)

    @classmethod
    def load(cls, path: str | Path) -> "Checkpoint":
        target = Path(path)
        if not target.exists():
            return cls(path=target)
        value = json.loads(target.read_text(encoding="utf-8"))
        if not isinstance(value, dict):
            raise ValueError("checkpoint must contain a JSON object")
        seen = value.get("seen_keys", [])
        cursors = value.get("cursors", {})
        if not isinstance(seen, list) or not all(isinstance(item, str) for item in seen):
            raise ValueError("checkpoint seen_keys is invalid")
        if not isinstance(cursors, dict) or not all(
            isinstance(key, str) and isinstance(item, str) for key, item in cursors.items()
        ):
            raise ValueError("checkpoint cursors is invalid")
        return cls(path=target, seen_keys=set(seen), cursors=dict(cursors))

    def contains(self, key: str) -> bool:
        return key in self.seen_keys

    def mark_seen(self, key: str) -> None:
        self.seen_keys.add(key)

    def set_cursor(self, name: str, value: str) -> None:
        self.cursors[name] = value

    def save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        payload: dict[str, Any] = {
            "version": 1,
            "seen_keys": sorted(self.seen_keys),
            "cursors": dict(sorted(self.cursors.items())),
        }
        with NamedTemporaryFile(
            "w",
            encoding="utf-8",
            dir=self.path.parent,
            delete=False,
        ) as handle:
            json.dump(payload, handle, indent=2, sort_keys=True)
            handle.write("\n")
            temporary = Path(handle.name)
        os.replace(temporary, self.path)
