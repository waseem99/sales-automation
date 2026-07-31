from __future__ import annotations

import hashlib
import json
import re
from typing import Any, Final
from urllib.parse import urlparse

CLASSIFIER_VERSION: Final = "linkedin-warm-intent.v1"

INTENT_CATEGORIES: Final[tuple[str, ...]] = (
    "explicit_project_vendor_request",
    "looking_for_agency_partner",
    "implementation_problem",
    "capacity_overflow_need",
    "referral_request",
    "recommendation_request",
    "employee_hiring",
    "contractor_hiring",
    "job_seeker",
    "recruiter_advertisement",
    "vendor_self_promotion",
    "thought_leadership_news",
    "event_course_promotion",
    "unclear_research",
)

ACTIONABLE_CATEGORIES: Final[frozenset[str]] = frozenset({
    "explicit_project_vendor_request",
    "looking_for_agency_partner",
    "implementation_problem",
    "capacity_overflow_need",
    "referral_request",
    "recommendation_request",
})

STRONG_NEGATIVE_CATEGORIES: Final[frozenset[str]] = frozenset({
    "employee_hiring",
    "contractor_hiring",
    "job_seeker",
    "recruiter_advertisement",
    "vendor_self_promotion",
    "thought_leadership_news",
    "event_course_promotion",
})

CATEGORY_LABELS: Final[dict[str, str]] = {
    "explicit_project_vendor_request": "explicit project/vendor request",
    "looking_for_agency_partner": "looking for agency/partner",
    "implementation_problem": "implementation problem",
    "capacity_overflow_need": "capacity/overflow need",
    "referral_request": "referral request",
    "recommendation_request": "recommendation request",
    "employee_hiring": "employee hiring",
    "contractor_hiring": "contractor hiring",
    "job_seeker": "job seeker",
    "recruiter_advertisement": "recruiter advertisement",
    "vendor_self_promotion": "vendor self-promotion",
    "thought_leadership_news": "thought leadership/news",
    "event_course_promotion": "event/course promotion",
    "unclear_research": "unclear/research",
}

PROJECT_VENDOR_REQUEST = re.compile(
    r"\b(?:request for proposals?|\brfp\b|request for quotation|\brfq\b|"
    r"submit (?:a )?(?:proposal|quotation|quote)|send (?:us|me) (?:a )?(?:proposal|quotation|quote)|"
    r"inviting (?:agencies|vendors|consultants|partners)|vendor selection|procurement request|"
    r"need (?:an?|the) (?:vendor|provider|consultant|development team|delivery team)|"
    r"project (?:partner|vendor|implementation team))\b",
    re.I,
)
AGENCY_PARTNER_REQUEST = re.compile(
    r"\b(?:looking for|seeking|need(?:ing)?|searching for|want to engage|interested in finding)\b"
    r".{0,100}\b(?:agency|agencies|vendor|vendors|partner|partners|consultant|consultancy|"
    r"software house|development team|implementation team|delivery team|service provider)\b|"
    r"\b(?:agency|vendor|partner|consultant|service provider) recommendations?\b",
    re.I | re.S,
)
IMPLEMENTATION_PROBLEM = re.compile(
    r"\b(?:struggling (?:with|to)|need help (?:with|implementing|integrating|migrating|automating)|"
    r"implementation (?:challenge|problem|support|help)|integration (?:challenge|problem|support)|"
    r"migration (?:challenge|problem|support)|our current (?:system|workflow|platform).{0,60}(?:failing|manual|fragmented|slow)|"
    r"help us (?:build|implement|integrate|migrate|automate|modernize|modernise))\b",
    re.I | re.S,
)
CAPACITY_OVERFLOW_NEED = re.compile(
    r"\b(?:overflow (?:work|projects?|capacity)|need (?:more|additional|extra) (?:capacity|bandwidth|developers?|engineers?|delivery support)|"
    r"delivery bandwidth|engineering bandwidth|resource crunch|backlog support|white[- ]label (?:partner|support|team)|"
    r"subcontract(?:ing|or)? (?:partner|support|team)|augment (?:our )?team|scale (?:our )?delivery)\b",
    re.I,
)
REFERRAL_REQUEST = re.compile(
    r"\b(?:can (?:someone|anyone) (?:refer|connect|introduce)|looking for (?:an )?introduction|"
    r"please (?:refer|connect|introduce) (?:me|us)|who can connect (?:me|us)|referral (?:needed|request))\b",
    re.I,
)
RECOMMENDATION_REQUEST = re.compile(
    r"\b(?:any recommendations?|who (?:would you|do you) recommend|can anyone recommend|"
    r"recommend (?:an?|a reliable) (?:agency|vendor|partner|consultant|provider)|"
    r"suggest (?:an?|a reliable) (?:agency|vendor|partner|consultant|provider))\b",
    re.I,
)

