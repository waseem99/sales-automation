from __future__ import annotations

from contextlib import contextmanager
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
import json
import os
from pathlib import Path
import time
import tomllib
from typing import Any, Iterator
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

from .browser import persistent_chromium
from .models import OpportunityRecord, SourceEvidence
from .qualification import QualificationDecision, load_qualification_config, qualify
from .upwork_card import canonical_visible_job_url, clean_visible_description, parse_visible_card_metrics
from .upwork_pilot import (
    HumanActionRequired,
    PilotItem,
    PilotSummary,
    _dedupe_key,
    _load_seen,
    _save_seen,
    external_job_id,
    extract_job_evidence,
    load_upwork_pilot_config,
    utc_now_iso,
    write_pilot_outputs,
)


_CAPTURE_SCRIPT = r"""
(limit) => {
  const norm = value => String(value || '').replace(/\s+/g, ' ').trim();
  const visible = element => {
    if (!(element instanceof Element)) return false;
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
  };
  const canonical = href => {
    try {
      const url = new URL(href, 'https://www.upwork.com');
      if (!['upwork.com', 'www.upwork.com'].includes(url.hostname)) return null;
      if (!url.pathname.startsWith('/jobs/') && !url.pathname.startsWith('/freelance-jobs/apply/')) return null;
      if (!/~[A-Za-z0-9_-]{8,}/.test(url.pathname)) return null;
      return `https://www.upwork.com${url.pathname}`;
    } catch (_error) {
      return null;
    }
  };
  const cues = [
    'posted ', 'proposal', 'payment verified', 'payment unverified', 'est. budget',
    'hourly', 'fixed-price', 'spent', 'intermediate', 'expert', 'entry level'
  ];
  const junk = [
    'job feedback', 'just not interested', 'vague description', 'unrealistic expectations',
    'too many applicants', 'job posted too long ago', 'poor reviews about the client',
    "doesn't match skills", 'i am overqualified', 'budget too low',
    'not in my preferred location', 'the client will not be notified',
    'your feedback helps us improve job search'
  ];
  const cutJunk = value => {
    const text = norm(value);
    const lower = text.toLowerCase();
    const positions = junk.map(marker => lower.indexOf(marker)).filter(index => index >= 0);
    return positions.length ? text.slice(0, Math.min(...positions)).trim() : text;
  };
  const jobUrls = node => new Set(
    Array.from(node.querySelectorAll('a[href]'))
      .map(anchor => canonical(anchor.getAttribute('href')))
      .filter(Boolean)
  );
  const cueCount = text => {
    const lower = text.toLowerCase();
    return cues.reduce((count, cue) => count + (lower.includes(cue) ? 1 : 0), 0);
  };
  const links = Array.from(document.querySelectorAll('a[href]'))
    .filter(link => visible(link) && canonical(link.getAttribute('href')));
  const results = [];
  const seen = new Set();

  for (const link of links) {
    const sourceUrl = canonical(link.getAttribute('href'));
    if (!sourceUrl || seen.has(sourceUrl)) continue;

    let node = link;
    let best = null;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (let depth = 0; depth < 12 && node && node !== document.body; depth += 1) {
      node = node.parentElement;
      if (!node || !visible(node)) continue;
      const text = norm(node.innerText || node.textContent);
      if (text.length < 100 || text.length > 12000) continue;
      if (jobUrls(node).size !== 1) continue;
      const count = cueCount(text);
      if (count < 2) continue;
      const semantic = node.matches('article, section, [data-test*="job" i], [class*="job" i]') ? 12 : 0;
      const junkPenalty = junk.some(marker => text.toLowerCase().includes(marker)) ? 30 : 0;
      const lengthPenalty = Math.max(0, text.length - 5000) / 250;
      const score = count * 10 + semantic - junkPenalty - lengthPenalty;
      if (score > bestScore) {
        best = node;
        bestScore = score;
      }
    }
    if (!best) continue;

    let title = norm(link.innerText || link.textContent);
    if (title.length < 4) {
      const heading = best.querySelector('h1,h2,h3,h4,[role="heading"]');
      title = norm(heading ? heading.innerText : '');
    }
    if (!title) continue;

    const descriptionSelectors = [
      '[data-test="UpCLineClamp JobDescription"]', '[data-test="job-description"]',
      '[data-test="job-description-text"]', '[data-test*="description"]',
      '[class*="description"]', '[class*="line-clamp"]', 'p'
    ];
    const descriptions = [];
    const descriptionSeen = new Set();
    for (const selector of descriptionSelectors) {
      for (const candidate of best.querySelectorAll(selector)) {
        if (!visible(candidate)) continue;
        const value = cutJunk(candidate.innerText || candidate.textContent);
        const key = value.toLowerCase();
        if (value.length >= 80 && value.split(/\s+/).length >= 14 && !descriptionSeen.has(key)) {
          descriptionSeen.add(key);
          descriptions.push(value);
        }
      }
    }
    descriptions.sort((a, b) => b.length - a.length);

    const skills = [];
    const skillSeen = new Set();
    for (const selector of [
      '[data-test="TokenClamp"] a', '[data-test="Skill"]', '[data-test*="skill"]',
      'a[href*="ontology_skill"]', 'button[data-test*="skill"]', '[class*="token"]'
    ]) {
      for (const candidate of best.querySelectorAll(selector)) {
        if (!visible(candidate)) continue;
        const value = norm(candidate.innerText || candidate.textContent);
        const key = value.toLowerCase();
        if (value.length > 1 && value.length <= 80 && !skillSeen.has(key)) {
          skillSeen.add(key);
          skills.push(value);
        }
        if (skills.length >= 20) break;
      }
      if (skills.length >= 20) break;
    }

    const cardText = cutJunk(best.innerText || best.textContent).slice(0, 12000);
    if (!cardText) continue;
    seen.add(sourceUrl);
    results.push({
      source_url: sourceUrl,
      title,
      description: descriptions[0] || '',
      card_text: cardText,
      skills
    });
    if (results.length >= Math.max(1, Number(limit) || 1)) break;
  }
  return results;
}
"""


