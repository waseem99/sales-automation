from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
from typing import Any

from .review import _load_jsonl
from .storage import atomic_write_text, load_json

SOURCE_SPECS: dict[str, dict[str, Any]] = {
    "upwork": {
        "minimum_records": 100,
        "minimum_priority_a_b": 15,
        "canonical_ratio": 0.95,
        "evidence_ratio": 0.70,
    },
    "linkedin": {
        "minimum_records": 50,
        "minimum_priority_a_b": 10,
        "canonical_ratio": 0.95,
        "profile_ratio": 0.70,
    },
    "sales_navigator": {
        "minimum_records": 75,
        "minimum_priority_a_b": 15,
        "canonical_ratio": 0.95,
        "role_ratio": 0.80,
        "company_ratio": 0.80,
        "campaign_ratio": 0.95,
        "cold_warning_ratio": 0.95,
    },
}
MIN_HUMAN_REVIEWS = 15
MIN_REVIEWS_PER_SOURCE = 3
MIN_ACCEPTANCE_RATIO = 0.60
REVIEW_SCHEMA = "codistan-prospecting-os-commercial-review.v1"


def _mapping(record: dict[str, Any], key: str) -> dict[str, Any]:
    value = record.get(key)
    return value if isinstance(value, dict) else {}


def _qualification(record: dict[str, Any]) -> dict[str, Any]:
    return _mapping(record, "qualification")


def _ratio(numerator: int, denominator: int) -> float:
    return round(numerator / denominator, 4) if denominator else 0.0


def _has_text(value: Any) -> bool:
    return bool(str(value or "").strip())


def _canonical_ok(source: str, value: Any) -> bool:
    url = str(value or "").strip().lower()
    if source == "upwork":
        return url.startswith("https://www.upwork.com/") or url.startswith("https://upwork.com/")
    if source == "linkedin":
        return (
            url.startswith("https://www.linkedin.com/posts/")
            or url.startswith("https://www.linkedin.com/feed/update/")
            or url.startswith("https://www.linkedin.com/pulse/")
        )
    return url.startswith("https://www.linkedin.com/") or url.startswith("https://linkedin.com/")


def _record_identity(record: dict[str, Any]) -> str:
    return str(record.get("dedupe_key") or record.get("source_native_id") or record.get("canonical_url") or "").strip()


def _external_action(record: dict[str, Any]) -> bool:
    return record.get("external_action_performed") is True or _mapping(record, "raw_evidence").get("external_action_performed") is True


