from __future__ import annotations

from html import escape
import json
from pathlib import Path
from typing import Any

from . import review as _review


def load_combined_records(state_root: Path) -> list[dict[str, Any]]:
    records = [
        *_review._load_jsonl(state_root / "upwork" / "records.jsonl"),
        *_review._load_jsonl(state_root / "linkedin" / "records.jsonl"),
        *_review._load_jsonl(state_root / "sales_navigator" / "records.jsonl"),
    ]
    records.sort(key=_review._rank)
    return records


def _load_automation_status(state_root: Path) -> dict[str, Any]:
    path = state_root / "status" / "automation-controller.json"
    if not path.exists():
        return {}
    try:
        value = json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, json.JSONDecodeError):
        return {}
    return value if isinstance(value, dict) else {}


def _control_token(state_root: Path) -> str:
    path = state_root / "config" / "automation-control-token.txt"
    try:
        return path.read_text(encoding="utf-8").strip()
    except OSError:
        return ""


def _source_summary(status: dict[str, Any], source: str) -> str:
    last_cycle = status.get("last_cycle") if isinstance(status.get("last_cycle"), dict) else {}
    sources = last_cycle.get("sources") if isinstance(last_cycle.get("sources"), dict) else {}
    value = sources.get(source) if isinstance(sources.get(source), dict) else {}
    if not value:
        return "No completed cycle yet"
    accepted = int(value.get("accepted", 0) or 0)
    duplicates = int(value.get("duplicates", 0) or 0)
    enriched = int(value.get("enriched", 0) or 0)
    error = str(value.get("last_error") or "").strip()
    summary = f"{accepted} new · {duplicates} duplicate · {enriched} enriched"
    if error:
        summary += f" · Error: {error[:120]}"
    return summary


def _automation_panel(state_root: Path) -> str:
    status = _load_automation_status(state_root)
    token = _control_token(state_root)
    ready = bool(status.get("ready"))
    paused = bool(status.get("paused"))
    running = bool(status.get("cycle_running"))
    last_cycle = status.get("last_cycle") if isinstance(status.get("last_cycle"), dict) else {}
    last_completed = str(last_cycle.get("completed_at") or "Not completed yet")
    next_cycle = str(status.get("next_cycle_at") or "Unavailable")
    sales_nav_next = str(status.get("next_sales_navigator_at") or "Unavailable")
    controller_state = "Paused" if paused else "Running" if running else "Healthy" if ready else "Unavailable"
    button_label = "Resume automated capture" if paused else "Pause automated capture"
    button_action = "resume" if paused else "pause"
    safe_token = json.dumps(token)
    return f"""
<section class="automation-panel" aria-label="Capture automation status">
  <div class="automation-heading">
    <div><strong>Capture automation</strong><span class="automation-state">{escape(controller_state)}</span></div>
    <div class="automation-actions">
      <button type="button" id="run-capture-now">Run Capture Now</button>
      <button type="button" id="toggle-capture" data-action="{escape(button_action)}">{escape(button_label)}</button>
    </div>
  </div>
  <div class="automation-grid">
    <div><span>Last cycle</span><strong>{escape(last_completed)}</strong></div>
    <div><span>Next 15-minute cycle</span><strong>{escape(next_cycle)}</strong></div>
    <div><span>Sales Navigator next run</span><strong>{escape(sales_nav_next)}</strong></div>
    <div><span>Upwork</span><strong>{escape(_source_summary(status, "upwork"))}</strong></div>
    <div><span>LinkedIn</span><strong>{escape(_source_summary(status, "linkedin"))}</strong></div>
    <div><span>Sales Navigator</span><strong>{escape(_source_summary(status, "sales_navigator"))}</strong></div>
  </div>
  <p id="automation-message" class="automation-message">Automated capture opens temporary background tabs sequentially and closes them after scanning. External actions remain manual.</p>
</section>
<script>
(() => {{
  const token = {safe_token};
  async function control(action) {{
    const message = document.getElementById('automation-message');
    if (!token) {{
      message.textContent = 'Automation control token is unavailable. Restart Sales Automation.';
      return;
    }}
    message.textContent = action === 'run_now' ? 'Starting a fresh capture cycle…' : 'Updating automation state…';
    try {{
      const response = await fetch('http://127.0.0.1:8795/control', {{
        method: 'POST',
        headers: {{'Content-Type': 'application/json'}},
        body: JSON.stringify({{action, token}})
      }});
      const payload = await response.json().catch(() => ({{}}));
      if (!response.ok) throw new Error(payload.error || `Controller returned ${{response.status}}`);
      message.textContent = action === 'run_now'
        ? 'Capture cycle requested. This page will refresh automatically.'
        : `Automation is now ${{payload.paused ? 'paused' : 'active'}}.`;
      setTimeout(() => location.reload(), 1500);
    }} catch (error) {{
      message.textContent = `Automation control failed: ${{error instanceof Error ? error.message : String(error)}}`;
    }}
  }}
  document.getElementById('run-capture-now')?.addEventListener('click', () => control('run_now'));
  document.getElementById('toggle-capture')?.addEventListener('click', event => control(event.currentTarget.dataset.action || 'pause'));
}})();
</script>
"""


def _inject_automation(base_html: str, state_root: Path) -> str:
    panel = _automation_panel(state_root)
    style = """
<style>
.automation-panel{background:#fff;border:1px solid #cfd8e3;border-radius:12px;padding:16px;margin:18px 0;box-shadow:0 1px 2px rgba(23,32,42,.04)}
.automation-heading{display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap}
.automation-heading strong{font-size:18px}.automation-state{display:inline-block;margin-left:10px;padding:4px 8px;border-radius:999px;background:#eaf4ff;color:#0a4f8a;font-size:12px;font-weight:700}
.automation-actions{display:flex;gap:8px;flex-wrap:wrap}.automation-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:14px}
.automation-grid>div{background:#f7f9fb;border:1px solid #e1e7ee;border-radius:9px;padding:10px}.automation-grid span{display:block;color:#66717f;font-size:12px;margin-bottom:4px}
.automation-grid strong{display:block;font-size:13px;line-height:1.35}.automation-message{margin:12px 0 0;color:#5b6573;font-size:13px}
@media(max-width:750px){.automation-grid{grid-template-columns:1fr}}
</style>
"""
    html = base_html.replace("</head>", style + "</head>", 1)
    marker = '<section class="metrics">'
    if marker in html:
        html = html.replace(marker, panel + marker, 1)
    else:
        html = html.replace("<main>", "<main>" + panel, 1)
    return html


def write_review_outputs(state_root: Path) -> dict[str, Any]:
    records = load_combined_records(state_root)
    review_root = state_root / "review"
    json_path = review_root / "queue.json"
    csv_path = review_root / "queue.csv"
    html_path = review_root / "index.html"
    html = _inject_automation(_review._html_content(records), state_root)
    _review.atomic_write_text(
        json_path,
        json.dumps(
            {
                "summary": _review._summary(records),
                "automation": _load_automation_status(state_root),
                "records": records,
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
    )
    _review.atomic_write_text(csv_path, _review._csv_content(records))
    _review.atomic_write_text(html_path, html)
    return {
        "summary": _review._summary(records),
        "record_count": len(records),
        "automation": _load_automation_status(state_root),
        "json_path": str(json_path),
        "csv_path": str(csv_path),
        "html_path": str(html_path),
    }


_review.load_combined_records = load_combined_records
_review.write_review_outputs = write_review_outputs

__all__ = ["load_combined_records", "write_review_outputs"]
