from __future__ import annotations

from typing import Any
from urllib.parse import urlparse

from . import upwork_scheduled_runtime as _runtime


_original_navigate_search = _runtime._navigate_search


def _same_saved_search(current_url: str, target_url: str) -> bool:
    current = urlparse(str(current_url or ""))
    target = urlparse(str(target_url or ""))
    if current.hostname not in {"upwork.com", "www.upwork.com"}:
        return False
    return current.path.rstrip("/") == target.path.rstrip("/")


def _guarded_navigate_search(
    page: Any,
    url: str,
    *,
    wait_seconds: float,
    settings: Any,
    attention_path: Any,
    status_path: Any,
    result: Any,
) -> tuple[bool, str, int]:
    ready, reason, attempts = _original_navigate_search(
        page,
        url,
        wait_seconds=wait_seconds,
        settings=settings,
        attention_path=attention_path,
        status_path=status_path,
        result=result,
    )
    if not ready:
        return ready, reason, attempts
    if not _same_saved_search(str(getattr(page, "url", "")), url):
        return False, "Chrome did not reach the configured saved-search page; the search was skipped.", attempts
    return True, reason, attempts


# The runtime resolves this helper from its own module globals. Installing the
# guard before exporting the run function prevents stale-page capture without
# changing browser actions or the external-action boundary.
_runtime._navigate_search = _guarded_navigate_search

AutomationSettings = _runtime.AutomationSettings
ScheduledRunResult = _runtime.ScheduledRunResult
load_automation_settings = _runtime.load_automation_settings
run_upwork_scheduled = _runtime.run_upwork_scheduled
local_run_id = _runtime.local_run_id
