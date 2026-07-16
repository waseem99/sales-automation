from __future__ import annotations

from dataclasses import asdict, dataclass
from pathlib import Path
import re
import tomllib
from typing import Any

from .models import OpportunityRecord


@dataclass(frozen=True, slots=True)
class ProofConfig:
    id: str
    title: str
    approved: bool
    service_ids: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class ServiceRule:
    id: str
    business_unit: str
    keywords: tuple[str, ...]
    minimum_budget_usd: int
    remote_delivery: bool
    proof_ids: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class QualificationConfig:
    version: str
    proposal_ready_score: int
    contact_ready_score: int
    qualified_score: int
    bd_review_score: int
    priority_a_score: int
    priority_b_score: int
    prohibited_terms: tuple[str, ...]
    services: tuple[ServiceRule, ...]
    proofs: tuple[ProofConfig, ...]


@dataclass(frozen=True, slots=True)
class QualificationDecision:
    disposition: str
    priority: str
    score: int
    confidence: str
    business_unit: str | None
    service_id: str | None
    dimensions: dict[str, int]
    reasons: tuple[str, ...]
    missing_evidence: tuple[str, ...]
    risks: tuple[str, ...]
    proof_ids: tuple[str, ...]
    recommended_action: str
    configuration_version: str

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def load_qualification_config(path: Path) -> QualificationConfig:
    with path.open("rb") as handle:
        raw = tomllib.load(handle)
    settings = raw.get("qualification", {})
    services = tuple(
        ServiceRule(
            id=_text(item, "id"),
            business_unit=_text(item, "business_unit"),
            keywords=tuple(_list(item.get("keywords", []))),
            minimum_budget_usd=max(0, int(item.get("minimum_budget_usd", 0))),
            remote_delivery=bool(item.get("remote_delivery", True)),
            proof_ids=tuple(_list(item.get("proof_ids", []))),
        )
        for item in raw.get("services", [])
    )
    proofs = tuple(
        ProofConfig(
            id=_text(item, "id"),
            title=_text(item, "title"),
            approved=bool(item.get("approved", False)),
            service_ids=tuple(_list(item.get("service_ids", []))),
        )
        for item in raw.get("proofs", [])
    )
    if not services:
        raise ValueError("At least one qualification service rule is required")
    return QualificationConfig(
        version=_text(settings, "version"),
        proposal_ready_score=int(settings.get("proposal_ready_score", 82)),
        contact_ready_score=int(settings.get("contact_ready_score", 72)),
        qualified_score=int(settings.get("qualified_score", 60)),
        bd_review_score=int(settings.get("bd_review_score", 45)),
        priority_a_score=int(settings.get("priority_a_score", 72)),
        priority_b_score=int(settings.get("priority_b_score", 45)),
        prohibited_terms=tuple(_list(settings.get("prohibited_terms", []))),
        services=services,
        proofs=proofs,
    )