def _source_report(source: str, records: list[dict[str, Any]]) -> dict[str, Any]:
    spec = SOURCE_SPECS[source]
    total = len(records)
    identities = {_record_identity(record) for record in records if _record_identity(record)}
    priority_counts = {"priority_a": 0, "priority_b": 0, "research": 0, "reject": 0}
    canonical = 0
    title_body = 0
    external_actions = 0
    evidence = 0
    profiles = 0
    roles = 0
    companies = 0
    campaigns = 0
    cold_warnings = 0

    for record in records:
        qualification = _qualification(record)
        disposition = str(qualification.get("disposition") or "research")
        if disposition in priority_counts:
            priority_counts[disposition] += 1
        canonical += int(_canonical_ok(source, record.get("canonical_url")))
        title_body += int(_has_text(record.get("title")) and len(str(record.get("body") or "").strip()) >= 20)
        external_actions += int(_external_action(record))
        commercial = _mapping(record, "commercial_evidence")
        evidence += int(bool(commercial))
        profiles += int(_has_text(record.get("author_profile_url")))
        roles += int(_has_text(record.get("author_headline")))
        companies += int(_has_text(record.get("company_name")))
        campaigns += int(bool(commercial.get("campaign_id") and commercial.get("campaign_name") and commercial.get("offer_name")))
        risks = qualification.get("risk_reasons") if isinstance(qualification.get("risk_reasons"), list) else []
        cold_warnings += int(any("no explicit buying intent" in str(risk).lower() for risk in risks))

    reviewable = priority_counts["priority_a"] + priority_counts["priority_b"]
    metrics: dict[str, Any] = {
        "total_records": total,
        "unique_identities": len(identities),
        "unique_identity_ratio": _ratio(len(identities), total),
        "reviewable_priority_a_b": reviewable,
        "canonical_ratio": _ratio(canonical, total),
        "title_body_ratio": _ratio(title_body, total),
        "external_action_records": external_actions,
        "priority_counts": priority_counts,
    }
    gates: dict[str, bool] = {
        "minimum_records": total >= int(spec["minimum_records"]),
        "minimum_priority_a_b": reviewable >= int(spec["minimum_priority_a_b"]),
        "unique_identity_coverage": metrics["unique_identity_ratio"] >= 0.95,
        "canonical_evidence": metrics["canonical_ratio"] >= float(spec["canonical_ratio"]),
        "title_and_body_evidence": metrics["title_body_ratio"] >= 0.95,
        "no_external_actions": external_actions == 0,
    }

    if source == "upwork":
        metrics["buyer_or_job_evidence_ratio"] = _ratio(evidence, total)
        gates["buyer_or_job_evidence"] = metrics["buyer_or_job_evidence_ratio"] >= float(spec["evidence_ratio"])
    elif source == "linkedin":
        metrics["author_profile_ratio"] = _ratio(profiles, total)
        gates["author_profile_evidence"] = metrics["author_profile_ratio"] >= float(spec["profile_ratio"])
    else:
        metrics.update({
            "role_evidence_ratio": _ratio(roles, total),
            "company_evidence_ratio": _ratio(companies, total),
            "campaign_metadata_ratio": _ratio(campaigns, total),
            "cold_warning_ratio": _ratio(cold_warnings, total),
        })
        gates.update({
            "role_evidence": metrics["role_evidence_ratio"] >= float(spec["role_ratio"]),
            "company_evidence": metrics["company_evidence_ratio"] >= float(spec["company_ratio"]),
            "campaign_metadata": metrics["campaign_metadata_ratio"] >= float(spec["campaign_ratio"]),
            "cold_classification_warning": metrics["cold_warning_ratio"] >= float(spec["cold_warning_ratio"]),
        })

    return {
        "source": source,
        "status": "technical_gate_passed" if all(gates.values()) else "pilot_incomplete",
        "metrics": metrics,
        "gates": gates,
    }


def _human_review_report(state_root: Path, records_by_source: dict[str, list[dict[str, Any]]]) -> dict[str, Any]:
    review_path = state_root / "review" / "commercial-review.json"
    raw = load_json(review_path, {})
    payload = raw if isinstance(raw, dict) else {}
    schema_ok = payload.get("schema_version") == REVIEW_SCHEMA
    reviews = payload.get("reviews") if isinstance(payload.get("reviews"), list) else []

    eligible: dict[str, str] = {}
    for source, records in records_by_source.items():
        for record in records:
            disposition = str(_qualification(record).get("disposition") or "research")
            identity = _record_identity(record)
            if identity and disposition in {"priority_a", "priority_b"}:
                eligible[identity] = source

    valid: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in reviews:
        if not isinstance(item, dict):
            continue
        identity = str(item.get("dedupe_key") or "").strip()
        if identity not in eligible or identity in seen:
            continue
        if not isinstance(item.get("accepted_for_pursuit"), bool):
            continue
        if not _has_text(item.get("reviewer")) or not _has_text(item.get("reviewed_at")):
            continue
        seen.add(identity)
        valid.append(item)

    accepted = sum(1 for item in valid if item.get("accepted_for_pursuit") is True)
    by_source = {source: 0 for source in SOURCE_SPECS}
    accepted_by_source = {source: 0 for source in SOURCE_SPECS}
    for item in valid:
        source = eligible[str(item.get("dedupe_key"))]
        by_source[source] += 1
        accepted_by_source[source] += int(item.get("accepted_for_pursuit") is True)

    acceptance_ratio = _ratio(accepted, len(valid))
    gates = {
        "review_schema_valid": schema_ok,
        "minimum_priority_a_b_reviews": len(valid) >= MIN_HUMAN_REVIEWS,
        "source_coverage": all(by_source[source] >= MIN_REVIEWS_PER_SOURCE for source in SOURCE_SPECS),
        "commercial_acceptance_at_least_60_percent": acceptance_ratio >= MIN_ACCEPTANCE_RATIO,
    }
    return {
        "review_path": str(review_path),
        "valid_reviews": len(valid),
        "accepted_for_pursuit": accepted,
        "acceptance_ratio": acceptance_ratio,
        "reviews_by_source": by_source,
        "accepted_by_source": accepted_by_source,
        "gates": gates,
        "status": "commercial_gate_passed" if all(gates.values()) else "human_review_incomplete",
    }


