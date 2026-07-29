from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from .review import _load_jsonl
from .storage import atomic_write_text

MIN_TOTAL = 25
MIN_REVIEWABLE = 15
MIN_PROFILE_RATIO = 0.95
MIN_ROLE_RATIO = 0.80
MIN_COMPANY_RATIO = 0.80
MIN_CAMPAIGN_RATIO = 0.95


def _mapping(record: dict[str, Any], key: str) -> dict[str, Any]:
    value = record.get(key)
    return value if isinstance(value, dict) else {}


def _qualification(record: dict[str, Any]) -> dict[str, Any]:
    return _mapping(record, "qualification")


def _ratio(numerator: int, denominator: int) -> float:
    return round(numerator / denominator, 4) if denominator else 0.0


def build_report(state_root: Path) -> dict[str, Any]:
    records = _load_jsonl(state_root / "sales_navigator" / "records.jsonl")
    total = len(records)
    dispositions = {"priority_a": 0, "priority_b": 0, "research": 0, "reject": 0}
    canonical = 0
    roles = 0
    companies = 0
    campaigns = 0
    external_actions = 0
    cold_warnings = 0
    identities: list[str] = []

    for record in records:
        qualification = _qualification(record)
        disposition = str(qualification.get("disposition") or "research")
        if disposition in dispositions:
            dispositions[disposition] += 1
        if str(record.get("canonical_url") or "").startswith("https://www.linkedin.com/"):
            canonical += 1
        if str(record.get("author_headline") or "").strip():
            roles += 1
        if str(record.get("company_name") or "").strip():
            companies += 1
        commercial = _mapping(record, "commercial_evidence")
        if commercial.get("campaign_id") and commercial.get("campaign_name") and commercial.get("offer_name"):
            campaigns += 1
        if record.get("external_action_performed") is True or _mapping(record, "raw_evidence").get("external_action_performed") is True:
            external_actions += 1
        risks = qualification.get("risk_reasons") if isinstance(qualification.get("risk_reasons"), list) else []
        if any("no explicit buying intent" in str(risk).lower() for risk in risks):
            cold_warnings += 1
        identity = str(record.get("source_native_id") or record.get("canonical_url") or "").strip()
        if identity:
            identities.append(identity)

    unique_identities = len(set(identities))
    reviewable = dispositions["priority_a"] + dispositions["priority_b"]
    metrics = {
        "total_records": total,
        "reviewable_priority_a_b": reviewable,
        "unique_identities": unique_identities,
        "unique_identity_ratio": _ratio(unique_identities, total),
        "canonical_profile_ratio": _ratio(canonical, total),
        "role_evidence_ratio": _ratio(roles, total),
        "company_evidence_ratio": _ratio(companies, total),
        "campaign_metadata_ratio": _ratio(campaigns, total),
        "cold_warning_ratio": _ratio(cold_warnings, total),
        "external_action_records": external_actions,
        "priority_counts": dispositions,
    }
    gates = {
        "at_least_25_unique_prospects": total >= MIN_TOTAL and unique_identities >= MIN_TOTAL,
        "at_least_15_priority_a_b": reviewable >= MIN_REVIEWABLE,
        "canonical_profile_evidence": metrics["canonical_profile_ratio"] >= MIN_PROFILE_RATIO,
        "role_evidence": metrics["role_evidence_ratio"] >= MIN_ROLE_RATIO,
        "company_evidence": metrics["company_evidence_ratio"] >= MIN_COMPANY_RATIO,
        "campaign_metadata": metrics["campaign_metadata_ratio"] >= MIN_CAMPAIGN_RATIO,
        "cold_classification_warning": metrics["cold_warning_ratio"] >= MIN_PROFILE_RATIO,
        "no_external_actions": external_actions == 0,
    }
    return {
        "schema_version": "codistan-sales-navigator-acceptance.v1",
        "status": "ready_for_human_commercial_review" if all(gates.values()) else "pilot_incomplete",
        "metrics": metrics,
        "gates": gates,
        "human_review_remaining": [
            "Review at least 15 Priority A/B prospects for genuine commercial relevance.",
            "Confirm the proposed product or managed-delivery angle is credible for each reviewed account.",
            "Record keep/change/stop decisions for the campaign, personas, geographies and search filters.",
        ],
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Evaluate the local Sales Navigator pilot against the V5 acceptance gate.")
    parser.add_argument("--state-root", type=Path, required=True)
    parser.add_argument("--json", action="store_true", dest="as_json")
    args = parser.parse_args(argv)
    report = build_report(args.state_root)
    output_path = args.state_root / "review" / "sales-navigator-acceptance.json"
    atomic_write_text(output_path, json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n")
    if args.as_json:
        print(json.dumps(report, indent=2, sort_keys=True))
    else:
        print(f"SALES NAVIGATOR PILOT: {report['status'].upper()}")
        for name, passed in report["gates"].items():
            print(f"{'PASS' if passed else 'WAIT':4}  {name}")
        metrics = report["metrics"]
        print(f"Records: {metrics['total_records']} | Priority A/B: {metrics['reviewable_priority_a_b']} | Unique: {metrics['unique_identities']}")
        print(f"Report: {output_path}")
        if report["status"] != "ready_for_human_commercial_review":
            print("The technical pilot is not complete yet; do not approve the campaign for routine outreach.")
        else:
            print("Technical evidence is sufficient. Human commercial review is still mandatory before routine use.")
    return 0 if report["status"] == "ready_for_human_commercial_review" else 2


if __name__ == "__main__":
    raise SystemExit(main())