def qualify(record: OpportunityRecord, config: QualificationConfig) -> QualificationDecision:
    evidence = record.evidence
    title_text = _normalize(evidence.title)
    body_text = _normalize(evidence.body)
    attributes_text = _normalize(" ".join(map(str, evidence.attributes.values())))
    text = _normalize(f"{title_text} {body_text} {attributes_text}")
    risks: list[str] = []
    missing: list[str] = []
    reasons: list[str] = []

    prohibited = [term for term in config.prohibited_terms if _contains_keyword(text, term)]
    if prohibited:
        return QualificationDecision(
            disposition="reject",
            priority="C",
            score=0,
            confidence="high",
            business_unit=None,
            service_id=None,
            dimensions={
                "commercial_potential": 0,
                "technical_fit": 0,
                "buyer_quality": 0,
                "competition_timing": 0,
            },
            reasons=("Prohibited or unsuitable work signal detected.",),
            missing_evidence=(),
            risks=tuple(f"prohibited:{term}" for term in prohibited),
            proof_ids=(),
            recommended_action="Priority C — archive. Do not pursue.",
            configuration_version=config.version,
        )

    service, match_score, matched_keywords = _best_service(evidence, config.services)
    if service is None:
        missing.append("verified service fit")
    else:
        preview = ", ".join(matched_keywords[:4])
        reasons.append(
            f"Matched {service.business_unit} with {len(matched_keywords)} service signal(s)"
            + (f": {preview}." if preview else ".")
        )

    budget = _first_number(
        evidence.attributes.get("fixed_budget_usd"),
        evidence.attributes.get("estimated_contract_value_usd"),
        evidence.attributes.get("budget_usd"),
    )
    buyer_spend = _number(evidence.attributes.get("client_spend_usd"))
    hire_rate = _number(evidence.attributes.get("client_hire_rate"))
    client_rating = _number(evidence.attributes.get("client_rating"))
    payment_verified = _bool(evidence.attributes.get("payment_verified"))
    payment_status = str(evidence.attributes.get("payment_status", "not_visible")).strip().lower()
    proposal_activity = str(evidence.attributes.get("proposal_activity", "")).strip()
    competition_level = str(evidence.attributes.get("competition_level", "")).strip().lower()
    capture_quality = str(evidence.attributes.get("capture_quality", "high")).strip().lower()
    posted_age = str(evidence.attributes.get("posted_age", "")).strip()

    commercial_score = _commercial_potential(
        text=text,
        service=service,
        budget=budget,
        reasons=reasons,
        risks=risks,
        missing=missing,
    )
    technical_score = _technical_fit(
        text=text,
        service=service,
        match_score=match_score,
        reasons=reasons,
    )
    buyer_score = _buyer_quality(
        body=evidence.body,
        payment_verified=payment_verified,
        payment_status=payment_status,
        buyer_spend=buyer_spend,
        hire_rate=hire_rate,
        client_rating=client_rating,
        risks=risks,
        missing=missing,
    )
    competition_score = _competition_timing(
        competition_level=competition_level,
        proposal_activity=proposal_activity,
        posted_age=posted_age,
        reasons=reasons,
        risks=risks,
    )

    concrete_source = bool(
        evidence.source_url
        and evidence.body
        and evidence.title
        and (evidence.source != "upwork" or re.search(r"~[A-Za-z0-9_-]{8,}", evidence.source_url))
    )
    if not concrete_source:
        risks.append("non_concrete_source_url")
    if capture_quality == "low":
        risks.append("low_capture_quality")
        missing.append("complete clean job description")
    elif capture_quality == "medium":
        missing.append("full job-detail verification")

    local_required = _bool(evidence.attributes.get("local_presence_required"))
    delivery_country = str(evidence.attributes.get("delivery_country", "")).strip().lower()
    if local_required and delivery_country not in {"", "pakistan"}:
        risks.append("unsupported_local_presence")
    if service and not service.remote_delivery and delivery_country not in {"", "pakistan"}:
        risks.append("service_not_remote_suitable")

    dimensions = {
        "commercial_potential": commercial_score,
        "technical_fit": technical_score,
        "buyer_quality": buyer_score,
        "competition_timing": competition_score,
    }
    risk_penalties = {
        "budget_below_minimum": 15,
        "payment_unverified": 2,
        "low_capture_quality": 12,
        "non_concrete_source_url": 12,
        "unsupported_local_presence": 35,
        "service_not_remote_suitable": 35,
    }
    penalty = sum(risk_penalties.get(risk, 0) for risk in set(risks))
    score = max(0, min(100, sum(dimensions.values()) - penalty))

    proof_ids = _approved_proofs(service, config) if service else ()
    if service and not proof_ids:
        missing.append("approved portfolio proof")

    critical_risks = {
        "unsupported_local_presence",
        "service_not_remote_suitable",
        "non_concrete_source_url",
    }.intersection(risks)

    confidence_points = 0
    confidence_points += 2 if concrete_source else 0
    confidence_points += 2 if capture_quality == "high" else 1 if capture_quality == "medium" else 0
    confidence_points += 1 if budget is not None else 0
    confidence_points += 1 if buyer_score >= 8 else 0
    confidence = "high" if confidence_points >= 5 else "medium" if confidence_points >= 3 else "low"

    if critical_risks or service is None:
        priority = "C"
    elif score >= config.priority_a_score and capture_quality != "low":
        priority = "A"
    elif score >= config.priority_b_score:
        priority = "B"
    else:
        priority = "C"

    if critical_risks:
        disposition = "reject"
    elif service is None:
        disposition = "bd_review" if score >= config.bd_review_score else "reject"
    elif priority == "A" and score >= config.proposal_ready_score and proof_ids and confidence != "low":
        disposition = "proposal_ready"
    elif priority == "A" and score >= config.contact_ready_score:
        disposition = "contact_ready"
    elif score >= config.qualified_score:
        disposition = "qualified"
    elif score >= config.bd_review_score:
        disposition = "bd_review"
    else:
        disposition = "reject"

    action = {
        "proposal_ready": "Priority A — prepare a source-specific proposal draft for human review within 24 hours.",
        "contact_ready": "Priority A — validate the live job detail and prepare contact/proposal material within 24 hours.",
        "qualified": (
            "Priority A — verify missing commercial details and assign an owner."
            if priority == "A"
            else "Priority B — review the live job detail and decide whether to pursue."
        ),
        "bd_review": "Priority B — BD review required; validate budget, buyer quality and full job detail.",
        "reject": "Priority C — archive unless a human reviewer overrides the decision.",
    }[disposition]
    return QualificationDecision(
        disposition=disposition,
        priority=priority,
        score=score,
        confidence=confidence,
        business_unit=service.business_unit if service else None,
        service_id=service.id if service else None,
        dimensions=dimensions,
        reasons=tuple(reasons),
        missing_evidence=tuple(sorted(set(missing))),
        risks=tuple(sorted(set(risks))),
        proof_ids=proof_ids,
        recommended_action=action,
        configuration_version=config.version,
    )


