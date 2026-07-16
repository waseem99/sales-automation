from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import UTC, datetime
import hashlib
import json
from pathlib import Path
import re
import time
import tomllib
from typing import Any
from urllib.parse import urljoin, urlparse

from .browser import persistent_chromium
from .models import OpportunityRecord, SourceEvidence
from .qualification import QualificationDecision, load_qualification_config, qualify


class HumanActionRequired(RuntimeError):
    """Raised when Upwork presents login, verification, or account protection."""


@dataclass(frozen=True, slots=True)
class UpworkSearch:
    id: str
    enabled: bool
    url: str
    max_jobs: int
    delay_seconds: float


@dataclass(frozen=True, slots=True)
class UpworkPilotConfig:
    version: str
    max_jobs_total: int
    min_description_chars: int
    searches: tuple[UpworkSearch, ...]


@dataclass(frozen=True, slots=True)
class PilotItem:
    record: OpportunityRecord
    qualification: QualificationDecision

    def to_dict(self) -> dict[str, Any]:
        return {
            "record": self.record.to_dict(),
            "qualification": self.qualification.to_dict(),
        }


@dataclass(slots=True)
class PilotSummary:
    started_at: str
    completed_at: str | None = None
    links_found: int = 0
    reviewed: int = 0
    extracted: int = 0
    duplicates: int = 0
    rejected_extraction: int = 0
    failed: int = 0

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def utc_now_iso() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def load_upwork_pilot_config(path: Path) -> UpworkPilotConfig:
    with path.open("rb") as handle:
        raw = tomllib.load(handle)
    pilot = raw.get("pilot", {})
    searches: list[UpworkSearch] = []
    for item in raw.get("searches", []):
        url = str(item.get("url", "")).strip()
        if not url.startswith("https://www.upwork.com/"):
            raise ValueError("Every Upwork search URL must start with https://www.upwork.com/")
        searches.append(
            UpworkSearch(
                id=_required(item, "id"),
                enabled=bool(item.get("enabled", True)),
                url=url,
                max_jobs=max(1, min(int(item.get("max_jobs", 5)), 20)),
                delay_seconds=max(2.0, min(float(item.get("delay_seconds", 4.0)), 30.0)),
            )
        )
    enabled = tuple(search for search in searches if search.enabled)
    if not enabled:
        raise ValueError("At least one enabled Upwork search is required")
    return UpworkPilotConfig(
        version=str(pilot.get("version", "upwork-pilot.v1")),
        max_jobs_total=max(1, min(int(pilot.get("max_jobs_total", 20)), 100)),
        min_description_chars=max(40, int(pilot.get("min_description_chars", 100))),
        searches=enabled,
    )


def run_upwork_pilot(
    *,
    profile_path: Path,
    repository_root: Path,
    pilot_config_path: Path,
    qualification_config_path: Path,
    output_directory: Path,
    checkpoint_path: Path,
) -> tuple[PilotSummary, list[PilotItem]]:
    config = load_upwork_pilot_config(pilot_config_path)
    qualification_config = load_qualification_config(qualification_config_path)
    seen = _load_seen(checkpoint_path)
    summary = PilotSummary(started_at=utc_now_iso())
    items: list[PilotItem] = []
    session_seen: set[str] = set()

    with persistent_chromium(profile_path, headless=False) as context:
        search_page = context.pages[0] if context.pages else context.new_page()
        detail_page = context.new_page()
        try:
            for search in config.searches:
                if summary.reviewed >= config.max_jobs_total:
                    break
                search_page.goto(search.url, wait_until="domcontentloaded", timeout=60_000)
                search_page.wait_for_timeout(int(search.delay_seconds * 1000))
                _assert_upwork_session(search_page)
                _settle(search_page)
                links = extract_job_links(search_page, search.max_jobs)
                summary.links_found += len(links)
                for source_url in links:
                    if summary.reviewed >= config.max_jobs_total:
                        break
                    source_id = external_job_id(source_url)
                    if source_id in seen or source_id in session_seen:
                        summary.duplicates += 1
                        continue
                    summary.reviewed += 1
                    try:
                        detail_page.goto(source_url, wait_until="domcontentloaded", timeout=60_000)
                        detail_page.wait_for_timeout(int(search.delay_seconds * 1000))
                        _assert_upwork_session(detail_page)
                        evidence = extract_job_evidence(detail_page, search.id)
                        if len(evidence.body.strip()) < config.min_description_chars:
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
                        time.sleep(search.delay_seconds)
                    except HumanActionRequired:
                        raise
                    except Exception:
                        summary.failed += 1
        finally:
            detail_page.close()
            search_page.close()

    summary.completed_at = utc_now_iso()
    write_pilot_outputs(
        output_directory=output_directory,
        summary=summary,
        items=items,
        config_version=config.version,
    )
    return summary, items


