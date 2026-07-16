from __future__ import annotations

import hashlib
from urllib.parse import urlsplit, urlunsplit

from .models import SourceEvidence


def build_dedupe_key(evidence: SourceEvidence) -> str:
    source = _normalize(evidence.source)
    source_id = _normalize(evidence.source_id)
    if source_id:
        identity = f"{source}:id:{source_id}"
    else:
        normalized_url = normalize_source_url(evidence.source_url)
        identity = f"{source}:url:{normalized_url}" if normalized_url else (
            f"{source}:content:{_normalize(evidence.title)}:{_normalize(evidence.body)}"
        )
    return hashlib.sha256(identity.encode("utf-8")).hexdigest()


def normalize_source_url(value: str) -> str:
    text = value.strip()
    if text.startswith("fixture://"):
        return text.lower()
    parts = urlsplit(text)
    if not parts.scheme or not parts.netloc:
        return ""
    path = parts.path.rstrip("/") or "/"
    return urlunsplit((parts.scheme.lower(), parts.netloc.lower(), path, "", ""))


def _normalize(value: str) -> str:
    return " ".join(value.strip().lower().split())
