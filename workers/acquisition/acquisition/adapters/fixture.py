from __future__ import annotations

from html.parser import HTMLParser
from pathlib import Path
from typing import Iterable

from ..models import SourceEvidence, utc_now_iso


class _FixtureParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.records: list[dict[str, str]] = []
        self.current: dict[str, str] | None = None
        self.capture: str | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attributes = {name: value or "" for name, value in attrs}
        if tag == "article" and attributes.get("data-opportunity-id"):
            self.current = {
                "source_id": attributes.get("data-opportunity-id", ""),
                "source_url": attributes.get("data-source-url", ""),
                "segment": attributes.get("data-segment", ""),
                "budget_usd": attributes.get("data-budget-usd", ""),
                "title": "",
                "body": "",
            }
        elif self.current is not None and tag in {"h2", "p"}:
            self.capture = "title" if tag == "h2" else "body"

    def handle_endtag(self, tag: str) -> None:
        if tag in {"h2", "p"}:
            self.capture = None
        if tag == "article" and self.current is not None:
            self.records.append(self.current)
            self.current = None
            self.capture = None

    def handle_data(self, data: str) -> None:
        if self.current is not None and self.capture:
            self.current[self.capture] = f"{self.current[self.capture]} {data}".strip()


class FixtureHtmlAdapter:
    adapter_id = "fixture-html"

    def __init__(self, path: Path) -> None:
        self.path = path

    def collect(self, *, limit: int, enabled_segments: set[str]) -> Iterable[SourceEvidence]:
        parser = _FixtureParser()
        parser.feed(self.path.read_text(encoding="utf-8"))
        emitted = 0
        for item in parser.records:
            if item["segment"] not in enabled_segments:
                continue
            if emitted >= limit:
                break
            emitted += 1
            yield SourceEvidence(
                source="fixture",
                source_id=item["source_id"],
                source_url=item["source_url"],
                captured_at=utc_now_iso(),
                title=" ".join(item["title"].split()),
                body=" ".join(item["body"].split()),
                segment=item["segment"],
                attributes={"budget_usd": item["budget_usd"]},
            )