@dataclass(frozen=True, slots=True)
class AutomationSettings:
    version: str
    navigation_wait_seconds: float
    challenge_wait_seconds: float
    challenge_poll_seconds: float
    max_runtime_minutes: float
    max_detail_enrichments: int
    detail_wait_seconds: float
    installed_browser_only: bool
    ingest_url_env: str
    ingest_token_env: str
    request_timeout_seconds: float
    retention_days: int


@dataclass(slots=True)
class ScheduledRunResult:
    run_id: str
    status: str
    started_at: str
    completed_at: str | None
    output_directory: str
    searches_completed: int
    links_found: int
    reviewed: int
    extracted: int
    duplicates: int
    failed: int
    priority_a_count: int
    priority_b_count: int
    priority_c_count: int
    detail_enrichments: int
    ingested: int
    ingestion_pending: int
    dashboard_ingestion_enabled: bool
    human_action_required: bool
    message: str

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class AlreadyRunning(RuntimeError):
    pass


def load_automation_settings(path: Path) -> AutomationSettings:
    with path.open('rb') as handle:
        raw = tomllib.load(handle)
    values = raw.get('automation', {})
    return AutomationSettings(
        version=str(values.get('version', 'upwork-scheduled.v1')).strip(),
        navigation_wait_seconds=max(8.0, min(float(values.get('navigation_wait_seconds', 15.0)), 90.0)),
        challenge_wait_seconds=max(60.0, min(float(values.get('challenge_wait_seconds', 900.0)), 3600.0)),
        challenge_poll_seconds=max(5.0, min(float(values.get('challenge_poll_seconds', 15.0)), 60.0)),
        max_runtime_minutes=max(10.0, min(float(values.get('max_runtime_minutes', 40.0)), 120.0)),
        max_detail_enrichments=max(0, min(int(values.get('max_detail_enrichments', 8)), 25)),
        detail_wait_seconds=max(8.0, min(float(values.get('detail_wait_seconds', 12.0)), 90.0)),
        installed_browser_only=bool(values.get('installed_browser_only', True)),
        ingest_url_env=str(values.get('ingest_url_env', 'ACQUISITION_INGEST_URL')).strip(),
        ingest_token_env=str(values.get('ingest_token_env', 'ACQUISITION_INGEST_TOKEN')).strip(),
        request_timeout_seconds=max(5.0, min(float(values.get('request_timeout_seconds', 30.0)), 120.0)),
        retention_days=max(7, min(int(values.get('retention_days', 30)), 365)),
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
) -> ScheduledRunResult:
    del repository_root
    settings = load_automation_settings(config_path)
    pilot_config = load_upwork_pilot_config(config_path)
    qualification_config = load_qualification_config(qualification_config_path)
    state_directory.mkdir(parents=True, exist_ok=True)
    output_directory.mkdir(parents=True, exist_ok=True)

    run_id = output_directory.name
    started_at = utc_now_iso()
    result = ScheduledRunResult(
        run_id=run_id,
        status='starting',
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
        message='Starting scheduled Upwork acquisition run.',
    )
    status_path = state_directory / 'upwork-automation-status.json'
    attention_path = state_directory / 'upwork-attention-required.json'
    pending_path = state_directory / 'prospect-desk-ingestion-pending.jsonl'
    lock_path = state_directory / 'upwork-automation.lock'
    _write_status(status_path, result)

    started_monotonic = time.monotonic()
    summary = PilotSummary(started_at=started_at)
    items: list[PilotItem] = []
    permanent_seen = _load_seen(checkpoint_path)
    session_seen: set[str] = set()
    detail_enrichments = 0

    try:
        with _exclusive_lock(lock_path, stale_after_seconds=settings.max_runtime_minutes * 60 + 900):
            result.status = 'running'
            result.message = 'Visible Chrome worker is running configured Upwork searches.'
            _write_status(status_path, result)

            if enable_ingestion:
                result.ingested += _flush_pending_ingestion(
                    pending_path=pending_path,
                    settings=settings,
                )

            with persistent_chromium(
                profile_path,
                headless=False,
                installed_only=settings.installed_browser_only,
            ) as context:
                search_page = _select_page(context)
                for search in pilot_config.searches:
                    if summary.reviewed >= pilot_config.max_jobs_total:
                        break
                    _ensure_runtime(started_monotonic, settings)
                    _navigate(
                        search_page,
                        search.url,
                        wait_seconds=max(settings.navigation_wait_seconds, search.delay_seconds),
                    )
                    _wait_for_access(
                        search_page,
                        settings=settings,
                        attention_path=attention_path,
                        status_path=status_path,
                        result=result,
                    )
                    cards = _capture_cards(search_page, search.max_jobs)
                    if not cards:
                        search_page.reload(wait_until='domcontentloaded', timeout=60_000)
                        search_page.wait_for_timeout(int(settings.navigation_wait_seconds * 1000))
                        _wait_for_access(
                            search_page,
                            settings=settings,
                            attention_path=attention_path,
                            status_path=status_path,
                            result=result,
                        )
                        cards = _capture_cards(search_page, search.max_jobs)

                    summary.searches_completed += 1
                    summary.links_found += len(cards)
                    result.searches_completed = summary.searches_completed
                    result.links_found = summary.links_found
                    _write_status(status_path, result)

                    for raw in cards:
                        if summary.reviewed >= pilot_config.max_jobs_total:
                            break
                        _ensure_runtime(started_monotonic, settings)
                        source_url = canonical_visible_job_url(str(raw.get('source_url', '')))
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
                            evidence = _card_evidence(raw, segment=search.id)
                            if len(evidence.body.strip()) < pilot_config.min_description_chars:
                                summary.rejected_extraction += 1
                                continue
                            record = OpportunityRecord(dedupe_key=_dedupe_key(evidence), evidence=evidence)
                            decision = qualify(record, qualification_config)

                            if (
                                detail_enrichments < settings.max_detail_enrichments
                                and decision.priority in {'A', 'B'}
                            ):
                                enriched = _enrich_from_detail(
                                    context=context,
                                    source_url=source_url,
                                    segment=search.id,
                                    original=evidence,
                                    settings=settings,
                                    attention_path=attention_path,
                                    status_path=status_path,
                                    result=result,
                                )
                                if enriched is not None:
                                    evidence = enriched
                                    record = OpportunityRecord(dedupe_key=_dedupe_key(evidence), evidence=evidence)
                                    decision = qualify(record, qualification_config)
                                    detail_enrichments += 1

                            items.append(PilotItem(record=record, qualification=decision))
                            session_seen.add(source_id)
                            summary.extracted += 1
                            result.extracted = summary.extracted
                            result.detail_enrichments = detail_enrichments
                            _refresh_priority_counts(result, items)
                            _write_snapshot(output_directory, summary, items, settings.version)
                            _write_status(status_path, result)
                        except HumanActionRequired:
                            raise
                        except Exception:
                            summary.failed += 1
                            result.failed = summary.failed
                            _write_status(status_path, result)

            summary.status = 'completed'
            summary.completed_at = utc_now_iso()
            write_pilot_outputs(
                output_directory=output_directory,
                summary=summary,
                items=items,
                config_version=f'{pilot_config.version}.{settings.version}',
            )

            if enable_ingestion:
                ingested, pending = _ingest_items(
                    items=items,
                    pending_path=pending_path,
                    settings=settings,
                )
                result.ingested += ingested
                result.ingestion_pending = pending
            else:
                result.ingestion_pending = sum(1 for item in items if item.qualification.priority in {'A', 'B'})

            permanent_seen.update(session_seen)
            _save_seen(checkpoint_path, permanent_seen)
            _remove_file(attention_path)
            _prune_old_runs(output_directory.parent, settings.retention_days)
            result.status = 'completed'
            result.completed_at = utc_now_iso()
            result.message = (
                f'Completed {summary.searches_completed} searches; '
                f'{summary.extracted} new opportunities captured.'
            )
            _write_status(status_path, result)
            (output_directory / 'automation-result.json').write_text(
                json.dumps(result.to_dict(), ensure_ascii=False, indent=2, sort_keys=True),
                encoding='utf-8',
            )
            return result
    except AlreadyRunning as error:
        result.status = 'skipped_already_running'
        result.completed_at = utc_now_iso()
        result.message = str(error)
        _write_status(status_path, result)
        return result
    except HumanActionRequired as error:
        result.status = 'human_action_required'
        result.completed_at = utc_now_iso()
        result.human_action_required = True
        result.message = str(error)
        result.searches_completed = summary.searches_completed
        result.links_found = summary.links_found
        result.reviewed = summary.reviewed
        result.extracted = summary.extracted
        result.duplicates = summary.duplicates
        result.failed = summary.failed
        result.detail_enrichments = detail_enrichments
        _refresh_priority_counts(result, items)
        _write_snapshot(output_directory, summary, items, settings.version)
        _write_status(status_path, result)
        (output_directory / 'automation-result.json').write_text(
            json.dumps(result.to_dict(), ensure_ascii=False, indent=2, sort_keys=True),
            encoding='utf-8',
        )
        return result
    except Exception as error:
        result.status = 'failed'
        result.completed_at = utc_now_iso()
        result.message = f'Scheduled worker failed safely: {error.__class__.__name__}'
        result.searches_completed = summary.searches_completed
        result.links_found = summary.links_found
        result.reviewed = summary.reviewed
        result.extracted = summary.extracted
        result.duplicates = summary.duplicates
        result.failed = summary.failed + 1
        result.detail_enrichments = detail_enrichments
        _refresh_priority_counts(result, items)
        _write_snapshot(output_directory, summary, items, settings.version)
        _write_status(status_path, result)
        (output_directory / 'automation-result.json').write_text(
            json.dumps(result.to_dict(), ensure_ascii=False, indent=2, sort_keys=True),
            encoding='utf-8',
        )
        return result


