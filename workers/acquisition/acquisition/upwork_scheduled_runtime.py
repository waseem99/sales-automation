from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .models import OpportunityRecord, SourceEvidence
from .qualification import QualificationDecision
from .upwork_market import annotate_profile_and_market, apply_market_policy
from .upwork_pilot import HumanActionRequired, PilotItem, PilotSummary, extract_job_evidence, utc_now_iso
from . import upwork_scheduled as _base


_original_card_evidence = _base._card_evidence
_original_qualify = _base.qualify
_original_write_pilot_outputs = _base.write_pilot_outputs


def _has_value(value: object) -> bool:
    if value is None or value == "":
        return False
    if isinstance(value, (list, tuple, set, dict)) and not value:
        return False
    return True


def _policy_card_evidence(raw: dict[str, Any], *, segment: str) -> SourceEvidence:
    evidence = _original_card_evidence(raw, segment=segment)
    annotated = annotate_profile_and_market(evidence, segment)
    annotated.validate()
    return annotated


def _policy_qualify(record: OpportunityRecord, config: Any) -> QualificationDecision:
    decision = _original_qualify(record, config)
    return apply_market_policy(record, decision)


def _policy_write_pilot_outputs(
    *,
    output_directory: Path,
    summary: PilotSummary,
    items: list[PilotItem],
    config_version: str,
) -> None:
    _original_write_pilot_outputs(
        output_directory=output_directory,
        summary=summary,
        items=items,
        config_version=config_version,
    )
    ready_path = output_directory / "dashboard-ready.jsonl"
    with ready_path.open("w", encoding="utf-8") as handle:
        for item in items:
            if item.qualification.priority not in {"A", "B"}:
                continue
            handle.write(json.dumps(item.to_dict(), ensure_ascii=False, sort_keys=True))
            handle.write("\n")


def _safe_enrich_from_detail(
    *,
    context: Any,
    source_url: str,
    segment: str,
    original: SourceEvidence,
    settings: _base.AutomationSettings,
    attention_path: Any,
    status_path: Any,
    result: _base.ScheduledRunResult,
) -> SourceEvidence | None:
    detail_page = context.new_page()
    try:
        _base._navigate(detail_page, source_url, wait_seconds=settings.detail_wait_seconds)
        _base._wait_for_access(
            detail_page,
            settings=settings,
            attention_path=attention_path,
            status_path=status_path,
            result=result,
        )
        detail = extract_job_evidence(detail_page, segment)
        attributes = dict(original.attributes)
        for key, value in detail.attributes.items():
            if _has_value(value):
                attributes[key] = value

        skills: list[str] = []
        seen: set[str] = set()
        original_skills = original.attributes.get("skills", [])
        detail_skills = detail.attributes.get("skills", [])
        for value in list(original_skills or []) + list(detail_skills or []):
            text = str(value).strip()
            key = text.casefold()
            if text and key not in seen:
                seen.add(key)
                skills.append(text)
        attributes["skills"] = skills[:25]
        attributes["captured_from"] = "scheduled_search_card_and_job_detail"
        attributes["capture_quality"] = "high"
        attributes["detail_enriched"] = True

        evidence = SourceEvidence(
            source="upwork",
            source_id=original.source_id,
            source_url=original.source_url,
            captured_at=utc_now_iso(),
            title=detail.title if detail.title and "Untitled" not in detail.title else original.title,
            body=detail.body if len(detail.body.strip()) >= len(original.body.strip()) else original.body,
            segment=segment,
            attributes=attributes,
        )
        evidence = annotate_profile_and_market(evidence, segment)
        evidence.validate()
        return evidence
    except HumanActionRequired:
        raise
    except Exception:
        return None
    finally:
        try:
            detail_page.close()
        except Exception:
            pass


# Keep the main implementation in one module while replacing only local
# evidence enrichment, profile annotation, qualification-policy and A/B output
# hooks. Browser navigation and the no-external-action boundary are unchanged.
_base._card_evidence = _policy_card_evidence
_base._enrich_from_detail = _safe_enrich_from_detail
_base.qualify = _policy_qualify
_base.write_pilot_outputs = _policy_write_pilot_outputs

AutomationSettings = _base.AutomationSettings
ScheduledRunResult = _base.ScheduledRunResult
load_automation_settings = _base.load_automation_settings
run_upwork_scheduled = _base.run_upwork_scheduled
local_run_id = _base.local_run_id
