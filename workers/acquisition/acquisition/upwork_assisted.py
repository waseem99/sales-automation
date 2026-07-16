from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import time
from typing import Any
from urllib.parse import parse_qs, unquote_plus, urljoin, urlparse

from .browser import persistent_chromium
from .models import OpportunityRecord, SourceEvidence
from .qualification import load_qualification_config, qualify
from .upwork_pilot import (
    PilotItem,
    PilotNoData,
    PilotSummary,
    _dedupe_key,
    _load_seen,
    _save_seen,
    external_job_id,
    parse_upwork_metrics,
    utc_now_iso,
    write_pilot_outputs,
)


class AssistedCaptureStopped(RuntimeError):
    """Raised when the operator elects to stop before any usable capture."""


@dataclass(frozen=True, slots=True)
class AssistedSegment:
    id: str
    label: str
    max_jobs: int


def run_upwork_assisted_pilot(
    *,
    profile_path: Path,
    repository_root: Path,
    pilot_config_path: Path,
    qualification_config_path: Path,
    output_directory: Path,
    checkpoint_path: Path,
) -> tuple[PilotSummary, list[PilotItem]]:
    """Capture visible Upwork result cards after explicit operator navigation.

    The worker never enters search URLs, opens job details, submits proposals, or
    performs anti-detection behavior. The operator uses Upwork normally and
    confirms each visible result page before local extraction.
    """
    from .upwork_pilot import load_upwork_pilot_config

    pilot_config = load_upwork_pilot_config(pilot_config_path)
    qualification_config = load_qualification_config(qualification_config_path)
    segments = tuple(
        AssistedSegment(
            id=search.id,
            label=_search_label(search.id, search.url),
            max_jobs=search.max_jobs,
        )
        for search in pilot_config.searches
    )

    seen = _load_seen(checkpoint_path)
    session_seen: set[str] = set()
    summary = PilotSummary(started_at=utc_now_iso())
    items: list[PilotItem] = []

    with persistent_chromium(profile_path, headless=False) as context:
        page = _select_single_upwork_page(context)
        if not _is_upwork_page(page.url):
            page.goto("https://www.upwork.com/nx/find-work/", wait_until="domcontentloaded", timeout=60_000)
        _operator_resolve_access(page)

        print("\nUPWORK OPERATOR-ASSISTED CAPTURE")
        print("Use the visible browser normally. Open the requested saved search yourself.")
        print("The worker reads only visible job cards after you press Enter.")
        print("It does not open job details, send messages, submit proposals, or bypass security checks.\n")

        for index, segment in enumerate(segments, start=1):
            if summary.reviewed >= pilot_config.max_jobs_total:
                break

            while True:
                print(f"[{index}/{len(segments)}] Open your Upwork saved search for: {segment.label}")
                print("Wait until normal job-result cards are visible in the browser.")
                choice = input("Press Enter to capture, type S to skip, or Q to finish: ").strip().lower()
                if choice == "q":
                    break
                if choice == "s":
                    break

                _operator_resolve_access(page)
                snapshots = extract_visible_job_cards(page, segment.max_jobs)
                if not snapshots:
                    print("No visible Upwork job cards were detected on the current page.")
                    print("Navigate to the saved-search results page, wait for cards to load, then try again.\n")
                    continue

                summary.links_found += len(snapshots)
                for snapshot in snapshots:
                    if summary.reviewed >= pilot_config.max_jobs_total:
                        break
                    source_id = external_job_id(snapshot.source_url)
                    if source_id in seen or source_id in session_seen:
                        summary.duplicates += 1
                        continue

                    summary.reviewed += 1
                    try:
                        evidence = snapshot.to_evidence(segment.id)
                        if len(evidence.body.strip()) < pilot_config.min_description_chars:
                            summary.rejected_extraction += 1
                            continue
                        record = OpportunityRecord(
                            dedupe_key=_dedupe_key(evidence),
                            evidence=evidence,
                        )
                        decision = qualify(record, qualification_config)
                        items.append(PilotItem(record=record, qualification=decision))
                        seen.add(source_id)
                        session_seen.add(source_id)
                        _save_seen(checkpoint_path, seen)
                        summary.extracted += 1
                    except Exception:
                        summary.failed += 1
                print(f"Captured {len(snapshots)} visible card(s) for {segment.label}.\n")
                time.sleep(1.0)
                break

            if choice == "q":
                break

    summary.completed_at = utc_now_iso()
    if summary.links_found == 0 or summary.extracted == 0:
        raise PilotNoData(
            "No usable visible Upwork job cards were captured. Re-run and navigate manually to a saved-search results page before pressing Enter."
        )

    write_pilot_outputs(
        output_directory=output_directory,
        summary=summary,
        items=items,
        config_version=f"{pilot_config.version}.operator-assisted",
    )
    return summary, items


@dataclass(frozen=True, slots=True)
class VisibleJobCard:
    source_url: str
    title: str
    description: str
    card_text: str
    skills: tuple[str, ...]

    def to_evidence(self, segment: str) -> SourceEvidence:
        attributes = parse_upwork_metrics(self.card_text)
        attributes.update(
            {
                "skills": list(self.skills),
                "captured_from": "operator_assisted_visible_card",
                "capture_mode": "human_navigated_visible_results",
                "pilot_schema_version": "upwork-assisted-evidence.v1",
            }
        )
        body = self.description.strip() or self.card_text.strip()
        evidence = SourceEvidence(
            source="upwork",
            source_id=external_job_id(self.source_url),
            source_url=self.source_url,
            captured_at=utc_now_iso(),
            title=self.title.strip() or "Untitled Upwork opportunity",
            body=body,
            segment=segment,
            attributes=attributes,
        )
        evidence.validate()
        return evidence


