from __future__ import annotations

import re
from typing import Any

CONFIGURATION_VERSION = "acquisition-v4-closeability-1.0.0"

SERVICE_PATTERNS: dict[str, re.Pattern[str]] = {
    "software_product": re.compile(r"\b(?:software|website|web app|mobile app|saas|mvp|platform|portal|e-?commerce|marketplace|react|node(?:\.js)?|python|development team|developers?|api integration)\b", re.I),
    "ai_automation": re.compile(r"\b(?:ai|artificial intelligence|automation|agentic|agents?|rag|llm|chatbot|copilot|voice ai|machine learning|document intelligence)\b", re.I),
    "cybersecurity": re.compile(r"\b(?:cybersecurity|cyber security|vapt|penetration test|security assessment|cloud security|iam|iso 27001|soc 2|hipaa|cmmc|compliance)\b", re.I),
    "digital_growth": re.compile(r"\b(?:digital marketing|social media|content strategy|content marketing|content creation|performance marketing|paid ads?|meta ads?|google ads?|seo|gmb|branding|growth marketing)\b", re.I),
    "creative_animation": re.compile(r"\b(?:video production|video editing|animation|motion design|motion graphics|2d|3d|product visualization|creative studio|ai creative)\b", re.I),
    "immersive_game": re.compile(r"\b(?:game development|unity|unreal|ar\/?vr|augmented reality|virtual reality|immersive|interactive experience)\b", re.I),
    "delivery_partner": re.compile(r"\b(?:white[- ]label|subcontract|outsourc(?:e|ing)|overflow|delivery partner|implementation partner|development partner|agency partner|managed team)\b", re.I),
}

LANE_ALIASES = {
    "software": "software_product",
    "ai_automation": "ai_automation",
    "cybersecurity": "cybersecurity",
    "digital_growth": "digital_growth",
    "creative_animation": "creative_animation",
    "immersive_game": "immersive_game",
    "delivery_partner": "delivery_partner",
}

PROHIBITED = re.compile(
    r"\b(?:take my exam|complete my exam|academic cheating|write my assignment|do my homework|fake review|credential stuffing|malware|ransomware|phishing kit)\b",
    re.I,
)
EXPLOITATIVE = re.compile(r"\b(?:unpaid test|free trial work|work for exposure|commission only|equity only)\b", re.I)
EXPLICIT_INTENT = re.compile(
    r"\b(?:looking for|seeking|need(?:ing)?|requir(?:e|ed|ing|ement)|request for proposal|rfp|expression of interest|eoi|inviting (?:agencies|vendors|consultants|partners)|submit (?:a )?(?:proposal|quotation|quote|portfolio)|partner with)\b",
    re.I,
)


def _text(record: dict[str, Any]) -> str:
    raw = record.get("raw_evidence") if isinstance(record.get("raw_evidence"), dict) else {}
    skills = raw.get("skills") if isinstance(raw.get("skills"), list) else []
    return " ".join(
        str(value or "")
        for value in (record.get("title"), record.get("body"), " ".join(str(item) for item in skills))
    )


def _commercial(record: dict[str, Any]) -> dict[str, Any]:
    value = record.get("commercial_evidence")
    return value if isinstance(value, dict) else {}


def _number(value: Any) -> float | None:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed >= 0 else None


def _service_lanes(record: dict[str, Any]) -> list[str]:
    commercial = _commercial(record)
    existing = commercial.get("service_lanes") if isinstance(commercial.get("service_lanes"), list) else []
    lanes = {LANE_ALIASES.get(str(value), str(value)) for value in existing if str(value).strip()}
    content = _text(record)
    for lane, pattern in SERVICE_PATTERNS.items():
        if pattern.search(content):
            lanes.add(lane)
    return sorted(lane for lane in lanes if lane in SERVICE_PATTERNS)


def _freshness_score(value: Any) -> tuple[int, str | None]:
    text = str(value or "").lower()
    if not text:
        return 3, "posting freshness"
    if "minute" in text or "hour" in text or text.endswith("m") or text.endswith("h"):
        return 8, None
    if "yesterday" in text or "1 day" in text or text.endswith("d"):
        return 6, None
    if "day" in text:
        match = re.search(r"(\d+)", text)
        if match and int(match.group(1)) <= 3:
            return 5, None
        return 2, None
    if "week" in text:
        return 1, None
    return 3, "posting freshness"


def _confidence(record: dict[str, Any], missing: list[str]) -> str:
    evidence_points = 0
    for key in ("canonical_url", "title", "body", "source_native_id", "page_identity"):
        if record.get(key):
            evidence_points += 1
    if record.get("author_name"):
        evidence_points += 1
    if _commercial(record):
        evidence_points += 1
    if evidence_points >= 6 and len(missing) <= 1:
        return "high"
    if evidence_points >= 4 and len(missing) <= 3:
        return "medium"
    return "low"


