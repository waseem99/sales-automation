from __future__ import annotations

import re
from typing import Any


_SENSITIVE_KEY = re.compile(
    r"(cookie|authorization|password|secret|session|token|profile_path)",
    re.IGNORECASE,
)
_COOKIE_VALUE = re.compile(r"(?i)(cookie|authorization)\s*[:=]\s*[^\s,;]+")
_EMAIL = re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.IGNORECASE)


def redact(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            key: "[REDACTED]" if _SENSITIVE_KEY.search(str(key)) else redact(item)
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [redact(item) for item in value]
    if isinstance(value, tuple):
        return tuple(redact(item) for item in value)
    if isinstance(value, str):
        text = _COOKIE_VALUE.sub(r"\1=[REDACTED]", value)
        return _EMAIL.sub("[EMAIL]", text)
    return value