JOB_SEEKER = re.compile(
    r"\b(?:open to work|seeking (?:a|my next) (?:role|job|position|opportunity)|looking for (?:a )?(?:job|role|position)|"
    r"available for (?:new )?opportunities|please review my (?:cv|resume)|my resume|my cv|"
    r"actively applying|job search|hire me)\b",
    re.I,
)
RECRUITER_AD = re.compile(
    r"\b(?:recruiter|talent acquisition|staffing agency|recruitment agency|hiring for (?:one of )?our clients?|"
    r"send (?:your|me your) (?:cv|resume)|apply (?:here|now)|job opening|vacancy)\b",
    re.I,
)
EMPLOYEE_HIRING = re.compile(
    r"\b(?:join our team|full[- ]time (?:role|position|employee)|permanent (?:role|position|employee)|"
    r"we are hiring|we're hiring|hiring (?:a|an|for)|salary and benefits|employee benefits|"
    r"onsite role|on[- ]site role|hybrid role|w-?2 role|payroll position|internship|interns? wanted)\b",
    re.I,
)
CONTRACTOR_HIRING = re.compile(
    r"\b(?:contract role|contract position|individual contractor|freelance (?:role|developer|designer|engineer|specialist)|"
    r"independent contractor|hourly contractor|part[- ]time contractor|1099 contractor|"
    r"looking for (?:an?|one) (?:freelancer|contractor|developer|engineer|designer) to join)\b",
    re.I,
)
VENDOR_SELF_PROMOTION = re.compile(
    r"\b(?:we help (?:companies|businesses|teams)|our agency|our services|book a demo|book a call|"
    r"case study|client success story|proud to announce|we launched|introducing our|"
    r"offering (?:our )?(?:services|solutions)|dm me for (?:services|details)|"
    r"contact us for (?:services|a quote)|our portfolio)\b",
    re.I,
)
EVENT_COURSE_PROMOTION = re.compile(
    r"\b(?:webinar|workshop|conference|summit|meetup|masterclass|course|cohort|bootcamp|"
    r"register now|reserve your seat|tickets? available|live session|training session|"
    r"event starts|join us (?:for|at) (?:our|the))\b",
    re.I,
)
THOUGHT_LEADERSHIP_NEWS = re.compile(
    r"\b(?:thoughts on|my take on|insights on|industry trends?|latest news|news update|"
    r"sharing (?:an )?(?:article|report|guide|insight)|new report|research report|"
    r"ai is (?:changing|transforming)|future of|top \d+|lessons learned|"
    r"here's what I learned|weekly roundup|newsletter)\b",
    re.I,
)
REPOST_SIGNAL = re.compile(r"\b(?:repost|reposted|reshared|shared from|via @|credit to)\b", re.I)
CLOSED_SIGNAL = re.compile(
    r"\b(?:applications? closed|request closed|position filled|vendor selected|project awarded|"
    r"no longer accepting|opportunity closed|already hired|we have selected|closed now)\b",
    re.I,
)
UNPAID_SIGNAL = re.compile(r"\b(?:unpaid|free work|work for exposure|equity only|commission only|internship without pay)\b", re.I)
AGENCY_OR_VENDOR_WORD = re.compile(r"\b(?:agency|agencies|vendor|partner|consultant|consultancy|service provider|delivery team)\b", re.I)