def _card_evidence(raw: dict[str, Any], *, segment: str) -> SourceEvidence:
    source_url = canonical_visible_job_url(str(raw.get('source_url', '')))
    if not source_url:
        raise ValueError('A concrete Upwork job URL is required.')
    title = str(raw.get('title', '')).strip()[:500]
    card_text = str(raw.get('card_text', ''))[:12_000]
    body, capture_meta = clean_visible_description(
        description=str(raw.get('description', ''))[:10_000],
        card_text=card_text,
        title=title,
    )
    attributes = parse_visible_card_metrics(card_text)
    attributes.update(capture_meta)
    attributes.update({
        'skills': [
            str(value)[:80]
            for value in raw.get('skills', [])[:20]
            if str(value).strip()
        ] if isinstance(raw.get('skills', []), list) else [],
        'captured_from': 'scheduled_visible_search_card',
        'capture_mode': 'scheduled_visible_chrome_navigation',
        'pilot_schema_version': 'upwork-scheduled-evidence.v1',
    })
    evidence = SourceEvidence(
        source='upwork',
        source_id=external_job_id(source_url),
        source_url=source_url,
        captured_at=utc_now_iso(),
        title=title or 'Untitled Upwork opportunity',
        body=body,
        segment=segment,
        attributes=attributes,
    )
    evidence.validate()
    return evidence


