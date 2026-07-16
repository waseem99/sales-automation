from __future__ import annotations

import re
from typing import Any
from urllib.parse import urlparse

_JOB_ID = re.compile(r"~[A-Za-z0-9_-]{8,}")
_JUNK_MARKERS = (
    "job feedback",
    "just not interested",
    "vague description",
    "unrealistic expectations",
    "too many applicants",
    "job posted too long ago",
    "poor reviews about the client",
    "doesn't match skills",
    "i am overqualified",
    "budget too low",
    "not in my preferred location",
    "the client will not be notified",
    "your feedback helps us improve job search",
)


def canonical_visible_job_url(url: str) -> str | None:
    parsed = urlparse(url)
    if parsed.hostname not in {"upwork.com", "www.upwork.com"}:
        return None
    path = parsed.path
    if not (path.startswith("/jobs/") or path.startswith("/freelance-jobs/apply/")):
        return None
    if not _JOB_ID.search(path):
        return None
    return f"https://www.upwork.com{path}"


def clean_visible_description(*, description: str, card_text: str, title: str) -> tuple[str, dict[str, str]]:
    direct = _cut_junk_tail(_clean_text(description))
    card = _clean_text(card_text)
    title_clean = _clean_text(title)
    derived = _derive_description(card, title_clean)

    if _is_usable_description(direct, title_clean):
        body = direct
        source = "visible_description_node"
        quality = "high" if len(body) >= 160 else "medium"
    elif _is_usable_description(derived, title_clean):
        body = derived
        source = "derived_from_visible_card"
        quality = "medium" if len(body) >= 160 else "low"
    else:
        body = _cut_junk_tail(direct or derived or card)
        source = "fallback_visible_card"
        quality = "low"

    return body[:10_000], {
        "capture_quality": quality,
        "description_source": source,
    }


def parse_visible_card_metrics(text: str) -> dict[str, Any]:
    clean = _clean_text(text)
    fixed = _first_money(
        clean,
        (
            r"Est\.?\s*Budget\s*:?\s*\$([\d,]+(?:\.\d+)?)",
            r"(?:Fixed(?:-price)?[^$]{0,50})?Budget\s*:?\s*\$([\d,]+(?:\.\d+)?)",
        ),
    )
    hourly = re.search(
        r"Hourly\s*:?\s*\$([\d,.]+)\s*-\s*\$([\d,.]+)(?:\s*/?\s*(?:hr|hour))?",
        clean,
        re.I,
    )
    if hourly is None and "hourly" in clean.casefold():
        hourly = re.search(r"\$([\d,.]+)\s*-\s*\$([\d,.]+)(?:\s*/?\s*(?:hr|hour))?", clean, re.I)
    hourly_single = None
    if hourly is None:
        hourly_single = re.search(r"Hourly\s*:?\s*\$([\d,.]+)(?:\s*/?\s*(?:hr|hour))?", clean, re.I)

    hourly_min = float(hourly.group(1).replace(",", "")) if hourly else (
        float(hourly_single.group(1).replace(",", "")) if hourly_single else None
    )
    hourly_max = float(hourly.group(2).replace(",", "")) if hourly else hourly_min
    duration = re.search(
        r"(Less than 1 month|1 to 3 months|3 to 6 months|More than 6 months)",
        clean,
        re.I,
    )
    weekly_hours = _weekly_hours(clean)
    estimated_contract = _estimated_contract_value(hourly_max, weekly_hours, duration.group(1) if duration else None)
    monthly_estimate = hourly_max * 160 if hourly_max is not None else None
    budget = fixed if fixed is not None else estimated_contract if estimated_contract is not None else monthly_estimate

    spend = re.search(r"\$([\d,.]+)\s*([kKmM]?)\+?\s*spent", clean, re.I)
    hire_rate = re.search(r"(\d{1,3})%\s*hire rate", clean, re.I)
    rating = re.search(r"\b([0-5](?:\.\d{1,2})?)\s*(?:of\s*5|stars?)\b", clean, re.I)
    hires = re.search(r"\b(\d[\d,]*)\s+hires?\b", clean, re.I)
    proposals = re.search(
        r"(?:proposals?|applicants?)\s*:?\s*(Fewer than\s+\d+|Less than\s+\d+|\d+\s*to\s*\d+|\d+\+?)",
        clean,
        re.I,
    )
    posted = re.search(r"Posted\s+(.{1,45}?\s+ago|yesterday)", clean, re.I)
    experience = re.search(r"\b(Entry Level|Intermediate|Expert)\b", clean, re.I)

    lowered = clean.casefold()
    if "payment unverified" in lowered:
        payment_status = "unverified"
    elif re.search(r"payment (?:method )?verified", clean, re.I):
        payment_status = "verified"
    else:
        payment_status = "not_visible"

    proposal_activity = proposals.group(1) if proposals else None
    local_required = bool(re.search(r"\b(on[- ]?site|must be located in|local candidates? only)\b", clean, re.I))
    country = _country(clean)
    return {
        "budget_usd": budget,
        "budget_basis": (
            "fixed" if fixed is not None
            else "hourly_contract_estimate" if estimated_contract is not None
            else "hourly_monthly_estimate" if hourly_max is not None
            else None
        ),
        "fixed_budget_usd": fixed,
        "hourly_min_usd": hourly_min,
        "hourly_max_usd": hourly_max,
        "estimated_hours_per_week": weekly_hours,
        "estimated_contract_value_usd": estimated_contract,
        "hourly_estimated_monthly_usd": monthly_estimate,
        "payment_verified": payment_status == "verified",
        "payment_status": payment_status,
        "client_spend_usd": _scaled_money(spend.group(1), spend.group(2)) if spend else None,
        "client_hire_rate": float(hire_rate.group(1)) if hire_rate else None,
        "client_rating": float(rating.group(1)) if rating else None,
        "client_hires": int(hires.group(1).replace(",", "")) if hires else None,
        "proposal_activity": proposal_activity,
        "competition_level": _competition_level(proposal_activity),
        "posted_age": posted.group(1) if posted else None,
        "duration": duration.group(1) if duration else None,
        "experience_level": experience.group(1) if experience else None,
        "client_country": country,
        "local_presence_required": local_required,
        "delivery_country": country if local_required and country else "",
        "enterprise_signal": bool(re.search(r"\b(enterprise|platform|saas|architecture|system design)\b", clean, re.I)),
        "recurring_signal": bool(re.search(r"\b(long[- ]term|ongoing|partner|continuously|maintenance|future phases?)\b", clean, re.I)),
        "custom_delivery_signal": bool(re.search(r"\b(build|develop|implementation|integration|custom|mvp)\b", clean, re.I)),
    }


