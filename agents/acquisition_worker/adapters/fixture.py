from __future__ import annotations

from html.parser import HTMLParser
from pathlib import Path
from typing import Any

from acquisition_worker.models import Opportunity


class _OpportunityParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.records: list[dict[str, Any]] = []
        self._record: dict[str, Any] | None = None
        self._field: str | None = None
        self._buffer: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = dict(attrs)
        if tag == "article" and "data-opportunity" in values:
            self._record = {
                "external_id": values.get("data-id"),
                "source_url": values.get("data-url"),
                "company_name": values.get("data-company"),
                "country": values.get("data-country"),
                "budget_signal": values.get("data-budget"),
            }
            return
        if self._record is None:
            return
        if tag in {"h1", "h2", "h3"}:
            self._field = "title"
            self._buffer = []
        elif tag == "p" and values.get("data-field") == "description":
            self._field = "description"
            self._buffer = []

    def handle_data(self, data: str) -> None:
        if self._field:
            self._buffer.append(data)

    def handle_endtag(self, tag: str) -> None:
        if self._record is None:
            return
        if self._field and tag in {"h1", "h2", "h3", "p"}:
            self._record[self._field] = " ".join("".join(self._buffer).split())
            self._field = None
            self._buffer = []
        if tag == "article":
            self.records.append(self._record)
            self._record = None


class FixtureHtmlAdapter:
    def __init__(self, path: str | Path, source: str, segment: str) -> None:
        self.path = Path(path)
        self.source = source
        self.segment = segment

    def collect(self) -> list[Opportunity]:
        parser = _OpportunityParser()
        parser.feed(self.path.read_text(encoding="utf-8"))
        values: list[Opportunity] = []
        for record in parser.records:
            values.append(
                Opportunity(
                    source=self.source,
                    title=str(record.get("title") or ""),
                    description=str(record.get("description") or ""),
                    search_segment=self.segment,
                    source_url=_optional(record.get("source_url")),
                    external_id=_optional(record.get("external_id")),
                    company_name=_optional(record.get("company_name")),
                    country=_optional(record.get("country")),
                    budget_signal=_optional(record.get("budget_signal")),
                    metadata={"adapter": "fixture_html"},
                )
            )
        return values


def _optional(value: Any) -> str | None:
    return value.strip() if isinstance(value, str) and value.strip() else None
