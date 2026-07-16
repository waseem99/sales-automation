from __future__ import annotations

import json
from pathlib import Path
import re
from typing import Any
from urllib.parse import unquote, urlparse

from .models import OpportunityRecord, SourceEvidence
from .qualification import QualificationDecision
from .upwork_market import annotate_profile_and_market, apply_market_policy
from .upwork_pilot import HumanActionRequired, PilotItem, PilotSummary, extract_job_evidence, utc_now_iso
from . import upwork_scheduled as _base


_original_card_evidence = _base._card_evidence
_original_qualify = _base.qualify
_original_write_pilot_outputs = _base.write_pilot_outputs
_original_navigate = _base._navigate
_original_run_upwork_scheduled = _base.run_upwork_scheduled


_MORE_ABOUT_TITLE = re.compile(r'more\s+about\s+["“]([^"”]{4,500})["”]\s*$', re.I)
_UNTRUSTED_DETAIL_KEYS = {
    "client_country",
    "delivery_country",
    "market_scopes",
    "market_policy_status",
    "market_policy_reason",
    "commercial_filter_status",
    "commercial_filter_reason",
    "profile_name",
    "profile_url",
    "search_name",
    "service_lane",
}


def _has_value(value: object) -> bool:
    if value is None or value == "":
        return False
    if isinstance(value, (list, tuple, set, dict)) and not value:
        return False
    return True


def _trusted_detail_value(key: str, value: object) -> bool:
    if key in _UNTRUSTED_DETAIL_KEYS:
        return False
    if not _has_value(value):
        return False
    if key == "payment_status" and str(value).strip().casefold() in {"not_visible", "unknown"}:
        return False
    return True


def _recover_title(original_title: str, body: str, source_url: str) -> str:
    for candidate in (body, original_title):
        match = _MORE_ABOUT_TITLE.search(str(candidate or "").strip())
        if match:
            return " ".join(match.group(1).split())[:500]

    parsed = urlparse(source_url)
    match = re.search(r"/(?:jobs|freelance-jobs/apply)/(.+?)_~", parsed.path, re.I)
    if match:
        slug = unquote(match.group(1)).replace("-", " ").replace("_", " ")
        recovered = " ".join(slug.split())
        if recovered:
            return recovered[:500]

    value = " ".join(str(original_title or "").split())
    return value[:500] or "Untitled Upwork opportunity"


def _strip_more_about(body: str) -> str:
    value = str(body or "").strip()
    match = _MORE_ABOUT_TITLE.search(value)
    if match:
        value = value[: match.start()].rstrip(" .")
    return value


def _policy_card_evidence(raw: dict[str, Any], *, segment: str) -> SourceEvidence:
    evidence = _original_card_evidence(raw, segment=segment)
    evidence = SourceEvidence(
        source=evidence.source,
        source_id=evidence.source_id,
        source_url=evidence.source_url,
        captured_at=evidence.captured_at,
        title=_recover_title(evidence.title, evidence.body, evidence.source_url),
        body=_strip_more_about(evidence.body),
        segment=evidence.segment,
        attributes=evidence.attributes,
    )
    annotated = annotate_profile_and_market(
        evidence,
        segment,
        visible_client_card_text=str(raw.get("card_text", "")),
    )
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