def _weekly_hours(text: str) -> float | None:
    range_match = re.search(r"(\d+)\s*-\s*(\d+)\s*hrs?/week", text, re.I)
    if range_match:
        return float(range_match.group(2))
    less_match = re.search(r"Less than\s+(\d+)\s*hrs?/week", text, re.I)
    if less_match:
        return float(less_match.group(1))
    more_match = re.search(r"More than\s+(\d+)\s*hrs?/week", text, re.I)
    if more_match:
        return float(more_match.group(1))
    return None


def _estimated_contract_value(hourly_max: float | None, weekly_hours: float | None, duration: str | None) -> float | None:
    if hourly_max is None:
        return None
    hours = weekly_hours or 20.0
    weeks = {
        "less than 1 month": 4,
        "1 to 3 months": 12,
        "3 to 6 months": 24,
        "more than 6 months": 32,
    }.get((duration or "").casefold(), 4)
    return round(hourly_max * hours * weeks, 2)


def _derive_description(card_text: str, title: str) -> str:
    value = _cut_junk_tail(card_text)
    if title:
        index = value.casefold().find(title.casefold())
        if index >= 0:
            value = value[index + len(title):].strip()
    value = re.sub(
        r"^(?:Featured\s+)?Posted\s+.{1,60}?ago\s*[•|\-]?\s*(?:Proposals?\s*:?\s*[^•|]+)?",
        "",
        value,
        flags=re.I,
    ).strip()
    value = re.sub(
        r"^(?:Hourly|Fixed(?:-price)?)\s*:?[^.]{0,160}(?=\.|\b(?:We|I|Our|The|Looking|Seeking|Need|Build)\b)",
        "",
        value,
        flags=re.I,
    ).strip()
    return _cut_junk_tail(value)


def _cut_junk_tail(value: str) -> str:
    lowered = value.casefold()
    indexes = [lowered.find(marker) for marker in _JUNK_MARKERS if lowered.find(marker) >= 0]
    if indexes:
        value = value[: min(indexes)]
    return value.strip(" •|-\t\r\n")


def _is_usable_description(value: str, title: str) -> bool:
    if len(value) < 80:
        return False
    lowered = value.casefold()
    if any(marker in lowered for marker in _JUNK_MARKERS):
        return False
    if title and value.casefold() == title.casefold():
        return False
    return len(value.split()) >= 14


def _competition_level(value: str | None) -> str | None:
    if not value:
        return None
    normalized = value.casefold().replace("fewer than", "less than")
    if "50+" in normalized:
        return "very_high"
    numbers = [int(item) for item in re.findall(r"\d+", normalized)]
    if not numbers:
        return None
    maximum = max(numbers)
    if maximum >= 50:
        return "very_high"
    if maximum >= 20:
        return "high"
    if maximum >= 10:
        return "medium"
    return "low"


def _first_money(text: str, patterns: tuple[str, ...]) -> float | None:
    for pattern in patterns:
        match = re.search(pattern, text, re.I)
        if match:
            return float(match.group(1).replace(",", ""))
    return None


def _scaled_money(value: str, suffix: str) -> float:
    amount = float(value.replace(",", ""))
    if suffix.casefold() == "k":
        return amount * 1_000
    if suffix.casefold() == "m":
        return amount * 1_000_000
    return amount


def _country(text: str) -> str | None:
    countries = (
        "United States", "United Kingdom", "Canada", "Australia", "Germany",
        "France", "Netherlands", "United Arab Emirates", "UAE", "Saudi Arabia",
        "Pakistan", "India", "Singapore", "Ireland", "Sweden", "Norway",
    )
    for country in countries:
        if re.search(rf"\b{re.escape(country)}\b", text, re.I):
            return country
    return None


def _clean_text(value: str) -> str:
    return " ".join(str(value or "").split())