def classify_linkedin_intent(record: dict[str, Any]) -> dict[str, Any]:
    """Classify LinkedIn evidence without performing or authorizing any external action."""

    title = str(record.get("title") or "").strip()
    body = str(record.get("body") or "").strip()
    text = f"{title}\n{body}".strip()
    raw = _as_dict(record.get("raw_evidence"))
    commercial = _as_dict(record.get("commercial_evidence"))
    canonical_url = str(record.get("canonical_url") or "").strip()
    source_native_id = str(record.get("source_native_id") or "").strip()
    author_name = str(record.get("author_name") or "").strip()
    author_profile_url = str(record.get("author_profile_url") or "").strip()
    author_headline = str(record.get("author_headline") or "").strip()
    company_name = str(record.get("company_name") or "").strip()

    positive_reasons: list[str] = []
    negative_reasons: list[str] = []
    matched_signals: list[str] = []

    cold_source = _is_cold_fit_record(record, raw, commercial)
    traceable_post = _is_traceable_linkedin_post(canonical_url)
    repost_without_context = _is_repost_without_buyer_context(record, raw, text)
    freshness_status, freshness_reason = _freshness(record, commercial, text)

    category = "unclear_research"

    if cold_source:
        negative_reasons.append("The record is a cold-fit/prospect record, not buyer-authored warm demand.")
        matched_signals.append("cold_source_classification")
    elif JOB_SEEKER.search(text):
        category = "job_seeker"
        negative_reasons.append("The author is seeking employment rather than buying an external service.")
        matched_signals.append("job_seeker_language")
    elif RECRUITER_AD.search(text) and (EMPLOYEE_HIRING.search(text) or CONTRACTOR_HIRING.search(text)):
        category = "recruiter_advertisement"
        negative_reasons.append("The post is a recruiter or staffing advertisement rather than buyer-authored service demand.")
        matched_signals.append("recruiter_advertisement_language")
    elif EMPLOYEE_HIRING.search(text) or UNPAID_SIGNAL.search(text):
        category = "employee_hiring"
        negative_reasons.append("The post is hiring for an employee/intern role rather than engaging an external delivery provider.")
        matched_signals.append("employee_hiring_language")
        if UNPAID_SIGNAL.search(text):
            negative_reasons.append("The post includes unpaid, exposure, equity-only or commission-only terms.")
            matched_signals.append("unpaid_or_exploitative_terms")
    elif CONTRACTOR_HIRING.search(text) and not AGENCY_OR_VENDOR_WORD.search(text):
        category = "contractor_hiring"
        negative_reasons.append("The post seeks an individual contractor/freelancer rather than an agency or managed delivery partner.")
        matched_signals.append("individual_contractor_language")
    elif EVENT_COURSE_PROMOTION.search(text):
        category = "event_course_promotion"
        negative_reasons.append("The post promotes an event, course or training rather than expressing a buying requirement.")
        matched_signals.append("event_or_course_promotion")
    elif VENDOR_SELF_PROMOTION.search(text) and not _positive_demand_pattern(text):
        category = "vendor_self_promotion"
        negative_reasons.append("The author is promoting their own vendor/service offering rather than requesting delivery support.")
        matched_signals.append("vendor_self_promotion")
    elif THOUGHT_LEADERSHIP_NEWS.search(text) and not _positive_demand_pattern(text):
        category = "thought_leadership_news"
        negative_reasons.append("The post is thought leadership, news or generic content without a traceable buying request.")
        matched_signals.append("thought_leadership_or_news")
    elif PROJECT_VENDOR_REQUEST.search(text):
        category = "explicit_project_vendor_request"
        positive_reasons.append("The post contains an explicit project, procurement, proposal or vendor-selection request.")
        matched_signals.append("explicit_project_or_vendor_request")
    elif REFERRAL_REQUEST.search(text):
        category = "referral_request"
        positive_reasons.append("The author explicitly requests a referral or introduction to a provider.")
        matched_signals.append("referral_request")
    elif RECOMMENDATION_REQUEST.search(text):
        category = "recommendation_request"
        positive_reasons.append("The author explicitly requests a provider recommendation.")
        matched_signals.append("recommendation_request")
    elif AGENCY_PARTNER_REQUEST.search(text):
        category = "looking_for_agency_partner"
        positive_reasons.append("The post explicitly looks for an agency, vendor, consultant or delivery partner.")
        matched_signals.append("agency_or_partner_request")
    elif CAPACITY_OVERFLOW_NEED.search(text):
        category = "capacity_overflow_need"
        positive_reasons.append("The post describes delivery capacity, overflow, bandwidth or white-label support demand.")
        matched_signals.append("capacity_or_overflow_need")
    elif IMPLEMENTATION_PROBLEM.search(text):
        category = "implementation_problem"
        positive_reasons.append("The post describes a concrete implementation, integration, migration or automation problem.")
        matched_signals.append("implementation_problem")
    else:
        negative_reasons.append("No sufficiently specific buyer-authored service demand category was established.")
        matched_signals.append("insufficient_demand_evidence")

    if repost_without_context:
        negative_reasons.append("The evidence is a repost/share without original buyer context from this author.")
        matched_signals.append("repost_without_buyer_context")
    if not traceable_post:
        negative_reasons.append("A canonical LinkedIn post URL is missing or is not traceable to a post/update.")
        matched_signals.append("untraceable_canonical_url")
    if not author_name:
        negative_reasons.append("The original post author is not identified.")
        matched_signals.append("missing_original_author")
    if freshness_reason:
        if freshness_status == "current":
            positive_reasons.append(freshness_reason)
        else:
            negative_reasons.append(freshness_reason)
        matched_signals.append(f"freshness_{freshness_status}")

    strong_negative = category in STRONG_NEGATIVE_CATEGORIES
    stale_or_closed = freshness_status in {"stale", "closed"}
    actionable_category = category in ACTIONABLE_CATEGORIES
    buyer_authored = bool(author_name and traceable_post and not repost_without_context and not cold_source)
    buyer_intent_confirmed = bool(
        actionable_category
        and buyer_authored
        and freshness_status == "current"
        and not strong_negative
        and not stale_or_closed
    )
    actionable_warm_demand = buyer_intent_confirmed

    if actionable_category and not buyer_intent_confirmed:
        negative_reasons.append("Potential demand remains research-only until author, canonical evidence and freshness are confirmed.")
    if freshness_status == "closed":
        negative_reasons.append("The request is closed or already filled and cannot enter an actionable queue.")
    elif freshness_status == "stale":
        negative_reasons.append("The request is stale and cannot enter an actionable queue without fresh evidence.")

    disposition = (
        "reject"
        if strong_negative or stale_or_closed or repost_without_context
        else "actionable"
        if actionable_warm_demand
        else "research"
    )

    evidence = {
        "canonical_url": canonical_url or None,
        "source_native_id": source_native_id or None,
        "title": title,
        "body": body,
        "author_name": author_name or None,
        "author_profile_url": author_profile_url or None,
        "author_headline": author_headline or None,
        "company_name": company_name or None,
        "posted_age": record.get("posted_age"),
        "page_identity": record.get("page_identity"),
        "source": str(record.get("source") or "linkedin"),
        "lead_type": record.get("lead_type"),
        "prospect_stage": record.get("prospect_stage"),
    }
    evidence_hash = hashlib.sha256(
        json.dumps(evidence, sort_keys=True, separators=(",", ":"), default=str).encode("utf-8")
    ).hexdigest()

    return {
        "version": CLASSIFIER_VERSION,
        "category": category,
        "category_label": CATEGORY_LABELS[category],
        "disposition": disposition,
        "actionable_category": actionable_category,
        "buyer_authored": buyer_authored,
        "buyer_intent_confirmed": buyer_intent_confirmed,
        "actionable_warm_demand": actionable_warm_demand,
        "strong_negative": strong_negative,
        "freshness_status": freshness_status,
        "traceable_post": traceable_post,
        "repost_without_buyer_context": repost_without_context,
        "cold_source_preserved": cold_source,
        "positive_reasons": _unique(positive_reasons),
        "negative_reasons": _unique(negative_reasons),
        "matched_signals": _unique(matched_signals),
        "evidence": evidence,
        "evidence_hash": evidence_hash,
        "original_source_classification_preserved": True,
        "human_review_required": True,
        "external_action_automated": False,
    }