def _enrich_from_detail(
    *,
    context: Any,
    source_url: str,
    segment: str,
    original: SourceEvidence,
    settings: AutomationSettings,
    attention_path: Path,
    status_path: Path,
    result: ScheduledRunResult,
) -> SourceEvidence | None:
    detail_page = context.new_page()
    try:
        _navigate(detail_page, source_url, wait_seconds=settings.detail_wait_seconds)
        _wait_for_access(
            detail_page,
            settings=settings,
            attention_path=attention_path,
            status_path=status_path,
            result=result,
        )
        detail = extract_job_evidence(detail_page, segment)
        attributes = dict(original.attributes)
        for key, value in detail.attributes.items():
            if value not in {None, '', [], {}}:
                attributes[key] = value
        skills = []
        for value in list(original.attributes.get('skills', [])) + list(detail.attributes.get('skills', [])):
            text = str(value).strip()
            if text and text.casefold() not in {item.casefold() for item in skills}:
                skills.append(text)
        attributes['skills'] = skills[:25]
        attributes['captured_from'] = 'scheduled_search_card_and_job_detail'
        attributes['capture_quality'] = 'high'
        attributes['detail_enriched'] = True
        evidence = SourceEvidence(
            source='upwork',
            source_id=original.source_id,
            source_url=original.source_url,
            captured_at=utc_now_iso(),
            title=detail.title if detail.title and 'Untitled' not in detail.title else original.title,
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


def _capture_cards(page: Any, limit: int) -> list[dict[str, Any]]:
    value = page.evaluate(_CAPTURE_SCRIPT, max(1, min(int(limit), 20)))
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, dict)]


