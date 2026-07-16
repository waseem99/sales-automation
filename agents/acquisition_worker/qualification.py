from __future__ import annotations

import re
from dataclasses import asdict, dataclass
from typing import Any

from .models import Opportunity


@dataclass(frozen=True, slots=True)
class QualificationDecision:
    disposition: str
    score: int
    confidence: str
    business_unit: str
    service_category: str
    portfolio_item_ids: tuple[str, ...]
    reasons: tuple[str, ...]
    risk_flags: tuple[str, ...]
    recommended_next_action: str
    delivery_fit: str

    def as_dict(self) -> dict[str, Any]:
        value = asdict(self)
        value["portfolio_item_ids"] = list(self.portfolio_item_ids)
        value["reasons"] = list(self.reasons)
        value["risk_flags"] = list(self.risk_flags)
        return value


_SERVICE_RULES = (
    (
        "rag_document_intelligence",
        "hilarious_ai",
        ("rag", "retrieval augmented", "knowledge base", "document intelligence", "vector search"),
        ("portfolio-ai-rag-assistant",),
    ),
    (
        "ai_automation",
        "hilarious_ai",
        ("ai agent", "automation", "n8n", "workflow", "llm", "openai", "copilot"),
        ("portfolio-ai-workflow-automation", "portfolio-ai-rag-assistant"),
    ),
    (
        "cybersecurity_compliance",
        "cytas",
        ("vapt", "penetration test", "soc 2", "soc2", "iso 27001", "hipaa", "cmmc", "iam", "cybersecurity"),
        ("portfolio-secure-compliance-platform",),
    ),
    (
        "ar_3d_unity_unreal",
        "motionly",
        ("3d", "unity", "unreal", "augmented reality", "virtual reality", "webar", "animation"),
        ("portfolio-ar-3d-product-visualization",),
    ),
    (
        "website_portal",
        "digital_marketing",
        ("website redesign", "seo", "digital marketing", "web portal", "landing page", "analytics", "ga4"),
        ("portfolio-nextjs-saas-mvp",),
    ),
    (
        "fullstack_web_app",
        "codistan",
        ("react", "react native", "next.js", "nextjs", "node.js", "python", "full stack", "full-stack", "mobile app"),
        ("portfolio-nextjs-saas-mvp",),
    ),
    (
        "enterprise_systems",
        "codistan",
        ("enterprise", "erp", "crm", "marketplace", "subscription", "telecom", "esim", "fintech"),
        ("portfolio-nextjs-saas-mvp", "portfolio-ai-workflow-automation"),
    ),
)

_REJECT_PATTERNS = {
    "academic_cheating": re.compile(r"\b(homework|assignment|exam|thesis writing|do my coursework)\b", re.I),
    "unpaid_test": re.compile(r"\b(unpaid test|free trial task|work for free)\b", re.I),
    "prohibited_or_deceptive": re.compile(r"\b(fake review|credential theft|phishing|malware|bypass security)\b", re.I),
}
_MONEY = re.compile(r"\$?\s*([0-9]+(?:[,.][0-9]+)?)\s*([kKmM]?)")


