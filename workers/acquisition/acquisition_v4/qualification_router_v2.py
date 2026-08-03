from __future__ import annotations

import re
from typing import Any

from .qualification import SERVICE_PATTERNS, qualify_record as qualify_opportunity_record
from .qualification_router import _sales_navigator_decision

CONFIGURATION_VERSION = "acquisition-v5-route-confidence-1.0.0"

ROUTE_ORDER = [
    "software_product",
    "ai_automation",
    "cybersecurity",
    "digital_growth",
    "creative_animation",
    "immersive_game",
    "delivery_partner",
]


def _mapping(record: dict[str, Any], key: str) -> dict[str, Any]:
    value = record.get(key)
    return value if isinstance(value, dict) else {}


def _text_parts(record: dict[str, Any]) -> tuple[str, str, str]:
    raw = _mapping(record, "raw_evidence")
    skills = raw.get("skills") if isinstance(raw.get("skills"), list) else []
    title = str(record.get("title") or "")
    body = str(record.get("body") or "")
    skill_text = " ".join(str(item) for item in skills)
    return title, body, skill_text


def _match_count(pattern: re.Pattern[str], value: str) -> int:
    return min(8, len(pattern.findall(value)))


def route_scores(record: dict[str, Any], existing_lanes: list[str]) -> dict[str, int]:
    title, body, skill_text = _text_parts(record)
    commercial = _mapping(record, "commercial_evidence")
    supplied = commercial.get("service_lanes") if isinstance(commercial.get("service_lanes"), list) else []
    scores: dict[str, int] = {}

    for lane, pattern in SERVICE_PATTERNS.items():
        score = 0
        score += _match_count(pattern, title) * 8
        score += _match_count(pattern, body) * 3
        score += _match_count(pattern, skill_text) * 4
        if lane in existing_lanes:
            score += 1
        if lane in supplied:
            score += 1
        if lane == "delivery_partner" and score > 0:
            score = max(1, score - 2)
        scores[lane] = score
    return scores


def _resolved_route(record: dict[str, Any], existing_lanes: list[str]) -> tuple[str, list[str], str, dict[str, int]]:
    scores = route_scores(record, existing_lanes)
    ranked = sorted(ROUTE_ORDER, key=lambda lane: (-scores.get(lane, 0), ROUTE_ORDER.index(lane)))
    positive = [lane for lane in ranked if scores.get(lane, 0) > 0]

    if not positive:
        return "", [], "low", scores

    primary = positive[0]
    top = scores[primary]
    second = scores.get(positive[1], 0) if len(positive) > 1 else 0
    if top >= 12 and top - second >= 5:
        confidence = "high"
    elif top >= 5 and top - second >= 2:
        confidence = "medium"
    else:
        confidence = "low"

    if primary == "delivery_partner" and len(positive) > 1:
        primary = next((lane for lane in positive if lane != "delivery_partner"), primary)
    ordered = [primary, *(lane for lane in positive if lane != primary)]
    return primary, ordered, confidence, scores


def _apply_route_resolution(record: dict[str, Any], decision: dict[str, Any]) -> dict[str, Any]:
    existing = decision.get("service_lanes") if isinstance(decision.get("service_lanes"), list) else []
    primary, lanes, confidence, scores = _resolved_route(record, [str(value) for value in existing])
    updated = dict(decision)
    updated["service_route"] = primary
    updated["service_lanes"] = lanes
    updated["service_route_confidence"] = confidence
    updated["service_route_scores"] = scores
    updated["configuration_version"] = CONFIGURATION_VERSION

    positives = list(updated.get("positive_reasons") or [])
    missing = list(updated.get("missing_evidence") or [])
    risks = list(updated.get("risk_reasons") or [])
    positives = [reason for reason in positives if not str(reason).startswith("service fit:")]
    if primary:
        positives.append(f"service fit: {primary}")
    else:
        risks.append("no supported service route identified")

    source = str(record.get("source") or "").lower()
    disposition = str(updated.get("disposition") or "research")
    if confidence == "low" and disposition in {"priority_a", "priority_b"}:
        updated["disposition"] = "research"
        missing.append("clear service route")
        risks.append("service classification is ambiguous")
        if source == "linkedin":
            updated["recommended_next_action"] = (
                "Keep research-only until the requested service and Codistan delivery route are verified."
            )
        else:
            updated["recommended_next_action"] = (
                "Open the original job and verify the primary delivery route before deciding whether to bid."
            )

    updated["positive_reasons"] = sorted(set(str(value) for value in positives if value))
    updated["missing_evidence"] = sorted(set(str(value) for value in missing if value))
    updated["risk_reasons"] = sorted(set(str(value) for value in risks if value))
    return updated


def qualify_record(record: dict[str, Any]) -> dict[str, Any]:
    source = str(record.get("source") or "").lower()
    if source == "sales_navigator":
        return _sales_navigator_decision(record)
    return _apply_route_resolution(record, qualify_opportunity_record(record))
