from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import tomllib


@dataclass(frozen=True, slots=True)
class SegmentConfig:
    id: str
    enabled: bool
    keywords: tuple[str, ...]
    excluded_keywords: tuple[str, ...]
    minimum_budget_usd: int | None = None


@dataclass(frozen=True, slots=True)
class WorkerConfig:
    worker_name: str
    max_items: int
    request_delay_seconds: float
    segments: tuple[SegmentConfig, ...]

    def enabled_segment_ids(self) -> set[str]:
        return {segment.id for segment in self.segments if segment.enabled}


def load_worker_config(path: Path) -> WorkerConfig:
    with path.open("rb") as handle:
        raw = tomllib.load(handle)
    worker = raw.get("worker", {})
    segments_raw = raw.get("segments", [])
    segments = tuple(
        SegmentConfig(
            id=_required_text(item, "id"),
            enabled=bool(item.get("enabled", True)),
            keywords=tuple(_text_list(item.get("keywords", []))),
            excluded_keywords=tuple(_text_list(item.get("excluded_keywords", []))),
            minimum_budget_usd=_optional_positive_int(item.get("minimum_budget_usd")),
        )
        for item in segments_raw
    )
    if not segments:
        raise ValueError("At least one acquisition segment is required")
    return WorkerConfig(
        worker_name=_required_text(worker, "name"),
        max_items=_positive_int(worker.get("max_items", 100), "worker.max_items"),
        request_delay_seconds=_non_negative_float(worker.get("request_delay_seconds", 2.0), "worker.request_delay_seconds"),
        segments=segments,
    )


def _required_text(value: dict[str, object], key: str) -> str:
    text = str(value.get(key, "")).strip()
    if not text:
        raise ValueError(f"{key} is required")
    return text


def _text_list(value: object) -> list[str]:
    if not isinstance(value, list):
        raise ValueError("Expected a list of strings")
    return [str(item).strip() for item in value if str(item).strip()]


def _positive_int(value: object, name: str) -> int:
    parsed = int(value)
    if parsed <= 0:
        raise ValueError(f"{name} must be positive")
    return parsed


def _optional_positive_int(value: object) -> int | None:
    if value is None:
        return None
    return _positive_int(value, "minimum_budget_usd")


def _non_negative_float(value: object, name: str) -> float:
    parsed = float(value)
    if parsed < 0:
        raise ValueError(f"{name} must be non-negative")
    return parsed