def _best_service(
    evidence: Any,
    services: tuple[ServiceRule, ...],
) -> tuple[ServiceRule | None, int, tuple[str, ...]]:
    title = _normalize(evidence.title)
    body = _normalize(evidence.body)
    skills = _normalize(" ".join(map(str, evidence.attributes.get("skills", []))))
    results: list[tuple[int, int, ServiceRule, tuple[str, ...]]] = []
    for position, rule in enumerate(services):
        matched: list[str] = []
        weighted = 0
        for keyword in rule.keywords:
            title_hit = _contains_keyword(title, keyword)
            skills_hit = _contains_keyword(skills, keyword)
            body_hit = _contains_keyword(body, keyword)
            if title_hit or skills_hit or body_hit:
                matched.append(keyword)
                weighted += 4 if title_hit else 0
                weighted += 2 if skills_hit else 0
                weighted += 1 if body_hit else 0
        if evidence.segment == rule.id:
            weighted += 1
        results.append((weighted, -position, rule, tuple(matched)))
    results.sort(key=lambda item: (item[0], item[1]), reverse=True)
    weighted, _position, rule, matched = results[0]
    return (rule, weighted, matched) if matched else (None, 0, ())


def _commercial_potential(
    *,
    text: str,
    service: ServiceRule | None,
    budget: float | None,
    reasons: list[str],
    risks: list[str],
    missing: list[str],
) -> int:
    score = 0
    if service and budget is not None:
        if budget >= service.minimum_budget_usd * 2:
            score += 20
            reasons.append("Visible or estimated contract value is comfortably above the configured minimum.")
        elif budget >= service.minimum_budget_usd:
            score += 15
            reasons.append("Visible or estimated contract value meets the configured minimum.")
        elif budget >= service.minimum_budget_usd * 0.6:
            score += 8
            risks.append("budget_borderline")
        else:
            score += 2
            risks.append("budget_below_minimum")
    elif budget is not None:
        score += 8
    else:
        score += 8
        missing.append("budget or commercial range")

    enterprise_terms = (
        "enterprise", "saas", "platform", "product", "architecture",
        "system design", "business systems", "multi-tenant",
    )
    recurring_terms = (
        "long-term", "long term", "ongoing", "partner", "continuously",
        "future phases", "phase 2", "retainer", "maintenance",
    )
    scope_terms = (
        "custom development", "build", "develop", "implementation", "integration",
        "desktop application", "web application", "mobile app", "browser extension",
    )
    enterprise_hits = sum(1 for term in enterprise_terms if term in text)
    recurring_hits = sum(1 for term in recurring_terms if term in text)
    scope_hits = sum(1 for term in scope_terms if term in text)
    score += min(8, enterprise_hits * 2)
    score += min(7, recurring_hits * 3)
    score += min(7, scope_hits * 2)
    if enterprise_hits:
        reasons.append("Enterprise/product scope suggests meaningful contract potential.")
    if recurring_hits:
        reasons.append("Long-term or recurring-work language is visible.")
    return min(30, score)


