from __future__ import annotations

import argparse
import csv
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
    cards: list[str] = []
    for record in records:
        q = _qualification(record)
        disposition = str(q.get("disposition", "research"))
        score = int(q.get("total_score", 0) or 0)
        url = escape(str(record.get("canonical_url", "")), quote=True)
        title = escape(str(record.get("title", "Untitled opportunity")))
        source = escape(str(record.get("source", ""))).upper()
        author = escape(str(record.get("author_name", "") or record.get("company_name", "") or "Buyer not visible"))
        body = escape(str(record.get("body", ""))[:700])
        service = escape(str(q.get("service_route", "Unrouted")))
        action = escape(str(q.get("recommended_next_action", "Review manually.")))
        confidence = escape(str(q.get("confidence", "low")))
        cards.append(f"""
        <article class="opportunity {escape(disposition)}">
          <div class="topline"><span class="badge">{escape(disposition.replace('_', ' ').title())}</span><strong>{score}/100</strong><span>{source}</span><span>{service}</span></div>
          <h2><a href="{url}" target="_blank" rel="noreferrer">{title}</a></h2>
          <p class="meta">{author} · Confidence: {confidence} · Captured: {escape(str(record.get('captured_at', '')))}</p>
          <p>{body}</p>
          <p><strong>Why:</strong> {_list(q.get('positive_reasons'))}</p>
          <p><strong>Missing:</strong> {_list(q.get('missing_evidence'))}</p>
          <p><strong>Risks:</strong> {_list(q.get('risk_reasons'))}</p>
          <p class="action"><strong>Next:</strong> {action}</p>
        </article>""")
    empty = '<p class="empty">No captured opportunities yet. Run the Upwork or LinkedIn search launcher.</p>'
    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Codistan Acquisition Review</title>
<style>
body{{font-family:Segoe UI,Arial,sans-serif;margin:0;background:#f4f6f8;color:#17202a}}main{{max-width:1050px;margin:auto;padding:24px}}
h1{{margin:0 0 6px}}.subtitle{{color:#5b6573;margin-top:0}}.metrics{{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:20px 0}}
.metric{{background:white;border:1px solid #dde2e8;border-radius:10px;padding:14px}}.metric strong{{display:block;font-size:24px}}
.opportunity{{background:white;border:1px solid #dfe4ea;border-left:6px solid #7b8794;border-radius:10px;padding:18px;margin:14px 0}}
.opportunity.priority_a{{border-left-color:#137333}}.opportunity.priority_b{{border-left-color:#b06000}}.opportunity.reject{{opacity:.66}}.topline{{display:flex;gap:10px;align-items:center;flex-wrap:wrap;color:#5b6573}}
.badge{{font-weight:700}}h2{{font-size:19px;margin:10px 0}}a{{color:#0a66c2}}.meta{{font-size:13px;color:#5b6573}}.action{{background:#f1f6ff;padding:10px;border-radius:8px}}
@media(max-width:650px){{.metrics{{grid-template-columns:repeat(2,1fr)}}main{{padding:14px}}}}
</style></head><body><main>
<h1>Codistan Acquisition Review</h1><p class="subtitle">Priority A first. Every external action remains manual.</p>
<section class="metrics">
<div class="metric"><span>Priority A</span><strong>{counts['priority_a']}</strong></div>
<div class="metric"><span>Priority B</span><strong>{counts['priority_b']}</strong></div>
<div class="metric"><span>Research</span><strong>{counts['research']}</strong></div>
<div class="metric"><span>Reject</span><strong>{counts['reject']}</strong></div>
</section>
{''.join(cards) if cards else empty}
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