def _navigate(page: Any, url: str, *, wait_seconds: float) -> None:
    page.goto(url, wait_until='domcontentloaded', timeout=60_000)
    page.wait_for_timeout(int(wait_seconds * 1000))


def _wait_for_access(
    page: Any,
    *,
    settings: AutomationSettings,
    attention_path: Path,
    status_path: Path,
    result: ScheduledRunResult,
) -> None:
    state, reason = _access_state(page)
    if state == 'ready':
        _remove_file(attention_path)
        return

    detected_at = utc_now_iso()
    payload = {
        'schema_version': 'codistan-upwork-attention.v1',
        'detected_at': detected_at,
        'state': state,
        'reason': reason,
        'url': page.url,
        'instruction': (
            'Complete the visible Upwork login or security verification in the open Chrome window. '
            'Do not close the browser; the worker is polling and will resume automatically.'
        ),
    }
    attention_path.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding='utf-8')
    result.status = 'waiting_for_human_verification'
    result.human_action_required = True
    result.message = payload['instruction']
    _write_status(status_path, result)

    deadline = time.monotonic() + settings.challenge_wait_seconds
    while time.monotonic() < deadline:
        time.sleep(settings.challenge_poll_seconds)
        state, reason = _access_state(page)
        if state == 'ready':
            _remove_file(attention_path)
            result.status = 'running'
            result.human_action_required = False
            result.message = 'Verification cleared; scheduled worker resumed automatically.'
            _write_status(status_path, result)
            return
        payload['state'] = state
        payload['reason'] = reason
        payload['url'] = page.url
        attention_path.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding='utf-8')

    raise HumanActionRequired(
        'Upwork login or security verification remained active until the safe waiting window expired. '
        'The run stopped without bypassing the challenge and will retry on the next schedule.'
    )