def _technical_fit(
    *,
    text: str,
    service: ServiceRule | None,
    match_score: int,
    reasons: list[str],
) -> int:
    if service is None:
        return 0
    score = 8 + min(14, match_score * 2)
    complexity_terms = (
        "architecture", "real-time", "event-driven", "latency", "custom",
        "integration", "workflow", "rag", "llm", "voice", "automation",
        "enterprise", "mvp", "backend", "api",
    )
    complexity_hits = sum(1 for term in complexity_terms if term in text)
    score += min(8, complexity_hits * 2)
    if complexity_hits >= 2:
        reasons.append("The work requires custom technical delivery rather than a commodity task.")
    return min(30, score)


def _buyer_quality(
    *,
    body: str,
    payment_verified: bool,
    payment_status: str,
    buyer_spend: float | None,
    hire_rate: float | None,
    client_rating: float | None,
    risks: list[str],
    missing: list[str],
) -> int:
    score = 0
    if payment_verified:
        score += 5
    elif payment_status == "unverified":
        risks.append("payment_unverified")

    if buyer_spend is not None:
        score += 5 if buyer_spend >= 10_000 else 3 if buyer_spend >= 1_000 else 1
    if hire_rate is not None:
        score += 4 if hire_rate >= 50 else 2
    if client_rating is not None:
        score += 2 if client_rating >= 4.5 else 1
    clean_length = len(body.strip())
    if clean_length >= 220:
        score += 4
    elif clean_length >= 100:
        score += 3
    elif clean_length >= 60:
        score += 1

    if buyer_spend is None and hire_rate is None and not payment_verified:
        missing.append("buyer credibility evidence")
    return min(20, score)


def _competition_timing(
    *,
    competition_level: str,
    proposal_activity: str,
    posted_age: str,
    reasons: list[str],
    risks: list[str],
) -> int:
    competition_points = {
        "low": 12,
        "medium": 9,
        "high": 5,
        "very_high": 2,
    }.get(competition_level, 8)
    if competition_level == "very_high" or re.search(r"\b50\+\b", proposal_activity):
        risks.append("very_high_competition")
        reasons.append("The visible card shows very high proposal activity.")
    elif competition_level == "high":
        risks.append("high_competition")

    age = posted_age.casefold()
    if re.search(r"\b(?:minute|minutes|hour|hours)\b", age):
        timing_points = 8
        reasons.append("The job was posted recently.")
    elif age in {"yesterday", "1 day ago"} or "1 day" in age:
        timing_points = 6
    else:
        day_match = re.search(r"(\d+)\s+days?", age)
        if day_match and int(day_match.group(1)) <= 3:
            timing_points = 4
        elif day_match and int(day_match.group(1)) <= 7:
            timing_points = 2
        else:
            timing_points = 4
    return min(20, competition_points + timing_points)


def _approved_proofs(service: ServiceRule, config: QualificationConfig) -> tuple[str, ...]:
    approved = {proof.id for proof in config.proofs if proof.approved and service.id in proof.service_ids}
    return tuple(proof_id for proof_id in service.proof_ids if proof_id in approved)


def _contains_keyword(text: str, keyword: str) -> bool:
    value = _normalize(keyword)
    if not value:
        return False
    if re.fullmatch(r"[a-z0-9 ]+", value):
        return re.search(rf"\b{re.escape(value)}\b", text) is not None
    return value in text


def _first_number(*values: object) -> float | None:
    for value in values:
        number = _number(value)
        if number is not None:
            return number
    return None


def _number(value: object) -> float | None:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _bool(value: object) -> bool:
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in {"1", "true", "yes", "verified"}


def _normalize(value: str) -> str:
    return " ".join(str(value).lower().split())


def _text(value: dict[str, object], key: str) -> str:
    text = str(value.get(key, "")).strip()
    if not text:
        raise ValueError(f"{key} is required")
    return text


def _list(value: object) -> list[str]:
    if not isinstance(value, list):
        raise ValueError("Expected a list")
    return [str(item).strip() for item in value if str(item).strip()]