def extract_job_links(page: Any, limit: int) -> list[str]:
    selectors = (
        'a[data-test="job-tile-title-link"]',
        'a[href*="/jobs/"]',
        'a[href*="/freelance-jobs/apply/"]',
    )
    values: list[str] = []
    seen: set[str] = set()
    for selector in selectors:
        locator = page.locator(selector)
        for index in range(min(locator.count(), limit * 4)):
            href = locator.nth(index).get_attribute("href")
            if not href:
                continue
            url = canonical_job_url(urljoin("https://www.upwork.com", href))
            if not url or url in seen:
                continue
            seen.add(url)
            values.append(url)
            if len(values) >= limit:
                return values
    return values


def extract_job_evidence(page: Any, segment: str) -> SourceEvidence:
    url = canonical_job_url(page.url) or page.url
    title = _first_visible_text(
        page,
        (
            'h1',
            '[data-test="job-title"]',
            '[data-cy="job-title"]',
        ),
    )
    main_text = _first_visible_text(
        page,
        (
            'main',
            '[data-test="job-details"]',
            'article',
            'body',
        ),
        max_chars=20_000,
    )
    description = _first_visible_text(
        page,
        (
            '[data-test="Description"]',
            '[data-test="job-description-text"]',
            '[data-test="job-description"]',
            '[data-cy="job-description"]',
        ),
        max_chars=10_000,
    )
    if not description:
        description = _description_from_main(main_text)
    attributes = parse_upwork_metrics(main_text)
    attributes["skills"] = extract_skills(page)
    attributes["captured_from"] = "authenticated_job_detail"
    attributes["pilot_schema_version"] = "upwork-pilot-evidence.v1"
    evidence = SourceEvidence(
        source="upwork",
        source_id=external_job_id(url),
        source_url=url,
        captured_at=utc_now_iso(),
        title=title or "Untitled Upwork opportunity",
        body=description,
        segment=segment,
        attributes=attributes,
    )
    evidence.validate()
    return evidence


def parse_upwork_metrics(text: str) -> dict[str, Any]:
    clean = " ".join(text.split())
    fixed = _first_money(
        clean,
        (
            r"Fixed(?:-price)?[^$]{0,60}\$([\d,]+(?:\.\d+)?)",
            r"Budget[^$]{0,40}\$([\d,]+(?:\.\d+)?)",
        ),
    )
    hourly = re.search(r"\$([\d,.]+)\s*-\s*\$([\d,.]+)\s*/?\s*(?:hr|hour)", clean, re.I)
    spend = re.search(r"\$([\d,.]+)\s*([kKmM]?)\+?\s*spent", clean, re.I)
    hire_rate = re.search(r"(\d{1,3})%\s*hire rate", clean, re.I)
    proposals = re.search(r"(?:proposals?|applicants?)\s*:?\s*(Less than\s+\d+|\d+\s*to\s*\d+|\d+\+?)", clean, re.I)
    posted = re.search(r"Posted\s+([^|]{1,50}?\s+ago)", clean, re.I)
    duration = re.search(
        r"(Less than 1 month|1 to 3 months|3 to 6 months|More than 6 months)",
        clean,
        re.I,
    )
    experience = re.search(r"\b(Entry Level|Intermediate|Expert)\b", clean, re.I)
    country = _country(clean)
    budget = fixed or (float(hourly.group(2).replace(",", "")) * 160 if hourly else None)
    return {
        "budget_usd": budget,
        "fixed_budget_usd": fixed,
        "hourly_min_usd": float(hourly.group(1).replace(",", "")) if hourly else None,
        "hourly_max_usd": float(hourly.group(2).replace(",", "")) if hourly else None,
        "payment_verified": bool(re.search(r"payment (?:method )?verified", clean, re.I)),
        "client_spend_usd": _scaled_money(spend.group(1), spend.group(2)) if spend else None,
        "client_hire_rate": float(hire_rate.group(1)) if hire_rate else None,
        "proposal_activity": proposals.group(1) if proposals else None,
        "posted_age": posted.group(1) if posted else None,
        "duration": duration.group(1) if duration else None,
        "experience_level": experience.group(1) if experience else None,
        "client_country": country,
        "local_presence_required": bool(re.search(r"\b(on[- ]?site|must be located in|local candidates? only)\b", clean, re.I)),
        "delivery_country": country if re.search(r"\b(on[- ]?site|must be located in|local candidates? only)\b", clean, re.I) else "",
    }


def extract_skills(page: Any) -> list[str]:
    selectors = (
        '[data-test="Skill"]',
        '[data-test="TokenClamp"] a',
        'a[href*="ontology_skill"]',
        'button[data-test*="skill"]',
    )
    values: list[str] = []
    seen: set[str] = set()
    for selector in selectors:
        locator = page.locator(selector)
        for index in range(min(locator.count(), 40)):
            try:
                text = " ".join(locator.nth(index).inner_text().split())
            except Exception:
                continue
            key = text.casefold()
            if text and 1 < len(text) <= 80 and key not in seen:
                seen.add(key)
                values.append(text)
    return values[:25]


