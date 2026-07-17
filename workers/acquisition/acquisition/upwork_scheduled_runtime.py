from __future__ import annotations

import json
from pathlib import Path
import re
import time
from typing import Any
from urllib.parse import unquote, urlparse

from .models import OpportunityRecord, SourceEvidence
from .qualification import QualificationDecision, load_qualification_config
from .upwork_market import annotate_profile_and_market, apply_market_policy
from .upwork_pilot import (
    HumanActionRequired,
    PilotItem,
    PilotSummary,
    _dedupe_key,
    _load_seen,
    _save_seen,
    external_job_id,
    load_upwork_pilot_config,
    utc_now_iso,
)
from . import upwork_scheduled as _base


_MORE_ABOUT_TITLE = re.compile(r'more\s+about\s+["“]([^"”]{4,500})["”]\s*$', re.I)
_EXPLICIT_CHALLENGE_TERMS = (
    "verify you are human",
    "performing security verification",
    "complete the security check",
    "checking your browser",
    "verify your identity",
    "unusual activity",
    "cloudflare ray id",
    "enable javascript and cookies to continue",
)


def _has_value(value: object) -> bool:
    if value is None or value == "":
        return False
    if isinstance(value, (list, tuple, set, dict)) and not value:
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
    evidence = _base._card_evidence(raw, segment=segment)
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
    decision = _base.qualify(record, config)
    return apply_market_policy(record, decision)