def qualify_opportunity(opportunity: Opportunity) -> QualificationDecision:
    text = " ".join(
        [
            opportunity.title,
            opportunity.description,
            str(opportunity.metadata.get("skills", "")),
            str(opportunity.metadata.get("service_hint", "")),
        ]
    ).casefold()
    risk_flags = [
        code for code, pattern in _REJECT_PATTERNS.items()
        if pattern.search(text)
    ]
    exclusions = [
        str(value).casefold()
        for value in opportunity.metadata.get("exclusions", [])
        if isinstance(value, str)
    ]
    if any(value and value in text for value in exclusions):
        risk_flags.append("search_exclusion")

    service_category, business_unit, portfolio_ids, service_hits = _route_service(text)
    score = 0
    reasons: list[str] = []

    if service_category != "unknown":
        score += min(25, 15 + service_hits * 3)
        reasons.append(f"Matched {service_category.replace('_', ' ')} delivery capability.")
    else:
        score += 5
        reasons.append("Service fit requires human classification.")

    description_length = len(opportunity.description.split())
    if description_length >= 80:
        score += 15
        reasons.append("Requirement has substantial delivery detail.")
    elif description_length >= 35:
        score += 10
        reasons.append("Requirement has usable scope detail.")
    else:
        score += 4

    budget_score, budget_reason = _budget_score(opportunity)
    score += budget_score
    if budget_reason:
        reasons.append(budget_reason)

    metadata = opportunity.metadata
    buyer_score = 0
    if metadata.get("payment_verified") is True:
        buyer_score += 6
        reasons.append("Buyer payment status is verified.")
    spend = _number(metadata.get("client_spend_usd"))
    if spend >= 10_000:
        buyer_score += 8
        reasons.append("Buyer has meaningful historical spend.")
    elif spend > 0:
        buyer_score += 4
    hire_rate = _number(metadata.get("hire_rate_percent"))
    if hire_rate >= 50:
        buyer_score += 6
        reasons.append("Buyer has a credible hiring rate.")
    elif hire_rate >= 20:
        buyer_score += 3
    score += min(20, buyer_score)

    proposal_count = int(_number(metadata.get("proposal_count")))
    if proposal_count == 0:
        score += 5
    elif proposal_count <= 10:
        score += 10
        reasons.append("Competition is still manageable.")
    elif proposal_count <= 20:
        score += 7
    elif proposal_count <= 50:
        score += 3
    else:
        risk_flags.append("high_competition")

    if opportunity.source_url and opportunity.external_id:
        score += 10
        reasons.append("Original source evidence and stable job identifier are present.")
    elif opportunity.source_url:
        score += 6
    else:
        risk_flags.append("missing_source_evidence")

    score = max(0, min(100, score))
    confidence = _confidence(opportunity, buyer_score)
    delivery_fit = _delivery_fit(opportunity)

    if risk_flags and any(flag in {"academic_cheating", "unpaid_test", "prohibited_or_deceptive"} for flag in risk_flags):
        disposition = "reject"
    elif "missing_source_evidence" in risk_flags or service_category == "unknown":
        disposition = "research"
    elif score >= 80 and budget_score >= 14:
        disposition = "proposal_ready"
    elif score >= 68:
        disposition = "contact_ready"
    elif score >= 55:
        disposition = "qualified"
    elif score >= 40:
        disposition = "research"
    else:
        disposition = "reject"

    next_action = {
        "proposal_ready": "Review evidence and prepare a focused Upwork proposal for manual submission.",
        "contact_ready": "Verify the buyer details and prepare a human-reviewed response.",
        "qualified": "Complete commercial checks and confirm the strongest proof angle.",
        "research": "Resolve missing budget, buyer or service evidence before outreach.",
        "reject": "Do not pursue; retain the structured rejection reason for calibration.",
    }[disposition]
    return QualificationDecision(
        disposition=disposition,
        score=score,
        confidence=confidence,
        business_unit=business_unit,
        service_category=service_category,
        portfolio_item_ids=portfolio_ids,
        reasons=tuple(reasons),
        risk_flags=tuple(sorted(set(risk_flags))),
        recommended_next_action=next_action,
        delivery_fit=delivery_fit,
    )


def _route_service(text: str) -> tuple[str, str, tuple[str, ...], int]:
    best: tuple[str, str, tuple[str, ...], int] = ("unknown", "codistan", (), 0)
    for category, unit, keywords, portfolio_ids in _SERVICE_RULES:
        hits = sum(1 for keyword in keywords if keyword in text)
        if hits > best[3]:
            best = (category, unit, portfolio_ids, hits)
    return best


def _budget_score(opportunity: Opportunity) -> tuple[int, str | None]:
    metadata = opportunity.metadata
    fixed = _number(metadata.get("fixed_budget_usd"))
    hourly = _number(metadata.get("hourly_min_usd"))
    if not fixed and not hourly:
        fixed = _money_value(opportunity.budget_signal)
    if fixed >= 5_000:
        return 20, "Budget supports a meaningful fixed-scope engagement."
    if fixed >= 2_000:
        return 14, "Budget may support a focused implementation."
    if fixed >= 500:
        return 6, "Budget is low for broad agency delivery."
    if hourly >= 30:
        return 17, "Hourly range is commercially viable."
    if hourly >= 20:
        return 12, "Hourly range may be viable for a focused engagement."
    if hourly > 0:
        return 5, "Hourly range is below the preferred agency level."
    return 3, None


def _money_value(value: str | None) -> float:
    if not value:
        return 0.0
    match = _MONEY.search(value.replace(",", ""))
    if not match:
        return 0.0
    amount = float(match.group(1))
    suffix = match.group(2).casefold()
    if suffix == "k":
        amount *= 1_000
    elif suffix == "m":
        amount *= 1_000_000
    return amount


def _number(value: Any) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def _confidence(opportunity: Opportunity, buyer_score: int) -> str:
    if opportunity.source_url and opportunity.external_id and buyer_score >= 10:
        return "high"
    if opportunity.source_url and len(opportunity.description.split()) >= 35:
        return "medium"
    return "low"


def _delivery_fit(opportunity: Opportunity) -> str:
    local_required = str(opportunity.metadata.get("local_presence_required", "")).casefold()
    if local_required in {"true", "yes", "required"}:
        return "local_or_regional_partner_required"
    return "remote_delivery_suitable"