def _positive_demand_pattern(text: str) -> bool:
    return bool(
        PROJECT_VENDOR_REQUEST.search(text)
        or AGENCY_PARTNER_REQUEST.search(text)
        or IMPLEMENTATION_PROBLEM.search(text)
        or CAPACITY_OVERFLOW_NEED.search(text)
        or REFERRAL_REQUEST.search(text)
        or RECOMMENDATION_REQUEST.search(text)
    )


def _is_cold_fit_record(
    record: dict[str, Any],
    raw: dict[str, Any],
    commercial: dict[str, Any],
) -> bool:
    source = str(record.get("source") or "").lower()
    lead_type = str(record.get("lead_type") or raw.get("lead_type") or "").lower()
    stage = str(record.get("prospect_stage") or raw.get("prospect_stage") or "").lower()
    source_classification = str(
        raw.get("source_classification")
        or commercial.get("source_classification")
        or ""
    ).lower()
    return bool(
        source == "sales_navigator"
        or lead_type in {"sales_navigator_cold_prospect", "linkedin_cold_prospect"}
        or stage == "cold_prospect"
        or source_classification in {"cold", "cold_fit", "cold_no_confirmed_intent"}
    )


def _is_traceable_linkedin_post(value: str) -> bool:
    if not value:
        return False
    try:
        parsed = urlparse(value)
    except ValueError:
        return False
    host = parsed.hostname.lower() if parsed.hostname else ""
    path = parsed.path.lower()
    if host not in {"linkedin.com", "www.linkedin.com"}:
        return False
    return path.startswith("/posts/") or path.startswith("/feed/update/") or path.startswith("/pulse/")


