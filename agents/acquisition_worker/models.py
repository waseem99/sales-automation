from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from hashlib import sha256
from typing import Any
from urllib.parse import urlsplit, urlunsplit


_ALLOWED_SOURCES = {"upwork", "linkedin", "sales_navigator", "public_web", "manual"}


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def normalize_url(value: str | None) -> str | None:
    if not value:
        return None
    text = value.strip()
    if not text:
        return None
    parsed = urlsplit(text)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError("source_url must be an absolute http(s) URL")
    return urlunsplit(
        (
            parsed.scheme.lower(),
            parsed.netloc.lower(),
            parsed.path.rstrip("/") or "/",
            parsed.query,
            "",
        )
    )


@dataclass(frozen=True, slots=True)
class Opportunity:
    source: str
    title: str
    description: str
    search_segment: str
    source_url: str | None = None
    external_id: str | None = None
    company_name: str | None = None
    country: str | None = None
    budget_signal: str | None = None
    captured_at: str = field(default_factory=utc_now)
    metadata: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if self.source not in _ALLOWED_SOURCES:
            raise ValueError(f"unsupported source: {self.source}")
        if not self.title.strip():
            raise ValueError("title is required")
        if not self.description.strip():
            raise ValueError("description is required")
        if not self.search_segment.strip():
            raise ValueError("search_segment is required")
        object.__setattr__(self, "title", self.title.strip())
        object.__setattr__(self, "description", self.description.strip())
        object.__setattr__(self, "search_segment", self.search_segment.strip())
        object.__setattr__(self, "source_url", normalize_url(self.source_url))
        object.__setattr__(self, "external_id", _clean(self.external_id))
        object.__setattr__(self, "company_name", _clean(self.company_name))
        object.__setattr__(self, "country", _clean(self.country))
        object.__setattr__(self, "budget_signal", _clean(self.budget_signal))

    @property
    def dedupe_key(self) -> str:
        identity = self.external_id or self.source_url or self.title.casefold()
        payload = f"{self.source}|{identity}".encode("utf-8")
        return sha256(payload).hexdigest()

    def as_dict(self) -> dict[str, Any]:
        value = asdict(self)
        value["dedupe_key"] = self.dedupe_key
        return value

    def intake_content(self) -> str:
        lines = [
            f"Job: {self.title}",
            self.source_url or "",
            self.description,
        ]
        if self.company_name:
            lines.append(f"Company: {self.company_name}")
        if self.country:
            lines.append(f"Country: {self.country}")
        if self.budget_signal:
            lines.append(f"Budget: {self.budget_signal}")
        lines.append(f"Search segment: {self.search_segment}")
        return "\n".join(line for line in lines if line)


@dataclass(slots=True)
class RunSummary:
    reviewed: int = 0
    extracted: int = 0
    qualified: int = 0
    rejected: int = 0
    duplicates: int = 0
    failed: int = 0
    written: int = 0
    ingested: int = 0

    def as_dict(self) -> dict[str, int]:
        return asdict(self)


def _clean(value: str | None) -> str | None:
    if value is None:
        return None
    text = value.strip()
    return text or None
