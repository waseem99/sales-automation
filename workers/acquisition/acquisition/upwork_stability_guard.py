from __future__ import annotations

from html import escape
import json
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from . import upwork_scheduled_runtime as _runtime


_original_navigate_search = _runtime._navigate_search
_original_finalize = _runtime._finalize


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


def _safe_finalize(**kwargs: Any) -> None:
    try:
        _original_finalize(**kwargs)
        return
    except Exception as error:
        output_directory = Path(kwargs["output_directory"])
        output_directory.mkdir(parents=True, exist_ok=True)
        result = kwargs["result"]
        diagnostics = list(kwargs.get("diagnostics") or [])
        items = list(kwargs.get("items") or [])

        try:
            _runtime._write_search_results(output_directory / "search-results.json", diagnostics)
        except Exception:
            pass
        try:
            (output_directory / "automation-result.json").write_text(
                json.dumps(result.to_dict(), ensure_ascii=False, indent=2, sort_keys=True),
                encoding="utf-8",
            )
        except Exception:
            pass

        priority_a = sum(1 for item in items if item.qualification.priority == "A")
        priority_b = sum(1 for item in items if item.qualification.priority == "B")
        priority_c = sum(1 for item in items if item.qualification.priority == "C")
        successful = sum(1 for item in diagnostics if item.get("status") == "completed")
        report = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Codistan Upwork Run Report</title><style>
body{{font-family:Segoe UI,Arial,sans-serif;background:#f4f6f8;color:#17202a;margin:0}}
main{{max-width:900px;margin:40px auto;background:white;padding:28px;border-radius:12px;border:1px solid #d9dee5}}
.metric{{display:inline-block;margin:8px 12px 8px 0;padding:10px 14px;background:#f8fafc;border-radius:8px}}
.warning{{padding:14px;background:#fff7ed;border:1px solid #fdba74;border-radius:8px}}
</style></head><body><main>
<h1>Upwork run completed with a reporting warning</h1>
<p class="warning">The normal detailed report could not be rendered: {escape(error.__class__.__name__)}. The run outcome and search diagnostics were preserved.</p>
<div class="metric"><strong>{successful}/3</strong><br>searches completed</div>
<div class="metric"><strong>{len(items)}</strong><br>opportunities preserved</div>
<div class="metric"><strong>{priority_a}</strong><br>Priority A</div>
<div class="metric"><strong>{priority_b}</strong><br>Priority B</div>
<div class="metric"><strong>{priority_c}</strong><br>Priority C</div>
<p>Status: {escape(str(result.status))}</p>
<p>Message: {escape(str(result.message))}</p>
<p>No proposal or message was sent.</p>
</main></body></html>"""
        (output_directory / "report.html").write_text(report, encoding="utf-8")


# Install the guards before exporting the run function. The runtime resolves
# these helpers from its own module globals while it executes.
_runtime._navigate_search = _guarded_navigate_search
_runtime._finalize = _safe_finalize

AutomationSettings = _runtime.AutomationSettings
ScheduledRunResult = _runtime.ScheduledRunResult
load_automation_settings = _runtime.load_automation_settings
run_upwork_scheduled = _runtime.run_upwork_scheduled
local_run_id = _runtime.local_run_id