def _is_repost_without_buyer_context(record: dict[str, Any], raw: dict[str, Any], text: str) -> bool:
    explicit_repost = bool(
        raw.get("is_repost") is True
        or raw.get("reshared") is True
        or raw.get("repost_of")
        or record.get("is_repost") is True
    )
    textual_repost = bool(REPOST_SIGNAL.search(text))
    has_context = bool(
        str(raw.get("repost_comment") or record.get("repost_comment") or "").strip()
        or _positive_demand_pattern(text)
    )
    return bool((explicit_repost or textual_repost) and not has_context)


def _freshness(
    record: dict[str, Any],
    commercial: dict[str, Any],
    text: str,
) -> tuple[str, str | None]:
    status = str(
        record.get("request_status")
        or commercial.get("request_status")
        or commercial.get("status")
        or ""
    ).strip().lower()
    if status in {"closed", "filled", "awarded", "expired", "inactive"} or CLOSED_SIGNAL.search(text):
        return "closed", "The post indicates that the request is closed, filled, awarded or no longer accepting responses."

    raw_age = record.get("posted_age") or commercial.get("posted_age")
    age = str(raw_age or "").strip().lower()
    if not age:
        return "unknown", "Posting freshness is unknown."
    if any(token in age for token in ("minute", "minutes", "hour", "hours")) or re.fullmatch(r"\d+\s*[mh]", age):
        return "current", "The post is recent based on the captured posting age."
    if age in {"today", "yesterday", "1d", "1 day", "1 day ago"}:
        return "current", "The post is recent based on the captured posting age."
    day_match = re.search(r"(\d+)\s*(?:d|day|days)", age)
    if day_match:
        days = int(day_match.group(1))
        if days <= 7:
            return "current", "The post is within the seven-day warm-demand review window."
        return "stale", f"The post is approximately {days} days old, outside the seven-day warm-demand window."
    if "week" in age or re.search(r"\d+\s*w\b", age):
        return "stale", "The post is at least one week old and requires fresh evidence."
    if "month" in age or "year" in age:
        return "stale", "The post is materially stale and cannot be treated as current demand."
    return "unknown", "Posting freshness could not be resolved from the captured evidence."


def _as_dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _unique(values: list[str]) -> list[str]:
    return list(dict.fromkeys(value for value in values if value))
