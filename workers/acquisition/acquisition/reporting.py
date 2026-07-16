from __future__ import annotations

import csv
from html import escape
from pathlib import Path
from typing import Any


def write_csv_report(path: Path, items: list[Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fields = [
        "priority", "score", "disposition", "business_unit", "service_id", "title",
        "captured_segment", "commercial_potential", "technical_fit", "buyer_quality",
        "competition_timing", "budget_usd", "fixed_budget_usd",
        "estimated_contract_value_usd", "budget_basis", "hourly_min_usd",
        "hourly_max_usd", "client_spend_usd", "client_hire_rate", "client_rating",
        "payment_status", "proposal_activity", "competition_level", "posted_age",
        "client_country", "capture_quality", "proof_ids", "risks", "missing_evidence",
        "recommended_action", "source_url",
    ]
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        for item in items:
            evidence = item.record.evidence
            decision = item.qualification
            attrs = evidence.attributes
            dims = decision.dimensions
            writer.writerow({
                "priority": decision.priority,
                "score": decision.score,
                "disposition": decision.disposition,
                "business_unit": decision.business_unit or "",
                "service_id": decision.service_id or "",
                "title": evidence.title,
                "captured_segment": evidence.segment,
                "commercial_potential": dims.get("commercial_potential", 0),
                "technical_fit": dims.get("technical_fit", 0),
                "buyer_quality": dims.get("buyer_quality", 0),
                "competition_timing": dims.get("competition_timing", 0),
                "budget_usd": attrs.get("budget_usd") or "",
                "fixed_budget_usd": attrs.get("fixed_budget_usd") or "",
                "estimated_contract_value_usd": attrs.get("estimated_contract_value_usd") or "",
                "budget_basis": attrs.get("budget_basis") or "",
                "hourly_min_usd": attrs.get("hourly_min_usd") or "",
                "hourly_max_usd": attrs.get("hourly_max_usd") or "",
                "client_spend_usd": attrs.get("client_spend_usd") or "",
                "client_hire_rate": attrs.get("client_hire_rate") or "",
                "client_rating": attrs.get("client_rating") or "",
                "payment_status": attrs.get("payment_status") or "not_visible",
                "proposal_activity": attrs.get("proposal_activity") or "",
                "competition_level": attrs.get("competition_level") or "",
                "posted_age": attrs.get("posted_age") or "",
                "client_country": attrs.get("client_country") or "",
                "capture_quality": attrs.get("capture_quality") or "",
                "proof_ids": " | ".join(decision.proof_ids),
                "risks": " | ".join(decision.risks),
                "missing_evidence": " | ".join(decision.missing_evidence),
                "recommended_action": decision.recommended_action,
                "source_url": evidence.source_url,
            })


def write_html_report(path: Path, summary: Any, items: list[Any]) -> None:
    ordered = sorted(
        items,
        key=lambda item: (_priority_rank(item.qualification.priority), item.qualification.score),
        reverse=True,
    )
    cards = "\n".join(_card(item) for item in ordered)
    priorities = {"A": 0, "B": 0, "C": 0}
    dispositions: dict[str, int] = {}
    for item in ordered:
        priorities[item.qualification.priority] = priorities.get(item.qualification.priority, 0) + 1
        key = item.qualification.disposition
        dispositions[key] = dispositions.get(key, 0) + 1
    html = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Codistan Upwork Pilot V2 Report</title>
<style>
body{{font-family:Segoe UI,Arial,sans-serif;margin:0;background:#f4f6f8;color:#182230}}
header{{background:#111827;color:white;padding:28px 36px}}
main{{max-width:1240px;margin:auto;padding:28px}}
.grid{{display:grid;grid-template-columns:repeat(auto-fit,minmax(155px,1fr));gap:12px;margin:0 0 22px}}
.metric,.card{{background:white;border:1px solid #dfe3e8;border-radius:12px;padding:16px;box-shadow:0 2px 10px rgba(0,0,0,.04)}}
.metric strong{{display:block;font-size:28px}}
.card{{margin-bottom:14px;border-left:6px solid #98a2b3}}
.card.a{{border-left-color:#15803d}} .card.b{{border-left-color:#ca8a04}} .card.c{{border-left-color:#64748b}}
.row{{display:flex;gap:8px;align-items:center;flex-wrap:wrap}}
.badge{{padding:4px 9px;border-radius:999px;background:#edf2f7;font-size:12px;font-weight:650}}
.priority{{font-size:20px;background:#111827;color:white}} .score{{font-size:28px;font-weight:750}}
h2{{margin:8px 0}} a{{color:#1264a3}} .muted{{color:#667085}}
.dimensions{{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin:12px 0}}
.dimension{{background:#f8fafc;border-radius:8px;padding:9px;font-size:13px}}
details{{margin-top:10px}} pre{{white-space:pre-wrap;font-family:inherit;background:#f8fafc;padding:12px;border-radius:8px}}
</style>
</head>
<body>
<header><h1>Upwork Opportunity Pilot V2</h1><p>BD-focused prioritization. No proposal, message, or dashboard write was performed.</p></header>
<main>
<section class="grid">
<div class="metric"><strong>{summary.links_found}</strong>Links found</div>
<div class="metric"><strong>{summary.extracted}</strong>Extracted</div>
<div class="metric"><strong>{priorities.get('A',0)}</strong>Priority A</div>
<div class="metric"><strong>{priorities.get('B',0)}</strong>Priority B</div>
<div class="metric"><strong>{priorities.get('C',0)}</strong>Priority C</div>
<div class="metric"><strong>{dispositions.get('bd_review',0)}</strong>BD review</div>
</section>
<p class="muted"><strong>A:</strong> contact within 24 hours. <strong>B:</strong> human BD review. <strong>C:</strong> archive. Only A and B records are written to dashboard-ready.jsonl.</p>
{cards if cards else '<div class="card"><h2>No opportunities extracted</h2></div>'}
</main></body></html>"""
    path.write_text(html, encoding="utf-8")


def _card(item: Any) -> str:
    evidence = item.record.evidence
    decision = item.qualification
    attrs = evidence.attributes
    dims = decision.dimensions
    reasons = "".join(f"<li>{escape(value)}</li>" for value in decision.reasons) or "<li>None recorded</li>"
    risks = ", ".join(decision.risks) or "None"
    missing = ", ".join(decision.missing_evidence) or "None"
    proofs = ", ".join(decision.proof_ids) or "None"
    description = escape(evidence.body[:5000])
    hourly = _hourly_label(attrs)
    disposition = "BD Review Required" if decision.disposition == "bd_review" else decision.disposition.replace("_", " ").title()
    return f"""<article class="card {escape(decision.priority.lower())}">
<div class="row"><span class="badge priority">{escape(decision.priority)}</span><span class="score">{decision.score}</span>
<span class="badge">{escape(disposition)}</span><span class="badge">{escape(decision.business_unit or 'Unrouted')}</span>
<span class="badge">routed: {escape(decision.service_id or 'none')}</span>
<span class="badge">captured: {escape(evidence.segment)}</span>
<span class="badge">confidence: {escape(decision.confidence)}</span></div>
<h2><a href="{escape(evidence.source_url, quote=True)}" target="_blank" rel="noreferrer">{escape(evidence.title)}</a></h2>
<div class="dimensions">
<div class="dimension"><strong>Commercial</strong><br>{dims.get('commercial_potential',0)}/30</div>
<div class="dimension"><strong>Technical fit</strong><br>{dims.get('technical_fit',0)}/30</div>
<div class="dimension"><strong>Buyer quality</strong><br>{dims.get('buyer_quality',0)}/20</div>
<div class="dimension"><strong>Competition/timing</strong><br>{dims.get('competition_timing',0)}/20</div>
</div>
<p><strong>Budget/value:</strong> {escape(str(attrs.get('fixed_budget_usd') or attrs.get('estimated_contract_value_usd') or attrs.get('budget_usd') or 'Not visible'))} &nbsp;
<strong>Hourly:</strong> {escape(hourly)} &nbsp;<strong>Proposals:</strong> {escape(str(attrs.get('proposal_activity') or 'Not visible'))}<br>
<strong>Client spend:</strong> {escape(str(attrs.get('client_spend_usd') or 'Not visible'))} &nbsp;
<strong>Hire rate:</strong> {escape(str(attrs.get('client_hire_rate') or 'Not visible'))} &nbsp;
<strong>Rating:</strong> {escape(str(attrs.get('client_rating') or 'Not visible'))} &nbsp;
<strong>Payment:</strong> {escape(str(attrs.get('payment_status') or 'not_visible'))}<br>
<strong>Posted:</strong> {escape(str(attrs.get('posted_age') or 'Not visible'))} &nbsp;
<strong>Country:</strong> {escape(str(attrs.get('client_country') or 'Not visible'))}</p>
<p><strong>Recommended action:</strong> {escape(decision.recommended_action)}</p>
<p><strong>Proof:</strong> {escape(proofs)}<br><strong>Risks:</strong> {escape(risks)}<br>
<strong>Missing evidence:</strong> {escape(missing)}</p>
<ul>{reasons}</ul>
<details><summary>View captured job description</summary><pre>{description}</pre></details>
</article>"""


def _priority_rank(value: str) -> int:
    return {"A": 3, "B": 2, "C": 1}.get(value, 0)


def _hourly_label(attrs: dict[str, Any]) -> str:
    minimum = attrs.get("hourly_min_usd")
    maximum = attrs.get("hourly_max_usd")
    if minimum is None and maximum is None:
        return "Not visible"
    if minimum is not None and maximum is not None and minimum != maximum:
        return f"${minimum:g}–${maximum:g}/hr"
    value = minimum if minimum is not None else maximum
    return f"${value:g}/hr"
