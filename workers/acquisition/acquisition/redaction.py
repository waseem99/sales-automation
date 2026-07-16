from __future__ import annotations

import re
from typing import Any

SENSITIVE_KEYS = {
    "authorization", "cookie", "cookies", "password", "secret", "session",
    "session_token", "token", "access_token", "refresh_token", "storage_state",
    "profile_path", "user_data_dir",
}
_PATTERNS = [
    re.compile(r"(?i)bearer\s+[a-z0-9._~+/=-]+"),
    re.compile(r"(?i)(cookie|authorization|token|secret|password)\s*[:=]\s*[^\s,;]+"),
]


def redact_mapping(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            str(key): "<redacted>" if str(key).lower() in SENSITIVE_KEYS else redact_mapping(item)
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [redact_mapping(item) for item in value]
    if isinstance(value, tuple):
        return tuple(redact_mapping(item) for item in value)
    return value


def sanitize_log_text(value: str) -> str:
    sanitized = value
    for pattern in _PATTERNS:
        sanitized = pattern.sub("<redacted>", sanitized)
    return sanitized