def _write_outputs(
    *,
    output_directory: Path,
    summary: PilotSummary,
    items: list[PilotItem],
    config_version: str,
) -> None:
    _base.write_pilot_outputs(
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


def _visible_state(page: Any) -> tuple[str, str]:
    """Classify a page without treating an ordinary blank load as verification."""
    if page.is_closed():
        return "closed", "The automated Chrome tab was closed."

    parsed = urlparse(str(getattr(page, "url", "")))
    host = (parsed.hostname or "").lower()
    path = parsed.path.lower()
    if host not in {"upwork.com", "www.upwork.com"}:
        return "unexpected", "Upwork redirected outside its expected domain."
    if any(value in path for value in (
        "/login", "/account-security", "/identity-verification", "/captcha", "/checkpoint", "/challenge"
    )):
        return "verification", "An Upwork login or account-verification page is visible."

    try:
        title = (page.title() or "").strip().lower()
    except Exception:
        title = ""
    if any(value in title for value in ("just a moment", "attention required", "security verification")):
        return "verification", f"Security page title detected: {title[:80]}"

    try:
        if page.locator('iframe[src*="challenges.cloudflare.com"]').count() > 0:
            return "verification", "Cloudflare human-verification frame is visible."
    except Exception:
        pass

    try:
        body = " ".join(page.locator("body").inner_text(timeout=5_000).lower().split())
    except Exception:
        return "blank", "The Upwork page could not yet be read."
    for term in _EXPLICIT_CHALLENGE_TERMS:
        if term in body:
            return "verification", f"Security text detected: {term}"
    if len(body) < 20:
        return "blank", "The Upwork page remained blank or did not finish rendering."
    return "ready", "Normal Upwork content is visible."


def _close_extra_pages(context: Any, keep: Any) -> None:
    for page in list(context.pages):
        if page is keep:
            continue
        try:
            page.close()
        except Exception:
            pass


def _navigate_search(
    page: Any,
    url: str,
    *,
    wait_seconds: float,
    settings: _base.AutomationSettings,
    attention_path: Path,
    status_path: Path,
    result: _base.ScheduledRunResult,
) -> tuple[bool, str, int]:
    last_reason = "The Upwork page did not load."
    for attempt in range(1, 3):
        try:
            page.goto(url, wait_until="commit", timeout=30_000)
        except Exception as error:
            if error.__class__.__name__ != "TimeoutError":
                last_reason = f"Navigation failed safely: {error.__class__.__name__}."
            else:
                last_reason = "Upwork navigation reached its safe timeout."

        try:
            page.wait_for_timeout(int(max(5.0, min(wait_seconds, 12.0)) * 1000))
        except Exception:
            pass

        state, reason = _visible_state(page)
        last_reason = reason
        if state == "ready":
            return True, reason, attempt
        if state == "verification":
            # Delegate only explicit verification states to the human gate. An
            # ordinary blank page is retried and skipped; it never causes a
            # 15-minute verification wait.
            _base._wait_for_access(
                page,
                settings=settings,
                attention_path=attention_path,
                status_path=status_path,
                result=result,
            )
            state, reason = _visible_state(page)
            if state == "ready":
                return True, reason, attempt
            last_reason = reason

        if attempt == 1:
            try:
                page.reload(wait_until="commit", timeout=25_000)
                page.wait_for_timeout(6_000)
            except Exception:
                pass

    return False, last_reason, 2


def _capture_search(
    page: Any,
    search: Any,
    *,
    settings: _base.AutomationSettings,
    attention_path: Path,
    status_path: Path,
    result: _base.ScheduledRunResult,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    started_at = utc_now_iso()
    ready, reason, attempts = _navigate_search(
        page,
        search.url,
        wait_seconds=max(settings.navigation_wait_seconds, search.delay_seconds),
        settings=settings,
        attention_path=attention_path,
        status_path=status_path,
        result=result,
    )
    diagnostic: dict[str, Any] = {
        "search_id": search.id,
        "url": search.url,
        "started_at": started_at,
        "completed_at": utc_now_iso(),
        "attempts": attempts,
        "status": "failed",
        "cards_found": 0,
        "message": reason,
    }
    if not ready:
        diagnostic["status"] = "blank_or_timeout"
        return [], diagnostic

    try:
        cards = _base._capture_cards(page, search.max_jobs)
    except Exception as error:
        diagnostic["status"] = "capture_error"
        diagnostic["message"] = f"Card capture failed safely: {error.__class__.__name__}."
        return [], diagnostic

    if not cards:
        try:
            page.reload(wait_until="commit", timeout=25_000)
            page.wait_for_timeout(7_000)
        except Exception:
            pass
        state, retry_reason = _visible_state(page)
        if state == "verification":
            _base._wait_for_access(
                page,
                settings=settings,
                attention_path=attention_path,
                status_path=status_path,
                result=result,
            )
            state, retry_reason = _visible_state(page)
        if state == "ready":
            try:
                cards = _base._capture_cards(page, search.max_jobs)
            except Exception:
                cards = []
        reason = retry_reason

    diagnostic["completed_at"] = utc_now_iso()
    diagnostic["cards_found"] = len(cards)
    if cards:
        diagnostic["status"] = "completed"
        diagnostic["message"] = "Visible Upwork job cards captured successfully."
    else:
        diagnostic["status"] = "no_cards"
        diagnostic["message"] = reason or "No trustworthy visible job cards were detected."
    return cards, diagnostic


def _write_search_results(path: Path, diagnostics: list[dict[str, Any]]) -> None:
    payload = {
        "schema_version": "upwork-search-results.v1",
        "generated_at": utc_now_iso(),
        "expected_searches": 3,
        "successful_searches": sum(1 for item in diagnostics if item.get("status") == "completed"),
        "searches": diagnostics,
    }
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True), encoding="utf-8")


def _finalize(
    *,
    output_directory: Path,
    summary: PilotSummary,
    items: list[PilotItem],
    diagnostics: list[dict[str, Any]],
    result: _base.ScheduledRunResult,
    config_version: str,
) -> None:
    try:
        _write_outputs(
            output_directory=output_directory,
            summary=summary,
            items=items,
            config_version=config_version,
        )
    finally:
        _write_search_results(output_directory / "search-results.json", diagnostics)
        (output_directory / "automation-result.json").write_text(
            json.dumps(result.to_dict(), ensure_ascii=False, indent=2, sort_keys=True),
            encoding="utf-8",
        )


