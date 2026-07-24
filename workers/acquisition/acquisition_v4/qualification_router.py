from __future__ import annotations

import re
from typing import Any

from .qualification import qualify_record as qualify_opportunity_record

CONFIGURATION_VERSION = "acquisition-v5-sales-navigator-cold-1.0.0"

EXECUTIVE = re.compile(r"\b(?:founder|co[- ]founder|chief executive officer|ceo|owner|managing director)\b", re.I)
SENIOR_BUYER = re.compile(
    r"\b(?:chief operating officer|coo|chief technology officer|cto|chief information officer|cio|"
    r"chief product officer|cpo|vp|vice president|head of|director|general manager|gm)\b",
    re.I,
)
MID_BUYER = re.compile(r"\b(?:manager|lead|principal)\b", re.I)
TARGET_FUNCTION = re.compile(
    r"\b(?:operations|technology|engineering|product|platform|digital transformation|partnerships|"
    r"strategic partnerships|integrations|innovation|information systems)\b",
    re.I,
)
FINTECH_TERMS = re.compile(
    r"\b(?:fintech|financial technology|payments?|payment infrastructure|digital bank|digital banking|"
    r"wallet|lending|loan|nbfc|microfinance|remittance|cross[- ]border|financial infrastructure|"
    r"banking platform|financial services)\b",
    re.I,
)


def _mapping(record: dict[str, Any], key: str) -> dict[str, Any]:
    value = record.get(key)
    return value if isinstance(value, dict) else {}


def _text(record: dict[str, Any]) -> str:
    commercial = _mapping(record, "commercial_evidence")
    raw = _mapping(record, "raw_evidence")
    values = [
        record.get("title"),
        record.get("body"),
        record.get("author_headline"),
        record.get("company_name"),
        raw.get("location"),
        raw.get("industry"),
        commercial.get("campaign_name"),
        commercial.get("offer_name"),
        commercial.get("offer_summary"),
    ]
    return " ".join(str(value or "") for value in values)


def _list(value: Any) -> list[str]:
    return [str(item).strip() for item in value] if isinstance(value, list) else []


def _bool(value: Any) -> bool:
    return value is True or str(value).strip().lower() in {"true", "yes", "1"}