def build_report(state_root: Path) -> dict[str, Any]:
    records_by_source = {
        source: _load_jsonl(state_root / source / "records.jsonl")
        for source in SOURCE_SPECS
    }
    sources = {source: _source_report(source, records) for source, records in records_by_source.items()}
    technical_passed = all(item["status"] == "technical_gate_passed" for item in sources.values())
    external_actions = sum(item["metrics"]["external_action_records"] for item in sources.values())
    human = _human_review_report(state_root, records_by_source)

    if external_actions:
        status = "blocked_external_action_evidence"
    elif not technical_passed:
        status = "pilot_incomplete"
    elif human["status"] != "commercial_gate_passed":
        status = "ready_for_human_commercial_review"
    else:
        status = "commercial_gate_passed"

    return {
        "schema_version": "codistan-prospecting-os-acceptance.v1",
        "status": status,
        "sources": sources,
        "human_commercial_review": human,
        "release_decision": {
            "merge_allowed": status == "commercial_gate_passed",
            "routine_outreach_allowed": status == "commercial_gate_passed",
            "automatic_external_actions_allowed": False,
        },
        "next_actions": _next_actions(status, sources, human),
    }


def _next_actions(status: str, sources: dict[str, Any], human: dict[str, Any]) -> list[str]:
    if status == "blocked_external_action_evidence":
        return ["Stop the pilot and investigate records showing an external action before continuing."]
    actions: list[str] = []
    for source, report in sources.items():
        if report["status"] != "technical_gate_passed":
            failed = [name for name, passed in report["gates"].items() if not passed]
            actions.append(f"Complete the {source} technical pilot: {', '.join(failed)}.")
    if not actions and human["status"] != "commercial_gate_passed":
        actions.append("Complete the documented Priority A/B human review across all three sources.")
        actions.append("Reach at least 60% accepted-for-pursuit while recording reviewer and review time.")
    if status == "commercial_gate_passed":
        actions.append("Record keep/change/stop decisions for each source and campaign before the release merge.")
    return actions


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Evaluate the complete Prospecting OS live pilot and human commercial gate.")
    default_root = Path(os.environ.get("LOCALAPPDATA", ".")) / "Codistan" / "Acquisition"
    parser.add_argument("--state-root", type=Path, default=default_root)
    parser.add_argument("--json", action="store_true", dest="as_json")
    args = parser.parse_args(argv)
    report = build_report(args.state_root)
    output_path = args.state_root / "review" / "prospecting-os-pilot-acceptance.json"
    atomic_write_text(output_path, json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n")

    if args.as_json:
        print(json.dumps(report, indent=2, sort_keys=True))
    else:
        print(f"PROSPECTING OS PILOT: {report['status'].upper()}")
        for source, source_report in report["sources"].items():
            metrics = source_report["metrics"]
            print(
                f"{source:15} {source_report['status']:24} "
                f"records={metrics['total_records']} priority_a_b={metrics['reviewable_priority_a_b']}"
            )
        human = report["human_commercial_review"]
        print(
            f"Human review: {human['valid_reviews']} reviewed | "
            f"{human['accepted_for_pursuit']} accepted | {human['acceptance_ratio']:.0%}"
        )
        for action in report["next_actions"]:
            print(f"NEXT  {action}")
        print(f"Report: {output_path}")

    if report["status"] == "blocked_external_action_evidence":
        return 1
    return 0 if report["status"] == "commercial_gate_passed" else 2


if __name__ == "__main__":
    raise SystemExit(main())