def extract_visible_job_cards(page: Any, limit: int) -> list[VisibleJobCard]:
    selectors = (
        'article[data-test="JobTile"]',
        'section[data-test="job-tile"]',
        '[data-test="job-tile-list"] article',
        'article.job-tile',
    )
    cards = None
    for selector in selectors:
        locator = page.locator(selector)
        if locator.count() > 0:
            cards = locator
            break
    if cards is None:
        return []

    values: list[VisibleJobCard] = []
    seen_urls: set[str] = set()
    for index in range(min(cards.count(), max(1, limit) * 3)):
        card = cards.nth(index)
        try:
            if not card.is_visible(timeout=500):
                continue
            title_link = _first_locator(
                card,
                (
                    'a[data-test="job-tile-title-link"]',
                    'a[href*="/jobs/"]',
                    'a[href*="/freelance-jobs/apply/"]',
                    "h2 a",
                    "h3 a",
                ),
            )
            if title_link is None:
                continue
            href = title_link.get_attribute("href")
            if not href:
                continue
            source_url = _canonical_visible_job_url(urljoin("https://www.upwork.com", href))
            if not source_url or source_url in seen_urls:
                continue
            title = " ".join((title_link.inner_text(timeout=2_000) or "").split())
            description_node = _first_locator(
                card,
                (
                    '[data-test="UpCLineClamp JobDescription"]',
                    '[data-test="job-description"]',
                    '[data-test="job-description-text"]',
                    "p",
                ),
            )
            description = ""
            if description_node is not None:
                description = " ".join((description_node.inner_text(timeout=2_000) or "").split())
            card_text = " ".join((card.inner_text(timeout=3_000) or "").split())
            skills = tuple(_extract_card_skills(card))
            if not title or not card_text:
                continue
            seen_urls.add(source_url)
            values.append(
                VisibleJobCard(
                    source_url=source_url,
                    title=title,
                    description=description,
                    card_text=card_text[:12_000],
                    skills=skills,
                )
            )
            if len(values) >= limit:
                break
        except Exception:
            continue
    return values


def _operator_resolve_access(page: Any) -> None:
    for attempt in range(1, 6):
        state = _access_state(page)
        if state == "ready":
            return
        print("\nUPWORK HUMAN ACTION REQUIRED")
        if state == "challenge":
            print("Complete the visible Cloudflare/security verification in the browser yourself.")
        elif state == "login":
            print("Complete the visible Upwork login or account verification in the browser yourself.")
        else:
            print("Navigate the browser back to a normal Upwork page.")
        input("After a normal Upwork page is fully visible, return here and press Enter: ")
        page.wait_for_timeout(2_000)
    raise AssistedCaptureStopped("Upwork did not return to a normal authenticated page after five operator attempts.")


def _access_state(page: Any) -> str:
    parsed = urlparse(page.url)
    path = parsed.path.lower()
    if parsed.hostname not in {"upwork.com", "www.upwork.com"}:
        return "unexpected"
    if any(value in path for value in ("/login", "/account-security", "/identity-verification")):
        return "login"
    body = ""
    try:
        body = page.locator("body").inner_text(timeout=5_000).lower()
    except Exception:
        return "challenge"
    challenge_terms = (
        "verify you are human",
        "checking your browser",
        "performing security verification",
        "complete the security check",
        "cf-chl-",
        "cloudflare",
    )
    if any(term in body for term in challenge_terms):
        return "challenge"
    return "ready"


def _select_single_upwork_page(context: Any) -> Any:
    pages = list(context.pages)
    selected = None
    for page in reversed(pages):
        if _is_upwork_page(page.url):
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


def _is_upwork_page(url: str) -> bool:
    return urlparse(url).hostname in {"upwork.com", "www.upwork.com"}


def _first_locator(parent: Any, selectors: tuple[str, ...]) -> Any | None:
    for selector in selectors:
        locator = parent.locator(selector)
        if locator.count() > 0:
            return locator.first
    return None


def _extract_card_skills(card: Any) -> list[str]:
    selectors = (
        '[data-test="TokenClamp"] a',
        '[data-test="Skill"]',
        'a[href*="ontology_skill"]',
        'button[data-test*="skill"]',
    )
    values: list[str] = []
    seen: set[str] = set()
    for selector in selectors:
        locator = card.locator(selector)
        for index in range(min(locator.count(), 30)):
            try:
                value = " ".join((locator.nth(index).inner_text(timeout=1_000) or "").split())
            except Exception:
                continue
            key = value.casefold()
            if value and 1 < len(value) <= 80 and key not in seen:
                seen.add(key)
                values.append(value)
    return values[:20]


def _canonical_visible_job_url(url: str) -> str | None:
    parsed = urlparse(url)
    if parsed.hostname not in {"upwork.com", "www.upwork.com"}:
        return None
    if "/jobs/" not in parsed.path and "/freelance-jobs/apply/" not in parsed.path:
        return None
    return f"https://www.upwork.com{parsed.path}"


def _search_label(search_id: str, url: str) -> str:
    query = parse_qs(urlparse(url).query).get("q", [])
    if query:
        readable = " ".join(unquote_plus(query[0]).split())
        if readable:
            return f"{search_id} ({readable})"
    return search_id