def _sales_navigator_decision(record: dict[str, Any]) -> dict[str, Any]:
    commercial = _mapping(record, "commercial_evidence")
    raw = _mapping(record, "raw_evidence")
    text = _text(record)
    positives: list[str] = []
    missing: list[str] = []
    risks: list[str] = ["cold prospect; no explicit buying intent has been established"]

    campaign_id = str(commercial.get("campaign_id") or "").strip()
    campaign_name = str(commercial.get("campaign_name") or "").strip()
    offer_name = str(commercial.get("offer_name") or "").strip()
    service_lanes = [lane for lane in _list(commercial.get("service_lanes")) if lane]
    primary = str(commercial.get("service_route") or (service_lanes[0] if service_lanes else "software_product")).strip()

    if not campaign_id or not campaign_name or not offer_name:
        return {
            "source": "sales_navigator",
            "disposition": "reject",
            "total_score": 0,
            "confidence": "low",
            "dimensions": {},
            "service_lanes": service_lanes,
            "service_route": primary,
            "positive_reasons": [],
            "missing_evidence": ["campaign identity and offer"],
            "risk_reasons": ["unregistered Sales Navigator campaign"],
            "recommended_next_action": "Do not contact; register the approved search under a product or service campaign first.",
            "configuration_version": CONFIGURATION_VERSION,
        }

    headline = str(record.get("author_headline") or record.get("body") or "")
    if EXECUTIVE.search(headline):
        persona = 30
        positives.append("executive or founder-level persona")
    elif SENIOR_BUYER.search(headline) and TARGET_FUNCTION.search(headline):
        persona = 26
        positives.append("senior decision-maker in a target function")
    elif SENIOR_BUYER.search(headline):
        persona = 20
        positives.append("senior persona; functional relevance requires review")
    elif MID_BUYER.search(headline) and TARGET_FUNCTION.search(headline):
        persona = 13
        risks.append("mid-level persona may not own the buying decision")
    else:
        persona = 0
        risks.append("no target buyer persona visible")

    explicit_industry_match = commercial.get("industry_match")
    target_terms = _list(commercial.get("target_industry_terms"))
    target_pattern_match = any(term.lower() in text.lower() for term in target_terms if term)
    if explicit_industry_match is True:
        company_fit = 25
        positives.append("account matches the campaign industry criteria")
    elif explicit_industry_match is False:
        company_fit = 0
        risks.append("account falls outside the configured industry criteria")
    elif target_pattern_match or FINTECH_TERMS.search(text):
        company_fit = 21
        positives.append("visible fintech or financial-infrastructure account fit")
    else:
        company_fit = 8
        missing.append("verified account industry and business model")

    if service_lanes:
        campaign_fit = 20
        positives.append(f"campaign offer fit: {offer_name}")
    else:
        campaign_fit = 8
        missing.append("campaign service route")

    signal_score = 0
    if _bool(raw.get("posted_on_linkedin")) or _bool(raw.get("recent_activity")):
        signal_score += 8
        positives.append("recent LinkedIn activity visible")
    if _bool(raw.get("changed_jobs")):
        signal_score += 5
        positives.append("recent role-change signal")
    if _bool(raw.get("teamlink")) or int(raw.get("mutual_connections") or 0) > 0:
        signal_score += 4
        positives.append("relationship path visible")
    relationship = str(raw.get("relationship") or "").lower()
    if "2nd" in relationship:
        signal_score += 3
    elif "3rd" in relationship:
        signal_score += 1
    signal_score = min(15, signal_score)
    if signal_score == 0:
        missing.append("activity or relationship signal")

    evidence = 0
    if record.get("author_name"):
        evidence += 5
    else:
        missing.append("prospect name")
    if record.get("canonical_url") or record.get("author_profile_url"):
        evidence += 5
    else:
        missing.append("canonical prospect profile")
    if record.get("author_headline"):
        evidence += 4
    else:
        missing.append("current role")
    if record.get("company_name"):
        evidence += 4
    else:
        missing.append("current company")
    if raw.get("location"):
        evidence += 2
    elif commercial.get("target_geographies"):
        missing.append("prospect geography")

    geography_fit = commercial.get("geography_match")
    if geography_fit is False:
        risks.append("prospect is outside the configured geography")
    elif geography_fit is True:
        positives.append("prospect matches the configured geography")

    total = min(100, persona + company_fit + campaign_fit + signal_score + evidence)
    hard_reject = persona == 0 or explicit_industry_match is False or geography_fit is False
    if hard_reject:
        disposition = "reject"
    elif total >= 76 and persona >= 20 and company_fit >= 20:
        disposition = "priority_a"
    elif total >= 56 and persona >= 13:
        disposition = "priority_b"
    else:
        disposition = "research"

    confidence = "high" if evidence >= 16 and len(missing) <= 1 else "medium" if evidence >= 9 else "low"
    next_action = {
        "priority_a": f"Research the prospect and account, validate the {offer_name} angle, then prepare a concise manual outreach sequence.",
        "priority_b": "Verify authority, account pain and a credible trigger before preparing manual outreach.",
        "research": "Complete company, role and campaign-fit research before deciding whether to contact.",
        "reject": "Do not contact under this campaign; retain the evidence for ICP calibration.",
    }[disposition]

    return {
        "source": "sales_navigator",
        "disposition": disposition,
        "total_score": total,
        "confidence": confidence,
        "dimensions": {
            "persona_authority": persona,
            "account_fit": company_fit,
            "campaign_offer_fit": campaign_fit,
            "activity_relationship_signals": signal_score,
            "evidence_completeness": evidence,
        },
        "service_lanes": service_lanes,
        "service_route": primary,
        "positive_reasons": sorted(set(positives)),
        "missing_evidence": sorted(set(missing)),
        "risk_reasons": sorted(set(risks)),
        "recommended_next_action": next_action,
        "configuration_version": CONFIGURATION_VERSION,
        "campaign_id": campaign_id,
        "campaign_name": campaign_name,
        "offer_name": offer_name,
    }


def qualify_record(record: dict[str, Any]) -> dict[str, Any]:
    if str(record.get("source") or "").lower() == "sales_navigator":
        return _sales_navigator_decision(record)
    return qualify_opportunity_record(record)