def run_upwork_scheduled(
    *,
    profile_path: Path,
    repository_root: Path,
    config_path: Path,
    qualification_config_path: Path,
    output_directory: Path,
    checkpoint_path: Path,
    state_directory: Path,
    enable_ingestion: bool,
) -> _base.ScheduledRunResult:
    del repository_root
    settings = _base.load_automation_settings(config_path)
    pilot_config = load_upwork_pilot_config(config_path)
    qualification_config = load_qualification_config(qualification_config_path)
    state_directory.mkdir(parents=True, exist_ok=True)
    output_directory.mkdir(parents=True, exist_ok=True)

    started_at = utc_now_iso()
    result = _base.ScheduledRunResult(
        run_id=output_directory.name,
        status="starting",
        started_at=started_at,
        completed_at=None,
        output_directory=str(output_directory),
        searches_completed=0,
        links_found=0,
        reviewed=0,
        extracted=0,
        duplicates=0,
        failed=0,
        priority_a_count=0,
        priority_b_count=0,
        priority_c_count=0,
        detail_enrichments=0,
        ingested=0,
        ingestion_pending=0,
        dashboard_ingestion_enabled=enable_ingestion,
        human_action_required=False,
        message="Starting stability-first scheduled Upwork acquisition run.",
    )
    status_path = state_directory / "upwork-automation-status.json"
    attention_path = state_directory / "upwork-attention-required.json"
    pending_path = state_directory / "prospect-desk-ingestion-pending.jsonl"
    lock_path = state_directory / "upwork-automation.lock"
    _base._write_status(status_path, result)

    summary = PilotSummary(started_at=started_at)
    items: list[PilotItem] = []
    diagnostics: list[dict[str, Any]] = []
    permanent_seen = _load_seen(checkpoint_path)
    session_seen: set[str] = set()
    started_monotonic = time.monotonic()
    config_version = f"{pilot_config.version}.{settings.version}.stability-v1"

    try:
        with _base._exclusive_lock(
            lock_path,
            stale_after_seconds=settings.max_runtime_minutes * 60 + 900,
        ):
            result.status = "running"
            result.message = "Single-tab Chrome worker is checking the three approved saved searches."
            _base._write_status(status_path, result)

            if enable_ingestion:
                result.ingested += _base._flush_pending_ingestion(
                    pending_path=pending_path,
                    settings=settings,
                )

            with _base.persistent_chromium(
                profile_path,
                headless=False,
                installed_only=settings.installed_browser_only,
            ) as context:
                page = _base._select_page(context)
                _close_extra_pages(context, page)

                for search in pilot_config.searches:
                    if summary.reviewed >= pilot_config.max_jobs_total:
                        break
                    try:
                        _base._ensure_runtime(started_monotonic, settings)
                    except Exception as error:
                        diagnostics.append({
                            "search_id": search.id,
                            "url": search.url,
                            "started_at": utc_now_iso(),
                            "completed_at": utc_now_iso(),
                            "attempts": 0,
                            "status": "runtime_limit",
                            "cards_found": 0,
                            "message": str(error),
                        })
                        summary.failed += 1
                        result.failed = summary.failed
                        break

                    try:
                        cards, diagnostic = _capture_search(
                            page,
                            search,
                            settings=settings,
                            attention_path=attention_path,
                            status_path=status_path,
                            result=result,
                        )
                    except HumanActionRequired:
                        raise
                    except Exception as error:
                        cards = []
                        diagnostic = {
                            "search_id": search.id,
                            "url": search.url,
                            "started_at": utc_now_iso(),
                            "completed_at": utc_now_iso(),
                            "attempts": 1,
                            "status": "failed",
                            "cards_found": 0,
                            "message": f"Search failed safely: {error.__class__.__name__}.",
                        }
                    diagnostics.append(diagnostic)
                    _close_extra_pages(context, page)

                    if diagnostic["status"] != "completed":
                        summary.failed += 1
                        result.failed = summary.failed
                        _write_search_results(output_directory / "search-results.json", diagnostics)
                        _base._write_status(status_path, result)
                        continue

                    summary.searches_completed += 1
                    summary.links_found += len(cards)
                    result.searches_completed = summary.searches_completed
                    result.links_found = summary.links_found

                    for raw in cards:
                        if summary.reviewed >= pilot_config.max_jobs_total:
                            break
                        source_url = _base.canonical_visible_job_url(str(raw.get("source_url", "")))
                        if not source_url:
                            summary.rejected_extraction += 1
                            continue
                        source_id = external_job_id(source_url)
                        if source_id in permanent_seen or source_id in session_seen:
                            summary.duplicates += 1
                            result.duplicates = summary.duplicates
                            continue

                        summary.reviewed += 1
                        result.reviewed = summary.reviewed
                        try:
                            evidence = _policy_card_evidence(raw, segment=search.id)
                            if len(evidence.body.strip()) < pilot_config.min_description_chars:
                                summary.rejected_extraction += 1
                                continue
                            record = OpportunityRecord(dedupe_key=_dedupe_key(evidence), evidence=evidence)
                            decision = _policy_qualify(record, qualification_config)
                            items.append(PilotItem(record=record, qualification=decision))
                            session_seen.add(source_id)
                            summary.extracted += 1
                            result.extracted = summary.extracted
                            _base._refresh_priority_counts(result, items)
                            _base._write_snapshot(output_directory, summary, items, settings.version)
                            _base._write_status(status_path, result)
                        except Exception:
                            summary.failed += 1
                            result.failed = summary.failed
                            _base._write_status(status_path, result)

            successful = sum(1 for item in diagnostics if item.get("status") == "completed")
            all_searches_completed = successful == len(pilot_config.searches)
            summary.status = "completed" if all_searches_completed else "completed_with_warnings"
            summary.completed_at = utc_now_iso()

            if enable_ingestion:
                ingested, pending = _base._ingest_items(
                    items=items,
                    pending_path=pending_path,
                    settings=settings,
                )
                result.ingested += ingested
                result.ingestion_pending = pending
            else:
                result.ingestion_pending = sum(
                    1 for item in items if item.qualification.priority in {"A", "B"}
                )

            permanent_seen.update(session_seen)
            _save_seen(checkpoint_path, permanent_seen)
            _base._remove_file(attention_path)
            _base._prune_old_runs(output_directory.parent, settings.retention_days)
            result.status = summary.status
            result.completed_at = summary.completed_at
            result.message = (
                f"Completed {successful} of {len(pilot_config.searches)} searches; "
                f"{summary.extracted} new opportunities captured."
            )
            _base._write_status(status_path, result)
            _finalize(
                output_directory=output_directory,
                summary=summary,
                items=items,
                diagnostics=diagnostics,
                result=result,
                config_version=config_version,
            )
            return result

    except _base.AlreadyRunning as error:
        result.status = "skipped_already_running"
        result.completed_at = utc_now_iso()
        result.message = str(error)
    except HumanActionRequired as error:
        result.status = "human_action_required"
        result.completed_at = utc_now_iso()
        result.human_action_required = True
        result.message = str(error)
    except Exception as error:
        result.status = "failed"
        result.completed_at = utc_now_iso()
        result.failed = max(1, summary.failed + 1)
        result.message = f"Scheduled worker failed safely: {error.__class__.__name__}."

    summary.status = result.status
    summary.completed_at = result.completed_at or utc_now_iso()
    summary.failed = max(summary.failed, result.failed)
    result.searches_completed = summary.searches_completed
    result.links_found = summary.links_found
    result.reviewed = summary.reviewed
    result.extracted = summary.extracted
    result.duplicates = summary.duplicates
    _base._refresh_priority_counts(result, items)
    _base._write_snapshot(output_directory, summary, items, settings.version)
    _base._write_status(status_path, result)
    _finalize(
        output_directory=output_directory,
        summary=summary,
        items=items,
        diagnostics=diagnostics,
        result=result,
        config_version=f"{config_version}.partial",
    )
    return result


AutomationSettings = _base.AutomationSettings
ScheduledRunResult = _base.ScheduledRunResult
load_automation_settings = _base.load_automation_settings
local_run_id = _base.local_run_id