def _upwork_decision(record: dict[str, Any], lanes: list[str]) -> dict[str, Any]:
    commercial = _commercial(record)
    positives: list[str] = []
    missing: list[str] = []
    risks: list[str] = []

    fit = min(30, 18 + 4 * len(lanes)) if lanes else 0
    if lanes:
        positives.append(f"service fit: {', '.join(lanes)}")
    else:
        risks.append("no supported service lane")

    fixed = _number(commercial.get("fixed_budget_usd"))
    hourly_min = _number(commercial.get("hourly_min_usd"))
    hourly_max = _number(commercial.get("hourly_max_usd"))
    if fixed is not None:
        if fixed >= 10_000:
            commercial_score = 30
            positives.append("strong fixed-price commercial value")
        elif fixed >= 5_000:
            commercial_score = 26
            positives.append("good fixed-price commercial value")
        elif fixed >= 2_000:
            commercial_score = 20
        elif fixed >= 1_000:
            commercial_score = 14
            risks.append("lower-value fixed-price job")
        else:
            commercial_score = 3
            risks.append("fixed-price value below operating minimum")
    elif hourly_min is not None or hourly_max is not None:
        rate = hourly_min if hourly_min is not None else hourly_max or 0
        if rate >= 50:
            commercial_score = 28
            positives.append("strong hourly rate")
        elif rate >= 30:
            commercial_score = 23
            positives.append("viable hourly rate")
        elif rate >= 20:
            commercial_score = 17
        else:
            commercial_score = 6
            risks.append("hourly rate below preferred minimum")
        if not commercial.get("duration"):
            missing.append("engagement duration")
        if not commercial.get("weekly_hours"):
            missing.append("weekly workload")
    else:
        commercial_score = 10
        missing.append("budget or hourly range")

    buyer = 0
    payment = commercial.get("payment_verified")
    if payment is True:
        buyer += 8
        positives.append("payment verified")
    elif payment is False:
        risks.append("payment unverified")
    else:
        missing.append("payment verification")

    spend = _number(commercial.get("client_spend_usd"))
    if spend is not None:
        if spend >= 50_000:
            buyer += 8
            positives.append("established Upwork buyer spend")
        elif spend >= 10_000:
            buyer += 6
        elif spend > 0:
            buyer += 3
    else:
        missing.append("client spend")

    hire_rate = _number(commercial.get("hire_rate_percent"))
    if hire_rate is not None:
        if hire_rate >= 70:
            buyer += 4
            positives.append("strong client hire rate")
        elif hire_rate >= 40:
            buyer += 2
        elif hire_rate < 20:
            risks.append("low client hire rate")
    else:
        missing.append("client hire rate")
    buyer = min(20, buyer)

    proposals = str(commercial.get("proposals", "")).lower()
    if "less than" in proposals:
        competition = 12
        positives.append("low visible proposal competition")
    elif re.search(r"\b5\s+to\s+10\b", proposals):
        competition = 10
    elif re.search(r"\b10\s+to\s+15\b", proposals):
        competition = 8
    elif re.search(r"\b15\s+to\s+20\b", proposals):
        competition = 6
    elif re.search(r"\b20\s+to\s+50\b", proposals):
        competition = 3
        risks.append("high visible proposal competition")
    elif "50+" in proposals or "50 plus" in proposals:
        competition = 0
        risks.append("very high visible proposal competition")
    else:
        competition = 5
        missing.append("proposal competition")

    freshness, freshness_missing = _freshness_score(record.get("posted_age") or commercial.get("posted_age"))
    if freshness >= 6:
        positives.append("fresh opportunity")
    if freshness_missing:
        missing.append(freshness_missing)
    timing_competition = min(20, competition + freshness)

    total = min(100, fit + commercial_score + buyer + timing_competition)
    hard_reject = not lanes or (fixed is not None and fixed < 500) or (hourly_min is not None and hourly_min < 10)
    if hard_reject:
        disposition = "reject"
    elif total >= 75 and (fixed is not None or hourly_min is not None) and buyer >= 8 and competition >= 3:
        disposition = "priority_a"
    elif total >= 50:
        disposition = "priority_b"
    else:
        disposition = "research"

    next_action = {
        "priority_a": "Review immediately and submit a tailored Upwork proposal manually within four hours.",
        "priority_b": "Complete human BD review today; clarify missing commercial evidence before bidding.",
        "research": "Open the original job and verify missing buyer, budget or delivery evidence before deciding.",
        "reject": "Do not bid; retain the structured rejection evidence for calibration.",
    }[disposition]

    return {
        "source": "upwork",
        "disposition": disposition,
        "total_score": total,
        "confidence": _confidence(record, missing),
        "dimensions": {
            "service_fit": fit,
            "commercial_value": commercial_score,
            "buyer_quality": buyer,
            "competition_and_timing": timing_competition,
        },
        "service_lanes": lanes,
        "service_route": lanes[0] if lanes else "",
        "positive_reasons": positives,
        "missing_evidence": sorted(set(missing)),
        "risk_reasons": sorted(set(risks)),
        "recommended_next_action": next_action,
        "configuration_version": CONFIGURATION_VERSION,
    }


