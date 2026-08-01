from __future__ import annotations

import argparse
import csv
from datetime import datetime, timezone
from html import escape
import io
import json
from pathlib import Path
from typing import Any

from .storage import atomic_write_text

ORDER = {"priority_a": 0, "priority_b": 1, "research": 2, "reject": 3}


def _load_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    records: list[dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        try:
            value = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict):
            records.append(value)
    return records


def _qualification(record: dict[str, Any]) -> dict[str, Any]:
    value = record.get("qualification")
    return value if isinstance(value, dict) else {}


def _rank(record: dict[str, Any]) -> tuple[int, int, str]:
    qualification = _qualification(record)
    disposition = str(qualification.get("disposition", "research"))
    score = int(qualification.get("total_score", 0) or 0)
    captured = str(record.get("captured_at", ""))
    return (ORDER.get(disposition, 9), -score, captured)


def load_combined_records(state_root: Path) -> list[dict[str, Any]]:
    records = [
        *_load_jsonl(state_root / "upwork" / "records.jsonl"),
        *_load_jsonl(state_root / "linkedin" / "records.jsonl"),
    ]
    records.sort(key=_rank)
    return records


def _summary(records: list[dict[str, Any]]) -> dict[str, int]:
    counts = {"priority_a": 0, "priority_b": 0, "research": 0, "reject": 0}
    for record in records:
        disposition = str(_qualification(record).get("disposition", "research"))
        if disposition in counts:
            counts[disposition] += 1
    return counts


def _source_summary(records: list[dict[str, Any]]) -> dict[str, int]:
    counts = {"upwork": 0, "linkedin": 0, "sales_navigator": 0}
    for record in records:
        source = str(record.get("source", ""))
        if source in counts:
            counts[source] += 1
    return counts


def _csv_content(records: list[dict[str, Any]]) -> str:
    output = io.StringIO(newline="")
    writer = csv.DictWriter(
        output,
        fieldnames=[
            "priority", "score", "source", "service_route", "title", "author_or_buyer",
            "canonical_url", "page_identity", "recommended_next_action", "missing_evidence",
            "risk_reasons", "captured_at",
        ],
    )
    writer.writeheader()
    for record in records:
        q = _qualification(record)
        writer.writerow({
            "priority": q.get("disposition", "research"),
            "score": q.get("total_score", 0),
            "source": record.get("source", ""),
            "service_route": q.get("service_route", ""),
            "title": record.get("title", ""),
            "author_or_buyer": record.get("author_name", "") or record.get("company_name", ""),
            "canonical_url": record.get("canonical_url", ""),
            "page_identity": record.get("page_identity", ""),
            "recommended_next_action": q.get("recommended_next_action", ""),
            "missing_evidence": "; ".join(str(v) for v in q.get("missing_evidence", [])),
            "risk_reasons": "; ".join(str(v) for v in q.get("risk_reasons", [])),
            "captured_at": record.get("captured_at", ""),
        })
    return output.getvalue()


def _list(values: Any) -> str:
    if not isinstance(values, list) or not values:
        return "None"
    return ", ".join(escape(str(value)) for value in values)


def _html_content(records: list[dict[str, Any]]) -> str:
    counts = _summary(records)
    source_counts = _source_summary(records)
    actionable = counts["priority_a"] + counts["priority_b"]
    generated_at = datetime.now(timezone.utc).isoformat()
    cards: list[str] = []
    for record in records:
        q = _qualification(record)
        disposition = str(q.get("disposition", "research"))
        score = int(q.get("total_score", 0) or 0)
        url = escape(str(record.get("canonical_url", "")), quote=True)
        title = escape(str(record.get("title", "Untitled opportunity")))
        source_value = str(record.get("source", ""))
        source = escape(source_value.replace("_", " ").title())
        author = escape(str(record.get("author_name", "") or record.get("company_name", "") or "Buyer not visible"))
        body = escape(str(record.get("body", ""))[:700])
        service = escape(str(q.get("service_route", "Unrouted")).replace("_", " ").title())
        action = escape(str(q.get("recommended_next_action", "Review manually.")))
        confidence = escape(str(q.get("confidence", "low")))
        intent_warning = ""
        if source_value == "sales_navigator":
            intent_warning = '<p class="cold-warning"><strong>Cold fit only:</strong> no confirmed buyer intent.</p>'
        cards.append(f"""
        <article class="opportunity {escape(disposition)}" data-priority="{escape(disposition)}" data-source="{escape(source_value)}">
          <div class="topline"><span class="badge">{escape(disposition.replace('_', ' ').title())}</span><strong>{score}/100</strong><span>{source}</span><span>{service}</span></div>
          <h2><a href="{url}" target="_blank" rel="noreferrer">{title}</a></h2>
          <p class="meta">{author} · Confidence: {confidence} · Captured: {escape(str(record.get('captured_at', '')))}</p>
          {intent_warning}
          <p>{body}</p>
          <p><strong>Why:</strong> {_list(q.get('positive_reasons'))}</p>
          <p><strong>Missing:</strong> {_list(q.get('missing_evidence'))}</p>
          <p><strong>Risks:</strong> {_list(q.get('risk_reasons'))}</p>
          <p class="action"><strong>Next:</strong> {action}</p>
        </article>""")
    empty = '<p class="empty">No captured opportunities yet. Keep this page open while the approved source searches run.</p>'
    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="30">
