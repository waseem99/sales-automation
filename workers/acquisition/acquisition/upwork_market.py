from __future__ import annotations

from dataclasses import replace
import re
from typing import Any

from .models import OpportunityRecord, SourceEvidence
from .qualification import QualificationDecision


PROFILE_METADATA: dict[str, dict[str, str]] = {
    "ai-jobs": {
        "search_name": "AI Jobs",
        "profile_name": "AI Jobs",
        "profile_url": "https://www.upwork.com/freelancers/~016e9a7bda2340dcd9",
        "service_lane": "ai-automation",
    },
    "roshana-2d-3d": {
        "search_name": "2D/3D Modeling & Animations",
        "profile_name": "Roshana",
        "profile_url": "https://www.upwork.com/freelancers/~01323536ddaffbbd34",
        "service_lane": "2d-3d-animation",
    },
    "nadir-game-ar-vr": {
        "search_name": "Game Development & AR/VR",
        "profile_name": "Nadir",
        "profile_url": "https://www.upwork.com/freelancers/~0116e2d98cb771724e",
        "service_lane": "game-ar-vr",
    },
}

_EXCLUDED_COUNTRIES = {
    "pakistan",
    "united arab emirates",
    "saudi arabia",
    "qatar",
    "kuwait",
    "bahrain",
    "oman",
}

_COUNTRY_ALIASES = {
    "usa": "united states",
    "u.s.": "united states",
    "u.s.a.": "united states",
    "united states of america": "united states",
    "uae": "united arab emirates",
}

_COUNTRY_TERMS = (
    "United States",
    "United States of America",
    "USA",
    "Australia",
    "Canada",
    "United Kingdom",
    "Germany",
    "France",
    "Netherlands",
    "Ireland",
    "Singapore",
    "Sweden",
    "Norway",
    "Pakistan",
    "United Arab Emirates",
    "UAE",
    "Saudi Arabia",
    "Qatar",
    "Kuwait",
    "Bahrain",
    "Oman",
)

_ALLOWED_HOURLY_DURATIONS = {"3 to 6 months", "more than 6 months"}
_PRIORITY_A_FIXED_MIN_USD = 5000


def annotate_profile_and_market(
    evidence: SourceEvidence,
    segment: str,
    *,
    visible_client_card_text: str = "",
) -> SourceEvidence:
    attributes = dict(evidence.attributes)
    profile = PROFILE_METADATA.get(segment, {})
    attributes.update(profile)

    country = _country(attributes.get("client_country"))
    country_basis = str(attributes.get("client_country_basis") or "").strip()
    if not country and visible_client_card_text:
        country = _country_from_visible_card(visible_client_card_text)
        if country:
            country_basis = "visible_client_card"
    if not country:
        country = _country_from_explicit_self_location(evidence.body)
        if country:
            country_basis = "explicit_self_location_in_description"
    if country:
        attributes["client_country"] = country
        attributes["client_country_basis"] = country_basis or "existing_evidence"

    commercial_status, commercial_reason = _commercial_filter(attributes)
    market_scopes: list[str] = []
    market_status = "eligible"
    market_reason = "Worldwide commercial filter is eligible."

    if country in _EXCLUDED_COUNTRIES:
        market_status = "excluded_country"
        market_reason = f"Client country is excluded from acquisition focus: {country}."
    elif country == "united states":
        market_scopes = ["us_only", "worldwide"]
        market_reason = "Matches both US-only and worldwide market presets."
    elif country:
        market_scopes = ["worldwide"]
        market_reason = "Matches the worldwide market preset."
    else:
        market_scopes = ["worldwide_pending_country"]
        market_status = "country_unverified"
        market_reason = "Client country is not visible; worldwide eligibility requires BD confirmation."

    if commercial_status == "fail":
        market_status = "commercial_filter_failed"
    elif commercial_status == "unknown" and market_status == "eligible":
        market_status = "commercial_unverified"

    attributes.update(
        {
            "market_scopes": market_scopes,
            "market_policy_status": market_status,
            "market_policy_reason": market_reason,
            "commercial_filter_status": commercial_status,
            "commercial_filter_reason": commercial_reason,
            "commercial_filter_fixed_min_usd": 1000,
            "priority_a_fixed_min_usd": _PRIORITY_A_FIXED_MIN_USD,
            "commercial_filter_hourly_requirement": "more_than_30_hours_per_week",
            "commercial_filter_hourly_durations": ["3 to 6 months", "more than 6 months"],
            "excluded_market_countries": sorted(_EXCLUDED_COUNTRIES),
        }
    )
    return SourceEvidence(
        source=evidence.source,
        source_id=evidence.source_id,
        source_url=evidence.source_url,
        captured_at=evidence.captured_at,
        title=evidence.title,
        body=evidence.body,
        segment=evidence.segment,
        attributes=attributes,
    )


