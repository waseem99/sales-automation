from __future__ import annotations

from typing import Any

from .models import SourceEvidence
from .upwork_pilot import HumanActionRequired, extract_job_evidence, utc_now_iso
from . import upwork_scheduled as _base


def _has_value(value: object) -> bool:
    if value is None or value == "":
        return False
    if isinstance(value, (list, tuple, set, dict)) and not value:
        return False
    return True


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


# Keep the main implementation in one module while replacing the enrichment
# helper before the scheduled runner executes. This avoids any browser-side
# behavioral change and only fixes local evidence merging.
_base._enrich_from_detail = _safe_enrich_from_detail

AutomationSettings = _base.AutomationSettings
ScheduledRunResult = _base.ScheduledRunResult
load_automation_settings = _base.load_automation_settings
run_upwork_scheduled = _base.run_upwork_scheduled
local_run_id = _base.local_run_id