def _access_state(page: Any) -> tuple[str, str]:
    if page.is_closed():
        return 'closed', 'The automated Chrome tab was closed.'
    parsed = urlparse(page.url)
    host = (parsed.hostname or '').lower()
    path = parsed.path.lower()
    if host not in {'upwork.com', 'www.upwork.com'}:
        return 'unexpected', 'Upwork redirected outside its expected domain.'
    if any(value in path for value in (
        '/login', '/account-security', '/identity-verification', '/captcha', '/checkpoint', '/challenge'
    )):
        return 'login_or_verification', 'An Upwork login or account-verification page is visible.'
    try:
        title = (page.title() or '').strip().lower()
    except Exception:
        title = ''
    if any(value in title for value in ('just a moment', 'attention required', 'security verification')):
        return 'challenge', f'Security page title detected: {title[:80]}'
    try:
        if page.locator('iframe[src*="challenges.cloudflare.com"]').count() > 0:
            return 'challenge', 'Cloudflare human-verification frame is visible.'
    except Exception:
        pass
    try:
        body = ' '.join(page.locator('body').inner_text(timeout=5_000).lower().split())
    except Exception:
        return 'challenge', 'The page could not be read or remained blank.'
    for term in (
        'verify you are human', 'performing security verification', 'complete the security check',
        'checking your browser', 'verify your identity', 'unusual activity', 'cloudflare ray id',
        'enable javascript and cookies to continue'
    ):
        if term in body:
            return 'challenge', f'Security text detected: {term}'
    if len(body) < 20:
        return 'challenge', 'The Upwork page remained blank or did not finish loading.'
    return 'ready', 'Normal Upwork page is visible.'


def _select_page(context: Any) -> Any:
    pages = list(context.pages)
    selected = None
    for page in reversed(pages):
        if urlparse(page.url).hostname in {'upwork.com', 'www.upwork.com'}:
            selected = page
            break
    if selected is None:
        selected = pages[0] if pages else context.new_page()
    for page in pages:
        if page is selected:
            continue
        try:
            page.close()
        except Exception:
            pass
    return selected


def _dashboard_payload(item: PilotItem) -> dict[str, Any]:
    return {
        'schema_version': 'prospect-desk-opportunity.v1',
        'idempotency_key': item.record.dedupe_key,
        'source_record': item.record.to_dict(),
        'qualification': item.qualification.to_dict(),
        'source': 'upwork_scheduled_chrome',
        'external_action_performed': False,
    }


def _ingest_items(
    *,
    items: list[PilotItem],
    pending_path: Path,
    settings: AutomationSettings,
) -> tuple[int, int]:
    endpoint = os.environ.get(settings.ingest_url_env, '').strip()
    token = os.environ.get(settings.ingest_token_env, '').strip()
    payloads = [_dashboard_payload(item) for item in items if item.qualification.priority in {'A', 'B'}]
    if not payloads:
        return 0, _count_jsonl(pending_path)
    if not endpoint or not token:
        _append_pending(pending_path, payloads)
        return 0, _count_jsonl(pending_path)

    ingested = 0
    failed: list[dict[str, Any]] = []
    for payload in payloads:
        try:
            _post_payload(endpoint, token, payload, settings.request_timeout_seconds)
            ingested += 1
        except Exception:
            failed.append(payload)
    if failed:
        _append_pending(pending_path, failed)
    return ingested, _count_jsonl(pending_path)


def _flush_pending_ingestion(*, pending_path: Path, settings: AutomationSettings) -> int:
    endpoint = os.environ.get(settings.ingest_url_env, '').strip()
    token = os.environ.get(settings.ingest_token_env, '').strip()
    if not endpoint or not token or not pending_path.exists():
        return 0
    payloads = _read_jsonl(pending_path)
    if not payloads:
        _remove_file(pending_path)
        return 0
    ingested = 0
    remaining: list[dict[str, Any]] = []
    for payload in payloads:
        try:
            _post_payload(endpoint, token, payload, settings.request_timeout_seconds)
            ingested += 1
        except Exception:
            remaining.append(payload)
    _rewrite_jsonl(pending_path, remaining)
    return ingested


def _post_payload(endpoint: str, token: str, payload: dict[str, Any], timeout_seconds: float) -> None:
    body = json.dumps(payload, ensure_ascii=False).encode('utf-8')
    request = Request(
        endpoint,
        data=body,
        method='POST',
        headers={
            'authorization': f'Bearer {token}',
            'content-type': 'application/json',
            'user-agent': 'codistan-upwork-scheduled-worker/1.0',
            'x-idempotency-key': str(payload.get('idempotency_key', '')),
        },
    )
    try:
        with urlopen(request, timeout=timeout_seconds) as response:
            if response.status < 200 or response.status >= 300:
                raise RuntimeError(f'Prospect Desk ingestion returned HTTP {response.status}.')
    except (HTTPError, URLError, TimeoutError) as error:
        raise RuntimeError('Prospect Desk ingestion request failed.') from error