def _resilient_navigate(page: Any, url: str, *, wait_seconds: float) -> None:
    try:
        _original_navigate(page, url, wait_seconds=wait_seconds)
        return
    except Exception as error:
        if error.__class__.__name__ != "TimeoutError":
            raise

    # A normal Upwork page may be usable even when the browser lifecycle event
    # times out. Retry once using the earliest safe lifecycle event. Normal
    # login/challenge handling still runs immediately after this function.
    try:
        page.goto(url, wait_until="commit", timeout=30_000)
    except Exception as retry_error:
        if retry_error.__class__.__name__ != "TimeoutError":
            raise
    try:
        page.wait_for_timeout(int(max(2.0, min(wait_seconds, 8.0)) * 1000))
    except Exception:
        pass

    target = urlparse(url)
    current = urlparse(str(getattr(page, "url", "")))
    if current.hostname not in {"upwork.com", "www.upwork.com"}:
        raise TimeoutError("Upwork navigation timed out before reaching the expected domain.")
    if target.path and current.path != target.path:
        raise TimeoutError("Upwork navigation timed out before reaching the configured saved search.")


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
            if _trusted_detail_value(key, value):
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

        payment_status = str(attributes.get("payment_status") or "").strip().casefold()
        if payment_status in {"verified", "unverified"}:
            attributes["payment_verified"] = payment_status == "verified"

        selected_body = detail.body if len(detail.body.strip()) >= len(original.body.strip()) else original.body
        evidence = SourceEvidence(
            source="upwork",
            source_id=original.source_id,
            source_url=original.source_url,
            captured_at=utc_now_iso(),
            title=_recover_title(original.title, detail.body or original.body, source_url),
            body=_strip_more_about(selected_body),
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


def _recovery_objects(snapshot_path: Path) -> tuple[PilotSummary, list[PilotItem], str]:
    payload = json.loads(snapshot_path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("Recovery snapshot must be an object.")
    raw_summary = payload.get("summary")
    raw_items = payload.get("items")
    if not isinstance(raw_summary, dict) or not isinstance(raw_items, list):
        raise ValueError("Recovery snapshot is missing summary or items.")

    summary = PilotSummary(
        started_at=str(raw_summary.get("started_at") or utc_now_iso()),
        completed_at=str(raw_summary.get("completed_at")) if raw_summary.get("completed_at") else None,
        status=str(raw_summary.get("status") or "interrupted"),
        searches_completed=int(raw_summary.get("searches_completed") or 0),
        human_verification_prompts=int(raw_summary.get("human_verification_prompts") or 0),
        links_found=int(raw_summary.get("links_found") or 0),
        reviewed=int(raw_summary.get("reviewed") or 0),
        extracted=int(raw_summary.get("extracted") or 0),
        duplicates=int(raw_summary.get("duplicates") or 0),
        rejected_extraction=int(raw_summary.get("rejected_extraction") or 0),
        failed=int(raw_summary.get("failed") or 0),
    )

    items: list[PilotItem] = []
    for raw_item in raw_items:
        if not isinstance(raw_item, dict):
            continue
        record_value = raw_item.get("record")
        decision_value = raw_item.get("qualification")
        if not isinstance(record_value, dict) or not isinstance(decision_value, dict):
            continue
        record = OpportunityRecord.from_dict(record_value)
        decision = QualificationDecision(
            disposition=str(decision_value.get("disposition") or "bd_review"),
            priority=str(decision_value.get("priority") or "B"),
            score=int(decision_value.get("score") or 0),
            confidence=str(decision_value.get("confidence") or "low"),
            business_unit=(
                str(decision_value.get("business_unit"))
                if decision_value.get("business_unit") is not None
                else None
            ),
            service_id=(
                str(decision_value.get("service_id"))
                if decision_value.get("service_id") is not None
                else None
            ),
            dimensions={
                str(key): int(value)
                for key, value in dict(decision_value.get("dimensions") or {}).items()
            },
            reasons=tuple(str(value) for value in decision_value.get("reasons") or ()),
            missing_evidence=tuple(str(value) for value in decision_value.get("missing_evidence") or ()),
            risks=tuple(str(value) for value in decision_value.get("risks") or ()),
            proof_ids=tuple(str(value) for value in decision_value.get("proof_ids") or ()),
            recommended_action=str(decision_value.get("recommended_action") or "Review recovered opportunity."),
            configuration_version=str(decision_value.get("configuration_version") or "recovered"),
        )
        items.append(PilotItem(record=record, qualification=decision))

    return summary, items, str(payload.get("config_version") or "recovered")


def _run_with_partial_report(**kwargs: Any) -> _base.ScheduledRunResult:
    result = _original_run_upwork_scheduled(**kwargs)
    output_directory = Path(kwargs["output_directory"])
    report_path = output_directory / "report.html"
    snapshot_path = output_directory / "recovery-snapshot.json"

    if not report_path.exists() and snapshot_path.exists():
        try:
            summary, items, config_version = _recovery_objects(snapshot_path)
            summary.status = result.status
            summary.completed_at = result.completed_at or utc_now_iso()
            summary.failed = max(1, summary.failed)
            _policy_write_pilot_outputs(
                output_directory=output_directory,
                summary=summary,
                items=items,
                config_version=f"{config_version}.partial-recovery",
            )
            (output_directory / "partial-report-notice.json").write_text(
                json.dumps(
                    {
                        "schema_version": "upwork-partial-report.v1",
                        "run_status": result.status,
                        "message": result.message,
                        "recovered_items": len(items),
                        "report": str(report_path),
                        "generated_at": utc_now_iso(),
                    },
                    ensure_ascii=False,
                    indent=2,
                    sort_keys=True,
                ),
                encoding="utf-8",
            )
        except Exception:
            # Never replace the original worker result with a report-recovery error.
            pass

    return result


# Keep the main implementation in one module while replacing only local
# evidence enrichment, title recovery, resilient navigation, qualification,
# A/B output and interrupted-run report recovery hooks. Browser actions and
# the no-external-action boundary are unchanged.
_base._card_evidence = _policy_card_evidence
_base._enrich_from_detail = _safe_enrich_from_detail
_base._navigate = _resilient_navigate
_base.qualify = _policy_qualify
_base.write_pilot_outputs = _policy_write_pilot_outputs

AutomationSettings = _base.AutomationSettings
ScheduledRunResult = _base.ScheduledRunResult
load_automation_settings = _base.load_automation_settings
run_upwork_scheduled = _run_with_partial_report
local_run_id = _base.local_run_id
