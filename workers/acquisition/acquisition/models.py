from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from typing import Any


def utc_now_iso() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


@dataclass(frozen=True, slots=True)
class SourceEvidence:
    source: str
    source_id: str
    source_url: str
    captured_at: str
    title: str
    body: str
    segment: str
    attributes: dict[str, Any] = field(default_factory=dict)

    def validate(self) -> None:
        required = {
            "source": self.source,
            "source_id": self.source_id,
            "source_url": self.source_url,
            "captured_at": self.captured_at,
            "title": self.title,
            "body": self.body,
            "segment": self.segment,
        }
        missing = [name for name, value in required.items() if not str(value).strip()]
        if missing:
            raise ValueError(f"Missing required evidence fields: {', '.join(sorted(missing))}")
        if not self.source_url.startswith(("https://", "http://", "fixture://")):
            raise ValueError("source_url must be an HTTP(S) or fixture URL")


@dataclass(frozen=True, slots=True)
class OpportunityRecord:
    dedupe_key: str
    evidence: SourceEvidence
    disposition: str = "research"
    schema_version: str = "acquisition-opportunity.v1"

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(slots=True)
class RunSummary:
    reviewed: int = 0
    extracted: int = 0
    rejected: int = 0
    duplicates: int = 0
    failed: int = 0
    ingested: int = 0
    started_at: str = field(default_factory=utc_now_iso)
    completed_at: str | None = None

    def finish(self) -> None:
        self.completed_at = utc_now_iso()

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)