def canonical_job_url(url: str) -> str | None:
    parsed = urlparse(url)
    if parsed.hostname not in {"upwork.com", "www.upwork.com"}:
        return None
    if "/jobs/" not in parsed.path and "/freelance-jobs/apply/" not in parsed.path:
        return None
    return f"https://www.upwork.com{parsed.path}"


def external_job_id(url: str) -> str:
    match = re.search(r"(~[A-Za-z0-9_-]+)", url)
    if match:
        return match.group(1)
    return hashlib.sha256(url.encode("utf-8")).hexdigest()[:24]


def write_pilot_outputs(
    *,
    output_directory: Path,
    summary: PilotSummary,
    items: list[PilotItem],
    config_version: str,
) -> None:
    from .reporting import write_csv_report, write_html_report

    output_directory.mkdir(parents=True, exist_ok=True)
    payload = {
        "schema_version": "upwork-dry-run-report.v1",
        "config_version": config_version,
        "summary": summary.to_dict(),
        "items": [item.to_dict() for item in items],
        "dashboard_ingestion": {
            "enabled": False,
            "reason": "Dry-run review approval is required before dashboard ingestion.",
        },
    }
    (output_directory / "opportunities.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True),
        encoding="utf-8",
    )
    (output_directory / "run-summary.json").write_text(
        json.dumps(summary.to_dict(), indent=2, sort_keys=True),
        encoding="utf-8",
    )
    write_csv_report(output_directory / "opportunities.csv", items)
    ready_path = output_directory / "dashboard-ready.jsonl"
    with ready_path.open("w", encoding="utf-8") as handle:
        for item in items:
            if item.qualification.disposition not in {"qualified", "contact_ready", "proposal_ready"}:
                continue
            handle.write(json.dumps(item.to_dict(), ensure_ascii=False, sort_keys=True))
            handle.write("\n")
    write_html_report(output_directory / "report.html", summary, items)


def _assert_upwork_session(page: Any) -> None:
    parsed = urlparse(page.url)
    path = parsed.path.lower()
    if parsed.hostname not in {"upwork.com", "www.upwork.com"}:
        raise HumanActionRequired("Upwork redirected outside the expected domain.")
    if any(value in path for value in ("/login", "/account-security", "/identity-verification", "/captcha")):
        raise HumanActionRequired("Upwork requires login or account verification in the open browser.")
    body = ""
    try:
        body = page.locator("body").inner_text(timeout=5_000).lower()
    except Exception:
        pass
    if any(value in body for value in ("verify your identity", "unusual activity", "complete the security check")):
        raise HumanActionRequired("Upwork requires a human security action in the open browser.")


def _settle(page: Any) -> None:
    page.mouse.wheel(0, 1200)
    page.wait_for_timeout(1_000)
    page.mouse.wheel(0, -500)
    page.wait_for_timeout(500)


def _first_visible_text(page: Any, selectors: tuple[str, ...], max_chars: int = 12_000) -> str:
    for selector in selectors:
        locator = page.locator(selector)
        for index in range(min(locator.count(), 5)):
            node = locator.nth(index)
            try:
                if node.is_visible(timeout=500):
                    text = " ".join(node.inner_text(timeout=3_000).split())
                    if text:
                        return text[:max_chars]
            except Exception:
                continue
    return ""


def _description_from_main(text: str) -> str:
    if not text:
        return ""
    markers = ("Job description", "About the job", "Summary")
    for marker in markers:
        index = text.lower().find(marker.lower())
        if index >= 0:
            return text[index + len(marker):][:10_000].strip()
    return text[:10_000]


def _first_money(text: str, patterns: tuple[str, ...]) -> float | None:
    for pattern in patterns:
        match = re.search(pattern, text, re.I)
        if match:
            return float(match.group(1).replace(",", ""))
    return None


def _scaled_money(value: str, suffix: str) -> float:
    amount = float(value.replace(",", ""))
    if suffix.casefold() == "k":
        return amount * 1_000
    if suffix.casefold() == "m":
        return amount * 1_000_000
    return amount


def _country(text: str) -> str | None:
    countries = (
        "United States", "United Kingdom", "Canada", "Australia", "Germany",
        "France", "Netherlands", "United Arab Emirates", "UAE", "Saudi Arabia",
        "Pakistan", "India", "Singapore", "Ireland", "Sweden", "Norway",
    )
    for country in countries:
        if re.search(rf"\b{re.escape(country)}\b", text, re.I):
            return country
    return None


def _dedupe_key(evidence: SourceEvidence) -> str:
    value = f"{evidence.source}|{evidence.source_id}|{evidence.source_url}"
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _load_seen(path: Path) -> set[str]:
    if not path.exists():
        return set()
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return set()
    return {str(item) for item in value.get("seen_source_ids", [])} if isinstance(value, dict) else set()


def _save_seen(path: Path, seen: set[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(
        json.dumps({"seen_source_ids": sorted(seen)}, indent=2, sort_keys=True),
        encoding="utf-8",
    )
    temp.replace(path)


def _required(value: dict[str, object], key: str) -> str:
    text = str(value.get(key, "")).strip()
    if not text:
        raise ValueError(f"{key} is required")
    return text
