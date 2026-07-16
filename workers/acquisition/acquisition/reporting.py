from __future__ import annotations

import csv
from html import escape
from pathlib import Path
from typing import Any


def write_csv_report(path: Path, items: list[Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fields = [
        "score", "disposition", "business_unit", "service_id", "title",
        "captured_segment", "budget_usd", "budget_basis", "hourly_min_usd",
        "hourly_max_usd", "client_spend_usd", "client_hire_rate",
        "payment_status", "proposal_activity", "competition_level",
        "capture_quality", "proof_ids", "risks", "missing_evidence", "source_url",
    ]
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        for item in items:
            evidence = item.record.evidence
            decision = item.qualification
            attrs = evidence.attributes
            writer.writerow({
                "score": decision.score,
                "disposition": decision.disposition,
                "business_unit": decision.business_unit or "",
                "service_id": decision.service_id or "",
                "title": evidence.title,
                "captured_segment": evidence.segment,
                "budget_usd": attrs.get("budget_usd") or "",
                "budget_basis": attrs.get("budget_basis") or "",
                "hourly_min_usd": attrs.get("hourly_min_usd") or "",
                "hourly_max_usd": attrs.get("hourly_max_usd") or "",
                "client_spend_usd": attrs.get("client_spend_usd") or "",
                "client_hire_rate": attrs.get("client_hire_rate") or "",
                "payment_status": attrs.get("payment_status") or "not_visible",
                "proposal_activity": attrs.get("proposal_activity") or "",
                "competition_level": attrs.get("competition_level") or "",
                "capture_quality": attrs.get("capture_quality") or "",
                "proof_ids": " | ".join(decision.proof_ids),
                "risks": " | ".join(decision.risks),
                "missing_evidence": " | ".join(decision.missing_evidence),
                "source_url": evidence.source_url,
            })


def write_html_report(path: Path, summary: Any, items: list[Any]) -> None:
    ordered = sorted(items, key=lambda item: item.qualification.score, reverse=True)
    cards = "\n".join(_card(item) for item in ordered)
    counts: dict[str, int] = {}
    for item in ordered:
        key = item.qualification.disposition
        counts[key] = counts.get(key, 0) + 1
    html = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Codistan Upwork Dry-Run Report</title>
<style>
body{{font-family:Segoe UI,Arial,sans-serif;margin:0;background:#f4f6f8;color:#182230}}
header{{background:#111827;color:white;padding:28px 36px}}
main{{max-width:1200px;margin:auto;padding:28px}}
.grid{{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin:0 0 22px}}
.metric,.card{{background:white;border:1px solid #dfe3e8;border-radius:12px;padding:16px;box-shadow:0 2px 10px rgba(0,0,0,.04)}}
.metric strong{{display:block;font-size:28px}}
.card{{margin-bottom:14px}}
.row{{display:flex;gap:10px;align-items:center;flex-wrap:wrap}}
.badge{{padding:4px 9px;border-radius:999px;background:#edf2f7;font-size:12px;font-weight:600}}
.score{{font-size:28px;font-weight:700}}
h2{{margin:8px 0}} a{{color:#1264a3}} .muted{{color:#667085}}
details{{margin-top:10px}} pre{{white-space:pre-wrap;font-family:inherit;background:#f8fafc;padding:12px;border-radius:8px}}
</style>
</head>
<body>
<header><h1>Upwork Opportunity Dry-Run</h1><p>No proposal, message, or dashboard write was performed.</p></header>
<main>
<section class="grid">
<div class="metric"><strong>{summary.links_found}</strong>Links found</div>
<div class="metric"><strong>{summary.reviewed}</strong>Reviewed</div>
<div class="metric"><strong>{summary.extracted}</strong>Extracted</div>
<div class="metric"><strong>{summary.duplicates}</strong>Duplicates</div>
<div class="metric"><strong>{counts.get('proposal_ready',0)}</strong>Proposal ready</div>
<div class="metric"><strong>{counts.get('qualified',0)+counts.get('contact_ready',0)}</strong>Qualified/contact</div>
</section>
<p class="muted">Review the evidence and qualification quality. Dashboard ingestion remains disabled until explicit approval.</p>
{cards if cards else '<div class="card"><h2>No opportunities extracted</h2><p>Check the visible browser for an Upwork layout or account challenge, then rerun.</p></div>'}
</main></body></html>"""
    path.write_text(html, encoding="utf-8")


def _card(item: Any) -> str:
    evidence = item.record.evidence
    decision = item.qualification
    attrs = evidence.attributes
    reasons = "".join(f"<li>{escape(value)}</li>" for value in decision.reasons) or "<li>None recorded</li>"
    risks = ", ".join(decision.risks) or "None"
    missing = ", ".join(decision.missing_evidence) or "None"
    proofs = ", ".join(decision.proof_ids) or "None"
    description = escape(evidence.body[:5000])
    hourly = _hourly_label(attrs)
    return f"""<article class="card">
<div class="row"><span class="score">{decision.score}</span><span class="badge">{escape(decision.disposition)}</span>
<span class="badge">{escape(decision.business_unit or 'Unrouted')}</span>
<span class="badge">routed: {escape(decision.service_id or 'none')}</span>
<span class="badge">captured: {escape(evidence.segment)}</span>
<span class="badge">capture: {escape(str(attrs.get('capture_quality') or 'unknown'))}</span></div>
<h2><a href="{escape(evidence.source_url, quote=True)}" target="_blank" rel="noreferrer">{escape(evidence.title)}</a></h2>
<p><strong>Budget:</strong> {escape(str(attrs.get('budget_usd') or 'Not visible'))} ({escape(str(attrs.get('budget_basis') or 'unknown'))}) &nbsp;
<strong>Hourly:</strong> {escape(hourly)} &nbsp;
<strong>Client spend:</strong> {escape(str(attrs.get('client_spend_usd') or 'Not visible'))} &nbsp;
<strong>Hire rate:</strong> {escape(str(attrs.get('client_hire_rate') or 'Not visible'))}</p>
<p><strong>Payment:</strong> {escape(str(attrs.get('payment_status') or 'not_visible'))} &nbsp;
<strong>Proposals:</strong> {escape(str(attrs.get('proposal_activity') or 'Not visible'))} &nbsp;
<strong>Competition:</strong> {escape(str(attrs.get('competition_level') or 'Not visible'))}</p>
<p><strong>Proof:</strong> {escape(proofs)}<br><strong>Risks:</strong> {escape(risks)}<br>
<strong>Missing evidence:</strong> {escape(missing)}</p>
<ul>{reasons}</ul>
<details><summary>View captured job description</summary><pre>{description}</pre></details>
</article>"""


def _hourly_label(attrs: dict[str, Any]) -> str:
    minimum = attrs.get("hourly_min_usd")
    maximum = attrs.get("hourly_max_usd")
    if minimum is None and maximum is None:
        return "Not visible"
    if minimum is not None and maximum is not None:
        return f"${minimum:g}–${maximum:g}/hr"
    value = minimum if minimum is not None else maximum
    return f"${value:g}/hr"
