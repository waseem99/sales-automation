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

    @classmethod
    def from_dict(cls, value: dict[str, Any]) -> "OpportunityRecord":
        evidence_value = value.get("evidence")
        if not isinstance(evidence_value, dict):
            raise ValueError("Opportunity record requires an evidence object")
        evidence = SourceEvidence(
            source=str(evidence_value.get("source", "")),
            source_id=str(evidence_value.get("source_id", "")),
            source_url=str(evidence_value.get("source_url", "")),
            captured_at=str(evidence_value.get("captured_at", "")),
            title=str(evidence_value.get("title", "")),
            body=str(evidence_value.get("body", "")),
            segment=str(evidence_value.get("segment", "")),
            attributes=dict(evidence_value.get("attributes", {})) if isinstance(evidence_value.get("attributes", {}), dict) else {},
        )
        evidence.validate()
        return cls(
            dedupe_key=str(value.get("dedupe_key", "")),
            evidence=evidence,
            disposition=str(value.get("disposition", "research")),
            schema_version=str(value.get("schema_version", "acquisition-opportunity.v1")),
        )


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