def apply_market_policy(record: OpportunityRecord, decision: QualificationDecision) -> QualificationDecision:
    attributes = record.evidence.attributes
    status = str(attributes.get("market_policy_status") or "").strip()
    commercial = str(attributes.get("commercial_filter_status") or "").strip()
    reason = str(attributes.get("market_policy_reason") or "").strip()
    commercial_reason = str(attributes.get("commercial_filter_reason") or "").strip()

    if status in {"excluded_country", "commercial_filter_failed"} or commercial == "fail":
        risks = _append(decision.risks, reason, commercial_reason)
        reasons = _append(decision.reasons, "Opportunity is outside the approved acquisition filters.")
        return replace(
            decision,
            disposition="reject",
            priority="C",
            score=min(decision.score, 35),
            reasons=reasons,
            risks=risks,
            recommended_action="Archive: outside approved country or commercial engagement filters.",
        )

    if status in {"country_unverified", "commercial_unverified"} or commercial == "unknown":
        missing = _append(decision.missing_evidence, "market_or_commercial_filter_evidence")
        risks = _append(decision.risks, reason, commercial_reason)
        return replace(
            decision,
            disposition="bd_review" if decision.disposition != "reject" else decision.disposition,
            priority="B" if decision.priority == "A" else decision.priority,
            score=min(decision.score, 74),
            missing_evidence=missing,
            risks=risks,
            recommended_action=(
                "Confirm client country and the $1,000+ fixed-price or more-than-30-hours/week, "
                "3-6 month / 6+ month hourly engagement filter before pursuit."
            ),
        )

    fixed = _number(attributes.get("fixed_budget_usd"))
    competition = str(attributes.get("competition_level") or "").strip().casefold()
    if decision.priority == "A" and fixed is not None and fixed < _PRIORITY_A_FIXED_MIN_USD:
        return replace(
            decision,
            disposition="qualified" if decision.disposition != "reject" else decision.disposition,
            priority="B",
            score=min(decision.score, 74),
            risks=_append(decision.risks, "fixed_budget_below_priority_a_threshold"),
            recommended_action=(
                "Priority B — technically relevant, but the fixed budget is in the $1,000-$4,999 tier. "
                "Review scope realism and buyer intent before using connects."
            ),
        )

    if decision.priority == "A" and competition == "very_high":
        return replace(
            decision,
            disposition="qualified" if decision.disposition != "reject" else decision.disposition,
            priority="B",
            score=min(decision.score, 74),
            risks=_append(decision.risks, "very_high_competition_priority_cap"),
            recommended_action=(
                "Priority B — strong fit but very high competition. Review immediately and pursue only "
                "when the profile proof and proposal angle are unusually strong."
            ),
        )

    return decision


def _commercial_filter(attributes: dict[str, Any]) -> tuple[str, str]:
    fixed = _number(attributes.get("fixed_budget_usd"))
    hourly_min = _number(attributes.get("hourly_min_usd"))
    hourly_max = _number(attributes.get("hourly_max_usd"))
    weekly_hours = _number(attributes.get("estimated_hours_per_week"))
    weekly_basis = str(attributes.get("weekly_hours_basis") or "").strip().casefold()
    duration = str(attributes.get("duration") or "").strip().casefold()

    if fixed is not None:
        if fixed >= 1000:
            return "pass", f"Fixed-price budget is ${fixed:,.0f}, meeting the $1,000+ filter."
        return "fail", f"Fixed-price budget is ${fixed:,.0f}, below the $1,000 minimum."

    if hourly_min is not None or hourly_max is not None:
        if weekly_hours is None or not duration:
            return "unknown", "Hourly rate is visible, but duration or weekly hours are missing."
        more_than_30 = weekly_hours > 30 or (weekly_basis == "more_than" and weekly_hours >= 30)
        if more_than_30 and duration in _ALLOWED_HOURLY_DURATIONS:
            hours_label = f"More than {weekly_hours:,.0f}" if weekly_basis == "more_than" else f"{weekly_hours:,.0f}"
            return "pass", f"Hourly engagement is {hours_label} hours/week for {duration}."
        return "fail", (
            f"Hourly engagement does not match more than 30 hours/week and the approved 3-6 month "
            f"or 6+ month duration filter (hours={weekly_hours}, basis={weekly_basis or 'missing'}, "
            f"duration={duration or 'missing'})."
        )

    return "unknown", "Fixed budget and qualifying hourly engagement evidence are not visible."


def _country(value: object) -> str:
    text = str(value or "").strip().casefold()
    return _COUNTRY_ALIASES.get(text, text)


def _country_from_visible_card(value: str) -> str:
    for term in _COUNTRY_TERMS:
        if re.search(rf"\b{re.escape(term)}\b", value, re.I):
            return _country(term)
    return ""


def _country_from_explicit_self_location(value: str) -> str:
    text = " ".join(str(value or "").split())
    for term in _COUNTRY_TERMS:
        escaped = re.escape(term)
        patterns = (
            rf"\bI\s+am\b.{{0,45}}\bfrom\s+{escaped}\b",
            rf"\bwe\s+are\b.{{0,45}}\b(?:based|located)\s+in\s+{escaped}\b",
            rf"\bour\s+(?:company|business|firm|team)\b.{{0,55}}\b(?:based|located|headquartered)\s+in\s+{escaped}\b",
            rf"\b(?:company|business|firm|team)\s+(?:is\s+)?(?:based|located|headquartered)\s+in\s+{escaped}\b",
        )
        if any(re.search(pattern, text, re.I) for pattern in patterns):
            return _country(term)
    return ""


def _number(value: object) -> float | None:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _append(values: tuple[str, ...], *items: str) -> tuple[str, ...]:
    result = list(values)
    seen = {value.casefold() for value in result}
    for item in items:
        text = item.strip()
        if text and text.casefold() not in seen:
            result.append(text)
            seen.add(text.casefold())
    return tuple(result)