def _append_pending(path: Path, payloads: list[dict[str, Any]]) -> None:
    if not payloads:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    existing_keys = {
        str(item.get('idempotency_key', ''))
        for item in _read_jsonl(path)
        if str(item.get('idempotency_key', ''))
    }
    with path.open('a', encoding='utf-8') as handle:
        for payload in payloads:
            key = str(payload.get('idempotency_key', ''))
            if key and key in existing_keys:
                continue
            handle.write(json.dumps(payload, ensure_ascii=False, sort_keys=True))
            handle.write('\n')
            if key:
                existing_keys.add(key)


def _read_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    values: list[dict[str, Any]] = []
    for line in path.read_text(encoding='utf-8').splitlines():
        try:
            value = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict):
            values.append(value)
    return values


def _rewrite_jsonl(path: Path, values: list[dict[str, Any]]) -> None:
    if not values:
        _remove_file(path)
        return
    temp = path.with_suffix(path.suffix + '.tmp')
    with temp.open('w', encoding='utf-8') as handle:
        for value in values:
            handle.write(json.dumps(value, ensure_ascii=False, sort_keys=True))
            handle.write('\n')
    temp.replace(path)


def _count_jsonl(path: Path) -> int:
    return len(_read_jsonl(path))


def _write_snapshot(
    output_directory: Path,
    summary: PilotSummary,
    items: list[PilotItem],
    config_version: str,
) -> None:
    payload = {
        'schema_version': 'upwork-scheduled-recovery.v1',
        'config_version': config_version,
        'updated_at': utc_now_iso(),
        'summary': summary.to_dict(),
        'items': [item.to_dict() for item in items],
    }
    temp = output_directory / 'recovery-snapshot.json.tmp'
    temp.write_text(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True), encoding='utf-8')
    temp.replace(output_directory / 'recovery-snapshot.json')


def _write_status(path: Path, result: ScheduledRunResult) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + '.tmp')
    temp.write_text(json.dumps(result.to_dict(), ensure_ascii=False, indent=2, sort_keys=True), encoding='utf-8')
    temp.replace(path)


def _refresh_priority_counts(result: ScheduledRunResult, items: list[PilotItem]) -> None:
    result.priority_a_count = sum(1 for item in items if item.qualification.priority == 'A')
    result.priority_b_count = sum(1 for item in items if item.qualification.priority == 'B')
    result.priority_c_count = sum(1 for item in items if item.qualification.priority == 'C')


def _ensure_runtime(started_monotonic: float, settings: AutomationSettings) -> None:
    if time.monotonic() - started_monotonic > settings.max_runtime_minutes * 60:
        raise RuntimeError('The configured maximum runtime was reached; the worker stopped safely.')


@contextmanager
def _exclusive_lock(path: Path, *, stale_after_seconds: float) -> Iterator[None]:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        age = time.time() - path.stat().st_mtime
        if age < stale_after_seconds:
            raise AlreadyRunning('Another Upwork acquisition run is already active; this schedule was skipped.')
        _remove_file(path)
    try:
        descriptor = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    except FileExistsError as error:
        raise AlreadyRunning('Another Upwork acquisition run is already active; this schedule was skipped.') from error
    try:
        os.write(descriptor, json.dumps({'pid': os.getpid(), 'started_at': utc_now_iso()}).encode('utf-8'))
        os.close(descriptor)
        yield
    finally:
        _remove_file(path)


def _prune_old_runs(root: Path, retention_days: int) -> None:
    if not root.exists():
        return
    cutoff = time.time() - retention_days * 86_400
    for child in root.iterdir():
        if not child.is_dir():
            continue
        try:
            if child.stat().st_mtime >= cutoff:
                continue
            for nested in sorted(child.rglob('*'), reverse=True):
                if nested.is_file() or nested.is_symlink():
                    nested.unlink(missing_ok=True)
                elif nested.is_dir():
                    nested.rmdir()
            child.rmdir()
        except OSError:
            continue


def _remove_file(path: Path) -> None:
    try:
        path.unlink(missing_ok=True)
    except OSError:
        pass


def local_run_id() -> str:
    return datetime.now(UTC).strftime('%Y%m%d-%H%M%S')