<title>Codistan Lead Desk</title>
<style>
body{{font-family:Segoe UI,Arial,sans-serif;margin:0;background:#f4f6f8;color:#17202a}}main{{max-width:1120px;margin:auto;padding:24px}}
h1{{margin:0 0 6px}}.subtitle{{color:#5b6573;margin-top:0}}.metrics{{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin:20px 0}}
.metric{{background:white;border:1px solid #dde2e8;border-radius:10px;padding:14px}}.metric strong{{display:block;font-size:24px}}
.controls{{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:14px 0}}button{{border:1px solid #bcc5cf;background:white;border-radius:8px;padding:9px 13px;cursor:pointer}}button.active{{background:#17202a;color:white;border-color:#17202a}}
.source-line{{color:#5b6573;font-size:13px}}.opportunity{{background:white;border:1px solid #dfe4ea;border-left:6px solid #7b8794;border-radius:10px;padding:18px;margin:14px 0}}
.opportunity.priority_a{{border-left-color:#137333}}.opportunity.priority_b{{border-left-color:#b06000}}.opportunity.reject{{opacity:.66}}.topline{{display:flex;gap:10px;align-items:center;flex-wrap:wrap;color:#5b6573}}
.badge{{font-weight:700}}h2{{font-size:19px;margin:10px 0}}a{{color:#0a66c2}}.meta{{font-size:13px;color:#5b6573}}.action{{background:#f1f6ff;padding:10px;border-radius:8px}}.cold-warning{{background:#fff3cd;padding:9px;border-radius:8px}}
.hidden{{display:none}}.empty{{background:white;border:1px solid #dde2e8;border-radius:10px;padding:24px}}.footer{{font-size:12px;color:#697582;margin-top:24px}}
@media(max-width:750px){{.metrics{{grid-template-columns:repeat(2,1fr)}}main{{padding:14px}}}}
</style></head><body><main>
<h1>Codistan Lead Desk</h1><p class="subtitle">Actionable leads first. This page refreshes every 30 seconds; every external action remains manual.</p>
<section class="metrics">
<div class="metric"><span>Actionable A/B</span><strong>{actionable}</strong></div>
<div class="metric"><span>Priority A</span><strong>{counts['priority_a']}</strong></div>
<div class="metric"><span>Priority B</span><strong>{counts['priority_b']}</strong></div>
<div class="metric"><span>Research</span><strong>{counts['research']}</strong></div>
<div class="metric"><span>Reject</span><strong>{counts['reject']}</strong></div>
</section>
<p class="source-line">Sources — Upwork: {source_counts['upwork']} · LinkedIn warm: {source_counts['linkedin']} · Sales Navigator cold: {source_counts['sales_navigator']}</p>
<div class="controls" role="group" aria-label="Lead filters">
<button type="button" data-filter="actionable" class="active">Priority A/B</button>
<button type="button" data-filter="priority_a">Priority A only</button>
<button type="button" data-filter="research">Research</button>
<button type="button" data-filter="all">All records</button>
<button type="button" id="refresh">Refresh now</button>
</div>
<section id="lead-list">{''.join(cards) if cards else empty}</section>
<p class="footer">Generated {escape(generated_at)}. Upwork proposals, LinkedIn actions and email are never sent automatically.</p>
<script>
(() => {{
  const cards = Array.from(document.querySelectorAll('.opportunity'));
  const buttons = Array.from(document.querySelectorAll('button[data-filter]'));
  function applyFilter(filter) {{
    for (const card of cards) {{
      const priority = card.dataset.priority || 'research';
      const visible = filter === 'all' || priority === filter || (filter === 'actionable' && (priority === 'priority_a' || priority === 'priority_b'));
      card.classList.toggle('hidden', !visible);
    }}
    for (const button of buttons) button.classList.toggle('active', button.dataset.filter === filter);
  }}
  for (const button of buttons) button.addEventListener('click', () => applyFilter(button.dataset.filter));
  document.getElementById('refresh')?.addEventListener('click', () => location.reload());
  applyFilter('actionable');
}})();
</script>
</main></body></html>"""


def write_review_outputs(state_root: Path) -> dict[str, Any]:
    records = load_combined_records(state_root)
    review_root = state_root / "review"
    json_path = review_root / "queue.json"
    csv_path = review_root / "queue.csv"
    html_path = review_root / "index.html"
    atomic_write_text(json_path, json.dumps({"summary": _summary(records), "records": records}, ensure_ascii=False, indent=2) + "\n")
    atomic_write_text(csv_path, _csv_content(records))
    atomic_write_text(html_path, _html_content(records))
    return {
        "summary": _summary(records),
        "record_count": len(records),
        "json_path": str(json_path),
        "csv_path": str(csv_path),
        "html_path": str(html_path),
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Build the local Codistan acquisition review queue.")
    parser.add_argument("--state-root", type=Path, required=True)
    args = parser.parse_args(argv)
    print(json.dumps(write_review_outputs(args.state_root), indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
