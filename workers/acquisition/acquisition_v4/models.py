from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
import hashlib
from typing import Any
from urllib.parse import urlsplit, urlunsplit

SUPPORTED_SOURCES = {"upwork", "linkedin"}
MAX_TEXT = 20_000
MAX_TITLE = 500
MAX_IDENTITY = 300


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _clean_text(value: Any, limit: int) -> str:
    return " ".join(str(value or "").replace("\x00", " ").split())[:limit]


def canonical_source_url(source: str, value: Any) -> str:
    raw = str(value or "").strip()
    if not raw:
        raise ValueError("A concrete source URL is required.")

    parsed = urlsplit(raw)
    host = (parsed.hostname or "").lower()
    scheme = parsed.scheme.lower()
    if scheme != "https":
        raise ValueError("Source URLs must use HTTPS.")

    if source == "upwork":
        if host not in {"upwork.com", "www.upwork.com"}:
            raise ValueError("Upwork records require an upwork.com URL.")
        host = "www.upwork.com"
        path = parsed.path.rstrip("/")
        if not path or path in {"/", "/nx/find-work"}:
            raise ValueError("An individual Upwork job URL is required.")
    elif source == "linkedin":
        if host not in {"linkedin.com", "www.linkedin.com"}:
            raise ValueError("LinkedIn records require a linkedin.com URL.")
        host = "www.linkedin.com"
        path = parsed.path.rstrip("/")
        valid = (
            path.startswith("/posts/")
            or path.startswith("/feed/update/")
            or path.startswith("/pulse/")
        )
        if not valid:
            raise ValueError("An original LinkedIn post URL is required.")
    else:
        raise ValueError("Unsupported capture source.")

    return urlunsplit(("https", host, path, "", ""))


def deterministic_key(source: str, native_id: str, canonical_url: str) -> str:
    identity = native_id.strip() or canonical_url
    return hashlib.sha256(f"{source}\n{identity}".encode("utf-8")).hexdigest()


@dataclass(frozen=True, slots=True)
class NormalizedRecord:
    schema_version: str
    parser_version: str
    source: str
    source_subtype: str
    canonical_url: str
    source_native_id: str
    dedupe_key: str
    title: str
    body: str
    author_name: str
    author_profile_url: str
    author_headline: str
    company_name: str
    published_at: str
    posted_age: str
    page_url: str
    page_identity: str
    captured_at: str
    commercial_evidence: dict[str, Any] = field(default_factory=dict)
    raw_evidence: dict[str, Any] = field(default_factory=dict)
    external_action_performed: bool = False

    @classmethod
    def from_capture(
        cls,
        *,
        source: str,
        parser_version: str,
        source_subtype: str,
        page_url: str,
        page_identity: str,
        raw: dict[str, Any],
    ) -> "NormalizedRecord":
        if source not in SUPPORTED_SOURCES:
            raise ValueError("Unsupported capture source.")
        canonical_url = canonical_source_url(source, raw.get("source_url"))
        native_id = _clean_text(raw.get("source_native_id"), MAX_IDENTITY)
        title = _clean_text(raw.get("title"), MAX_TITLE)
        body = _clean_text(raw.get("body") or raw.get("description") or raw.get("post_text"), MAX_TEXT)
        if len(body) < 20:
            raise ValueError("Visible source evidence is too short.")

        author = raw.get("author") if isinstance(raw.get("author"), dict) else {}
        author_profile = ""
        if author.get("profile_url"):
            try:
                author_profile = canonical_source_url("linkedin", author.get("profile_url"))
            except ValueError:
                author_profile = _clean_text(author.get("profile_url"), 1_000)

        commercial = raw.get("commercial_evidence")
        evidence = raw.get("raw_evidence")
        if commercial is not None and not isinstance(commercial, dict):
            raise ValueError("Commercial evidence must be an object.")
        if evidence is not None and not isinstance(evidence, dict):
            raise ValueError("Raw evidence must be an object.")

        return cls(
            schema_version="codistan-opportunity.v4",
            parser_version=_clean_text(parser_version, 100) or "unknown",
            source=source,
            source_subtype=_clean_text(source_subtype, 100) or "visible_page",
            canonical_url=canonical_url,
            source_native_id=native_id,
            dedupe_key=deterministic_key(source, native_id, canonical_url),
            title=title or ("Untitled Upwork job" if source == "upwork" else "Untitled LinkedIn post"),
            body=body,
            author_name=_clean_text(author.get("name"), MAX_IDENTITY),
            author_profile_url=author_profile,
            author_headline=_clean_text(author.get("headline"), MAX_TITLE),
            company_name=_clean_text(author.get("company"), MAX_IDENTITY),
            published_at=_clean_text(raw.get("published_at"), 100),
            posted_age=_clean_text(raw.get("posted_age"), 100),
            page_url=_clean_text(page_url, 2_000),
            page_identity=_clean_text(page_identity, MAX_TITLE),
            captured_at=utc_now_iso(),
            commercial_evidence=dict(commercial or {}),
            raw_evidence=dict(evidence or {}),
            external_action_performed=False,
        )

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)