def _linkedin_decision(record: dict[str, Any], lanes: list[str]) -> dict[str, Any]:
    commercial = _commercial(record)
    positives: list[str] = []
    missing: list[str] = []
    risks: list[str] = []

    intent_phrases = commercial.get("intent_phrases") if isinstance(commercial.get("intent_phrases"), list) else []
    explicit = bool(intent_phrases) or bool(EXPLICIT_INTENT.search(_text(record)))
    signal_type = str(commercial.get("signal_type", ""))
    contact_routes = commercial.get("contact_routes") if isinstance(commercial.get("contact_routes"), list) else []

    fit = min(30, 18 + 4 * len(lanes)) if lanes else 0
    if lanes:
        positives.append(f"service fit: {', '.join(lanes)}")
    else:
        risks.append("no supported service lane")

    if signal_type == "procurement_request":
        intent = 30
        positives.append("formal procurement or proposal request")
    elif explicit:
        intent = 25
        positives.append("explicit buyer requirement")
    else:
        intent = 0
        risks.append("no explicit buyer intent")

    if "proposal" in contact_routes or "email" in contact_routes:
        access = 20
        positives.append("clear manual response route")
    elif "direct_message" in contact_routes:
        access = 14
        positives.append("manual direct-message route visible")
    elif "comment" in contact_routes:
        access = 8
        risks.append("public-comment route only")
    else:
        access = 4
        missing.append("clear response route")

    buyer = 0
    if record.get("author_name"):
        buyer += 10
        positives.append("original author identified")
    else:
        missing.append("original author name")
    if record.get("author_profile_url"):
        buyer += 5
    else:
        missing.append("original author profile")
    if record.get("author_headline") or record.get("company_name"):
        buyer += 5
    else:
        missing.append("author role or company context")

    freshness, freshness_missing = _freshness_score(record.get("posted_age"))
    if freshness >= 6:
        positives.append("fresh LinkedIn requirement")
    if freshness_missing:
        missing.append(freshness_missing)
    total = min(100, fit + intent + access + buyer + min(10, freshness))

    if not lanes or not explicit:
        disposition = "reject"
    elif total >= 75 and record.get("author_name") and (contact_routes or signal_type == "procurement_request"):
        disposition = "priority_a"
    elif total >= 55:
        disposition = "priority_b"
    else:
        disposition = "research"

    next_action = {
        "priority_a": "Open the canonical post, verify the buyer and send a concise manual response today.",
        "priority_b": "Verify author authority and response route before manual outreach.",
        "research": "Research the original author/company and confirm an actionable buying route.",
        "reject": "Do not contact; retain the rejection reason for source calibration.",
    }[disposition]

    return {
        "source": "linkedin",
        "disposition": disposition,
        "total_score": total,
        "confidence": _confidence(record, missing),
        "dimensions": {
            "service_fit": fit,
            "buyer_intent": intent,
            "access_route": access,
            "buyer_identity": buyer,
            "freshness": min(10, freshness),
        },
        "service_lanes": lanes,
        "service_route": lanes[0] if lanes else "",
        "positive_reasons": positives,
        "missing_evidence": sorted(set(missing)),
        "risk_reasons": sorted(set(risks)),
        "recommended_next_action": next_action,
        "configuration_version": CONFIGURATION_VERSION,
    }


def qualify_record(record: dict[str, Any]) -> dict[str, Any]:
    source = str(record.get("source", "")).lower()
    content = _text(record)
    lanes = _service_lanes(record)
    if PROHIBITED.search(content):
        return {
            "source": source,
            "disposition": "reject",
            "total_score": 0,
            "confidence": "high",
            "dimensions": {},
            "service_lanes": lanes,
            "service_route": lanes[0] if lanes else "",
            "positive_reasons": [],
            "missing_evidence": [],
            "risk_reasons": ["prohibited or deceptive work"],
            "recommended_next_action": "Do not contact or bid.",
            "configuration_version": CONFIGURATION_VERSION,
        }
    if EXPLOITATIVE.search(content):
        return {
            "source": source,
            "disposition": "reject",
            "total_score": 5,
            "confidence": "high",
            "dimensions": {},
            "service_lanes": lanes,
            "service_route": lanes[0] if lanes else "",
            "positive_reasons": [],
            "missing_evidence": [],
            "risk_reasons": ["exploitative or unpaid commercial terms"],
            "recommended_next_action": "Do not contact or bid.",
            "configuration_version": CONFIGURATION_VERSION,
        }
    if source == "upwork":
        return _upwork_decision(record, lanes)
    if source == "linkedin":
        return _linkedin_decision(record, lanes)
    raise ValueError("Unsupported qualification source.")
