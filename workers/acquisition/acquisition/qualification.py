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
    prohibited_terms: tuple[str, ...]
    services: tuple[ServiceRule, ...]
    proofs: tuple[ProofConfig, ...]


@dataclass(frozen=True, slots=True)
class QualificationDecision:
    disposition: str
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
        proposal_ready_score=int(settings.get("proposal_ready_score", 80)),
        contact_ready_score=int(settings.get("contact_ready_score", 68)),
        qualified_score=int(settings.get("qualified_score", 55)),
        prohibited_terms=tuple(_list(settings.get("prohibited_terms", []))),
        services=services,
        proofs=proofs,
    )


def qualify(record: OpportunityRecord, config: QualificationConfig) -> QualificationDecision:
    evidence = record.evidence
    attributes_text = " ".join(map(str, evidence.attributes.values()))
    text = _normalize(f"{evidence.title} {evidence.body} {attributes_text}")
    risks: list[str] = []
    missing: list[str] = []
    reasons: list[str] = []

    prohibited = [term for term in config.prohibited_terms if _normalize(term) in text]
    if prohibited:
        return QualificationDecision(
            disposition="reject",
            score=0,
            confidence="high",
            business_unit=None,
            service_id=None,
            dimensions={"intent": 0, "service_fit": 0, "commercial": 0, "buyer_quality": 0, "evidence": 0},
            reasons=("Prohibited or unsuitable work signal detected.",),
            missing_evidence=(),
            risks=tuple(f"prohibited:{term}" for term in prohibited),
            proof_ids=(),
            recommended_action="Reject and retain the structured reason only.",
            configuration_version=config.version,
        )

    matches = [(rule, _keyword_score(text, rule.keywords)) for rule in config.services]
    matches.sort(key=lambda item: item[1], reverse=True)
    service, keyword_hits = matches[0]
    if keyword_hits == 0:
        service = None
        missing.append("verified service fit")

    budget = _number(evidence.attributes.get("budget_usd"))
    if budget is None:
        missing.append("budget or commercial range")
    buyer_spend = _number(evidence.attributes.get("client_spend_usd"))
    hire_rate = _number(evidence.attributes.get("client_hire_rate"))
    payment_verified = _bool(evidence.attributes.get("payment_verified"))
    payment_status = str(evidence.attributes.get("payment_status", "not_visible")).strip().lower()
    urgency_days = _number(evidence.attributes.get("urgency_days"))
    proposal_activity = str(evidence.attributes.get("proposal_activity", "")).strip()
    competition_level = str(evidence.attributes.get("competition_level", "")).strip().lower()
    capture_quality = str(evidence.attributes.get("capture_quality", "high")).strip().lower()

    concrete_source = bool(
        evidence.source_url
        and evidence.body
        and evidence.title
        and (evidence.source != "upwork" or re.search(r"~[A-Za-z0-9_-]{8,}", evidence.source_url))
    )

    intent_score = 20 if evidence.source in {"upwork", "public_procurement", "fixture"} else 12
    service_score = min(25, keyword_hits * 8) if service else 0
    if service and keyword_hits:
        reasons.append(f"Matched {service.business_unit} service rule with {keyword_hits} relevant signal(s).")

    commercial_score = 0
    if service and budget is not None:
        if budget >= service.minimum_budget_usd * 2:
            commercial_score = 20
            reasons.append("Budget is comfortably above the configured minimum.")
        elif budget >= service.minimum_budget_usd:
            commercial_score = 14
            reasons.append("Budget meets the configured minimum.")
        else:
            commercial_score = 3
            risks.append("budget_below_minimum")
    elif budget is not None:
        commercial_score = 6

    buyer_score = 0
    if payment_verified:
        buyer_score += 5
    if buyer_spend is not None:
        buyer_score += 6 if buyer_spend >= 10_000 else 3
    if hire_rate is not None:
        buyer_score += 4 if hire_rate >= 50 else 2
    buyer_score = min(15, buyer_score)
    if buyer_score == 0:
        missing.append("buyer credibility evidence")
    if payment_status == "unverified":
        risks.append("payment_unverified")

    evidence_score = 10 if concrete_source else 0
    if len(evidence.body.strip()) >= 120:
        evidence_score += 4
    if capture_quality == "high":
        evidence_score += 4
    elif capture_quality == "low":
        missing.append("complete clean job description")
        risks.append("low_capture_quality")
    if urgency_days is not None and urgency_days <= 30:
        evidence_score += 6
        reasons.append("The opportunity has a near-term delivery signal.")
    evidence_score = min(20, evidence_score)

    if competition_level == "very_high" or re.search(r"\b50\+\b", proposal_activity):
        risks.append("very_high_competition")
        reasons.append("The visible Upwork card shows very high proposal activity.")
    elif competition_level == "high":
        risks.append("high_competition")
        reasons.append("The visible Upwork card shows high proposal activity.")

    local_required = _bool(evidence.attributes.get("local_presence_required"))
    delivery_country = str(evidence.attributes.get("delivery_country", "")).strip().lower()
    if local_required and delivery_country not in {"", "pakistan"}:
        risks.append("unsupported_local_presence")
    if service and not service.remote_delivery and delivery_country not in {"", "pakistan"}:
        risks.append("service_not_remote_suitable")

    dimensions = {
        "intent": intent_score,
        "service_fit": service_score,
        "commercial": commercial_score,
        "buyer_quality": buyer_score,
        "evidence": evidence_score,
    }
    risk_penalties = {
        "budget_below_minimum": 18,
        "payment_unverified": 8,
        "low_capture_quality": 20,
        "unsupported_local_presence": 30,
        "service_not_remote_suitable": 30,
        "very_high_competition": 10,
        "high_competition": 5,
    }
    penalty = sum(risk_penalties.get(risk, 15) for risk in set(risks))
    score = max(0, min(100, sum(dimensions.values()) - penalty))

    proof_ids = _approved_proofs(service, config) if service else ()
    if service and not proof_ids:
        missing.append("approved portfolio proof")

    blocking_risks = {
        "budget_below_minimum",
        "payment_unverified",
        "low_capture_quality",
        "unsupported_local_presence",
        "service_not_remote_suitable",
    }.intersection(risks)

    confidence = "high" if evidence_score >= 16 and not missing else "medium" if evidence_score >= 10 else "low"
    if blocking_risks:
        disposition = "research" if score >= config.qualified_score else "reject"
    elif missing:
        disposition = "research"
    elif score >= config.proposal_ready_score and proof_ids:
        disposition = "proposal_ready"
    elif score >= config.contact_ready_score:
        disposition = "contact_ready"
    elif score >= config.qualified_score:
        disposition = "qualified"
    else:
        disposition = "reject"

    action = {
        "proposal_ready": "Prepare a source-specific proposal draft for human review.",
        "contact_ready": "Confirm the buyer route and prepare a concise outreach draft for human review.",
        "qualified": "Assign an owner and verify the remaining commercial details.",
        "research": "Resolve the listed missing evidence or risks before contact.",
        "reject": "Reject and retain the structured reason for calibration.",
    }[disposition]
    return QualificationDecision(
        disposition=disposition,
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


def _approved_proofs(service: ServiceRule, config: QualificationConfig) -> tuple[str, ...]:
    approved = {proof.id for proof in config.proofs if proof.approved and service.id in proof.service_ids}
    return tuple(proof_id for proof_id in service.proof_ids if proof_id in approved)


def _keyword_score(text: str, keywords: tuple[str, ...]) -> int:
    return sum(1 for keyword in keywords if re.search(rf"\b{re.escape(_normalize(keyword))}\b", text))


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
    return " ".join(value.lower().split())


def _text(value: dict[str, object], key: str) -> str:
    text = str(value.get(key, "")).strip()
    if not text:
        raise ValueError(f"{key} is required")
    return text


def _list(value: object) -> list[str]:
    if not isinstance(value, list):
        raise ValueError("Expected a list")
    return [str(item).strip() for item in value if str(item).strip()]
