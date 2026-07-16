from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable
from urllib.parse import urljoin

from acquisition_worker.browser import page_requires_human_action
from acquisition_worker.models import Opportunity


class HumanActionRequired(RuntimeError):
    pass


@dataclass(frozen=True, slots=True)
class UpworkSearchDefinition:
    id: str
    url: str
    service_hint: str
    business_unit_hint: str
    keywords: tuple[str, ...]
    exclusions: tuple[str, ...]
    min_fixed_budget: float
    min_hourly_rate: float
    max_pages: int
    delay_seconds: float


@dataclass(frozen=True, slots=True)
class UpworkCardSnapshot:
    external_id: str | None
    source_url: str | None
    title: str
    description: str
    card_text: str
    skills: tuple[str, ...] = ()


def load_upwork_searches(path: str | Path, selected_ids: set[str] | None = None) -> list[UpworkSearchDefinition]:
    value = json.loads(Path(path).read_text(encoding="utf-8"))
    searches = value.get("searches") if isinstance(value, dict) else None
    if not isinstance(searches, list):
        raise ValueError("Upwork config must contain a searches array")
    definitions: list[UpworkSearchDefinition] = []
    for item in searches:
        if not isinstance(item, dict):
            raise ValueError("each Upwork search must be an object")
        search_id = _required(item, "id")
        if selected_ids and search_id not in selected_ids:
            continue
        url = _required(item, "url")
        if not url.startswith("https://www.upwork.com/"):
            raise ValueError(f"search {search_id} must use an https://www.upwork.com URL")
        definitions.append(
            UpworkSearchDefinition(
                id=search_id,
                url=url,
                service_hint=str(item.get("service_hint") or "unknown"),
                business_unit_hint=str(item.get("business_unit_hint") or "codistan"),
                keywords=tuple(_string_list(item.get("keywords"))),
                exclusions=tuple(_string_list(item.get("exclusions"))),
                min_fixed_budget=float(item.get("min_fixed_budget") or 0),
                min_hourly_rate=float(item.get("min_hourly_rate") or 0),
                max_pages=max(1, min(int(item.get("max_pages") or 1), 5)),
                delay_seconds=max(2.0, float(item.get("delay_seconds") or 3.0)),
            )
        )
    if not definitions:
        raise ValueError("no Upwork searches were selected")
    return definitions


class UpworkSavedSearchAdapter:
    def __init__(self, browser_context: Any, searches: Iterable[UpworkSearchDefinition]) -> None:
        self.browser_context = browser_context
        self.searches = list(searches)

    def collect(self) -> list[Opportunity]:
        values: list[Opportunity] = []
        page = self.browser_context.new_page()
        try:
            for search in self.searches:
                page.goto(search.url, wait_until="domcontentloaded")
                page.wait_for_timeout(int(search.delay_seconds * 1_000))
                for page_number in range(search.max_pages):
                    if page_requires_human_action(page):
                        raise HumanActionRequired(
                            "Upwork requires human account or verification action in the open browser."
                        )
                    _settle_lazy_content(page)
                    for snapshot in _extract_snapshots(page):
                        values.append(snapshot_to_opportunity(snapshot, search))
                    if page_number + 1 >= search.max_pages or not _go_to_next_page(page):
                        break
                    page.wait_for_timeout(int(search.delay_seconds * 1_000))
        finally:
            page.close()
        return values


def snapshot_to_opportunity(snapshot: UpworkCardSnapshot, search: UpworkSearchDefinition) -> Opportunity:
    metrics = parse_upwork_card_metrics(snapshot.card_text)
    return Opportunity(
        source="upwork",
        title=snapshot.title,
        description=snapshot.description,
        search_segment=search.id,
        source_url=snapshot.source_url,
        external_id=snapshot.external_id,
        budget_signal=metrics.get("budget_label"),
        country=metrics.get("country"),
        metadata={
            "adapter": "upwork_saved_search",
            "service_hint": search.service_hint,
            "business_unit_hint": search.business_unit_hint,
            "keywords": list(search.keywords),
            "exclusions": list(search.exclusions),
            "min_fixed_budget": search.min_fixed_budget,
            "min_hourly_rate": search.min_hourly_rate,
            "skills": list(snapshot.skills),
            **metrics,
        },
    )


