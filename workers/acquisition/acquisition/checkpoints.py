from __future__ import annotations

from dataclasses import dataclass
import json
import os
from pathlib import Path
from tempfile import NamedTemporaryFile
from typing import Any


@dataclass(slots=True)
class CheckpointState:
    cursor: str | None
    seen_keys: set[str]


class CheckpointStore:
    def __init__(self, path: Path) -> None:
        self.path = path

    def load(self, run_key: str) -> CheckpointState:
        payload = self._read_all().get(run_key, {})
        seen = payload.get("seen_keys", []) if isinstance(payload, dict) else []
        cursor = payload.get("cursor") if isinstance(payload, dict) else None
        return CheckpointState(
            cursor=str(cursor) if cursor is not None else None,
            seen_keys={str(item) for item in seen},
        )

    def save(self, run_key: str, state: CheckpointState) -> None:
        payload = self._read_all()
        payload[run_key] = {
            "cursor": state.cursor,
            "seen_keys": sorted(state.seen_keys),
        }
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with NamedTemporaryFile("w", encoding="utf-8", dir=self.path.parent, delete=False) as handle:
            json.dump(payload, handle, indent=2, sort_keys=True)
            handle.write("\n")
            temp_name = handle.name
        os.replace(temp_name, self.path)

    def _read_all(self) -> dict[str, Any]:
        if not self.path.exists():
            return {}
        with self.path.open("r", encoding="utf-8") as handle:
            value = json.load(handle)
        if not isinstance(value, dict):
            raise ValueError("Checkpoint file must contain a JSON object")
        return value