def parse_upwork_card_metrics(card_text: str) -> dict[str, Any]:
    text = " ".join(card_text.split())
    fixed = _first_money(text, (r"Fixed(?:-price)?[^$]{0,30}\$([\d,]+(?:\.\d+)?)", r"Budget[^$]{0,20}\$([\d,]+(?:\.\d+)?)"))
    hourly = re.search(r"\$([\d,.]+)\s*-\s*\$([\d,.]+)\s*/?\s*hr", text, re.I)
    spend = re.search(r"\$([\d,.]+)\s*([kKmM]?)\+?\s*spent", text, re.I)
    hire_rate = re.search(r"(\d{1,3})%\s*hire rate", text, re.I)
    proposals = re.search(r"(?:proposals?|applicants?)\s*:\s*(?:less than\s*)?(\d+)", text, re.I)
    country_match = re.search(
        r"\b(United States|United Kingdom|Canada|Australia|Germany|France|Netherlands|UAE|Saudi Arabia|Pakistan|India)\b",
        text,
        re.I,
    )
    budget_label = None
    if fixed:
        budget_label = f"${fixed:,.0f} fixed"
    elif hourly:
        budget_label = f"${float(hourly.group(1).replace(',', '')):g}-${float(hourly.group(2).replace(',', '')):g} hourly"
    return {
        "payment_verified": bool(re.search(r"payment verified", text, re.I)),
        "client_spend_usd": _scaled_money(spend.group(1), spend.group(2)) if spend else 0,
        "hire_rate_percent": float(hire_rate.group(1)) if hire_rate else 0,
        "proposal_count": int(proposals.group(1)) if proposals else 0,
        "fixed_budget_usd": fixed,
        "hourly_min_usd": float(hourly.group(1).replace(",", "")) if hourly else 0,
        "hourly_max_usd": float(hourly.group(2).replace(",", "")) if hourly else 0,
        "budget_label": budget_label,
        "country": country_match.group(1) if country_match else None,
        "raw_evidence_excerpt": text[:4_000],
    }


def _extract_snapshots(page: Any) -> list[UpworkCardSnapshot]:
    cards = _first_locator(
        page,
        (
            'article[data-test="JobTile"]',
            'section[data-test="job-tile"]',
            'article.job-tile',
            '[data-test="job-tile-list"] article',
        ),
    )
    values: list[UpworkCardSnapshot] = []
    if cards is None:
        return values
    for index in range(cards.count()):
        card = cards.nth(index)
        title_link = _first_locator(
            card,
            (
                'a[data-test="job-tile-title-link"]',
                'a[href*="/jobs/"]',
                "h2 a",
                "h3 a",
            ),
        )
        if title_link is None or title_link.count() == 0:
            continue
        title = (title_link.first.inner_text() or "").strip()
        href = title_link.first.get_attribute("href")
        source_url = urljoin("https://www.upwork.com", href) if href else None
        description_node = _first_locator(
            card,
            (
                '[data-test="UpCLineClamp JobDescription"]',
                '[data-test="job-description"]',
                "p",
            ),
        )
        description = (
            (description_node.first.inner_text() or "").strip()
            if description_node is not None and description_node.count() > 0
            else ""
        )
        card_text = (card.inner_text() or "").strip()
        skills = tuple(
            value.strip()
            for value in re.findall(r"(?:Python|React Native|React|Next\.js|Node\.js|OpenAI|n8n|Unity|Unreal|SEO|SOC 2|ISO 27001)", card_text, re.I)
            if value.strip()
        )
        if not title or not description:
            continue
        values.append(
            UpworkCardSnapshot(
                external_id=_external_id(source_url),
                source_url=source_url,
                title=title,
                description=description,
                card_text=card_text,
                skills=skills,
            )
        )
    return values


def _first_locator(parent: Any, selectors: tuple[str, ...]) -> Any | None:
    for selector in selectors:
        locator = parent.locator(selector)
        if locator.count() > 0:
            return locator
    return None


def _settle_lazy_content(page: Any) -> None:
    page.mouse.wheel(0, 1_200)
    page.wait_for_timeout(1_000)
    page.mouse.wheel(0, -400)
    page.wait_for_timeout(500)


def _go_to_next_page(page: Any) -> bool:
    locator = _first_locator(
        page,
        (
            'button[aria-label="Next"]',
            'a[aria-label="Next"]',
            '[data-test="pagination-next"]',
        ),
    )
    if locator is None or locator.count() == 0:
        return False
    button = locator.first
    if button.is_disabled() or button.get_attribute("aria-disabled") == "true":
        return False
    button.click()
    page.wait_for_load_state("domcontentloaded")
    return True


def _first_money(text: str, patterns: tuple[str, ...]) -> float:
    for pattern in patterns:
        match = re.search(pattern, text, re.I)
        if match:
            return float(match.group(1).replace(",", ""))
    return 0.0


def _scaled_money(value: str, suffix: str) -> float:
    amount = float(value.replace(",", ""))
    if suffix.casefold() == "k":
        return amount * 1_000
    if suffix.casefold() == "m":
        return amount * 1_000_000
    return amount


def _external_id(url: str | None) -> str | None:
    if not url:
        return None
    match = re.search(r"/jobs/(~?[A-Za-z0-9_-]+)", url)
    return match.group(1) if match else None


def _required(item: dict[str, Any], key: str) -> str:
    value = item.get(key)
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"Upwork search {key} is required")
    return value.strip()


def _string_list(value: Any) -> list[str]:
    if value is None:
        return []
    if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
        raise ValueError("Upwork keywords and exclusions must be string arrays")
    return [item.strip() for item in value if item.strip()]
