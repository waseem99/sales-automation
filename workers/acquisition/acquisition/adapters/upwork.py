from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import re
import time
import tomllib
from typing import Iterable
from urllib.parse import urljoin, urlsplit

from ..browser import persistent_chromium
from ..models import SourceEvidence, utc_now_iso


class HumanActionRequired(RuntimeError):
    pass


@dataclass(frozen=True, slots=True)
class UpworkSavedSearch:
    id: str
    segment: str
    url: str
    enabled: bool
    max_items: int


@dataclass(frozen=True, slots=True)
class UpworkSearchConfig:
    searches: tuple[UpworkSavedSearch, ...]
    scroll_rounds: int
    navigation_timeout_ms: int


def load_upwork_search_config(path: Path) -> UpworkSearchConfig:
    with path.open("rb") as handle:
        raw = tomllib.load(handle)
    settings = raw.get("upwork", {})
    searches = tuple(
        UpworkSavedSearch(
            id=_required(item, "id"),
            segment=_required(item, "segment"),
            url=_validated_url(_required(item, "url")),
            enabled=bool(item.get("enabled", True)),
            max_items=max(1, int(item.get("max_items", 25))),
        )
        for item in raw.get("searches", [])
    )
    if not searches:
        raise ValueError("At least one Upwork saved search is required")
    return UpworkSearchConfig(
        searches=searches,
        scroll_rounds=max(0, min(10, int(settings.get("scroll_rounds", 2)))),
        navigation_timeout_ms=max(5_000, int(settings.get("navigation_timeout_ms", 45_000))),
    )


class UpworkSavedSearchAdapter:
    adapter_id = "upwork-saved-search"

    def __init__(
        self,
        *,
        profile_path: Path,
        search_config: UpworkSearchConfig,
        request_delay_seconds: float = 2.5,
        headless: bool = False,
    ) -> None:
        self.profile_path = profile_path
        self.search_config = search_config
        self.request_delay_seconds = max(1.0, request_delay_seconds)
        self.headless = headless

    def collect(self, *, limit: int, enabled_segments: set[str]) -> Iterable[SourceEvidence]:
        emitted = 0
        with persistent_chromium(self.profile_path, headless=self.headless) as context:
            page = context.pages[0] if context.pages else context.new_page()
            page.set_default_timeout(self.search_config.navigation_timeout_ms)
            for search in self.search_config.searches:
                if not search.enabled or search.segment not in enabled_segments:
                    continue
                page.goto(search.url, wait_until="domcontentloaded")
                time.sleep(self.request_delay_seconds)
                _raise_if_human_action_required(page.url, page.locator("body").inner_text(timeout=10_000))
                for _ in range(self.search_config.scroll_rounds):
                    page.mouse.wheel(0, 1400)
                    time.sleep(self.request_delay_seconds)
                payloads = _extract_card_payloads(page)
                search_count = 0
                for payload in payloads:
                    if emitted >= limit or search_count >= search.max_items:
                        return
                    evidence = parse_upwork_card_payload(payload, search)
                    if evidence is None:
                        continue
                    emitted += 1
                    search_count += 1
                    yield evidence
                time.sleep(self.request_delay_seconds)


def parse_upwork_card_payload(payload: dict[str, object], search: UpworkSavedSearch) -> SourceEvidence | None:
    title = _clean(payload.get("title"))
    body = _clean(payload.get("description"))
    source_url = _clean(payload.get("url"))
    source_id = _clean(payload.get("source_id")) or _source_id_from_url(source_url)
    if not title or not body or not source_url or not source_id:
        return None
    metadata = " ".join([
        _clean(payload.get("metadata")),
        _clean(payload.get("budget")),
        _clean(payload.get("client")),
    ])
    fixed_budget, hourly_min, hourly_max = _parse_budget(metadata)
    return SourceEvidence(
        source="upwork",
        source_id=source_id,
        source_url=urljoin("https://www.upwork.com", source_url),
        captured_at=utc_now_iso(),
        title=title,
        body=body,
        segment=search.segment,
        attributes={
            "search_id": search.id,
            "budget_usd": fixed_budget,
            "hourly_min_usd": hourly_min,
            "hourly_max_usd": hourly_max,
            "client_spend_usd": _parse_spend(metadata),
            "client_hire_rate": _parse_percent(metadata, "hire rate"),
            "payment_verified": bool(re.search(r"payment\s+verified", metadata, re.I)),
            "proposal_count": _parse_proposals(metadata),
            "posted_text": _extract_posted_text(metadata),
            "skills": tuple(_clean_list(payload.get("skills"))),
            "engagement_type": _engagement_type(metadata),
        },
    )


def is_human_action_required(url: str, page_text: str) -> bool:
    combined = f"{url} {page_text}".lower()
    signals = (
        "verify you are human",
        "security check",
        "unusual activity",
        "captcha",
        "account verification",
        "log in to upwork",
        "sign in to upwork",
    )
    return any(signal in combined for signal in signals)


def _raise_if_human_action_required(url: str, page_text: str) -> None:
    if is_human_action_required(url, page_text):
        raise HumanActionRequired(
            "Upwork requires manual login or verification. Complete it in the authorized Chromium profile, then rerun."
        )


def _extract_card_payloads(page: object) -> list[dict[str, object]]:
    script = r"""
    () => {
      const cards = Array.from(document.querySelectorAll([
        '[data-test="job-tile-list"] section',
        'article[data-test="JobTile"]',
        'section[data-ev-label="search_result_impression"]',
        'article[data-ev-job-uid]'
      ].join(',')));
      const text = (node, selectors) => {
        for (const selector of selectors) {
          const found = node.querySelector(selector);
          if (found?.textContent?.trim()) return found.textContent.trim();
        }
        return '';
      };
      const attr = (node, selectors, name) => {
        for (const selector of selectors) {
          const found = node.querySelector(selector);
          const value = found?.getAttribute(name);
          if (value) return value;
        }
        return '';
      };
      return cards.map((card) => ({
        source_id: card.getAttribute('data-ev-job-uid') || card.getAttribute('data-test-key') || '',
        url: attr(card, ['a[data-test="job-tile-title-link"]', '[data-test="job-tile-title-link"]', 'h2 a', 'h3 a'], 'href'),
        title: text(card, ['[data-test="job-tile-title-link"]', 'h2', 'h3']),
        description: text(card, ['[data-test="job-description-text"]', '[data-test="job-tile-description"]', 'p']),
        budget: text(card, ['[data-test="job-type-label"]', '[data-test="budget"]']),
        client: text(card, ['[data-test="client-info"]', '[data-test="client-spend"]']),
        metadata: card.innerText || '',
        skills: Array.from(card.querySelectorAll('[data-test="token"], [data-test="skill"]')).map((node) => node.textContent?.trim()).filter(Boolean),
      }));
    }
    """
    values = page.evaluate(script)
    return [item for item in values if isinstance(item, dict)] if isinstance(values, list) else []


def _parse_budget(text: str) -> tuple[float | None, float | None, float | None]:
    hourly = re.search(r"\$([\d,.]+)\s*-\s*\$([\d,.]+)\s*/?\s*hr", text, re.I)
    if hourly:
        return None, _amount(hourly.group(1)), _amount(hourly.group(2))
    fixed_patterns = (
        r"(?:fixed(?:-price)?|budget)\s*:?\s*\$([\d,.]+[kKmM]?)",
        r"\$([\d,.]+[kKmM]?)\s+fixed",
    )
    for pattern in fixed_patterns:
        match = re.search(pattern, text, re.I)
        if match:
            return _amount(match.group(1)), None, None
    return None, None, None


def _parse_spend(text: str) -> float | None:
    match = re.search(r"\$([\d,.]+\s*[kKmM]?)\+?\s+spent", text, re.I)
    return _amount(match.group(1)) if match else None


def _parse_percent(text: str, label: str) -> float | None:
    match = re.search(rf"(\d{{1,3}}(?:\.\d+)?)%\s+{re.escape(label)}", text, re.I)
    return float(match.group(1)) if match else None


def _parse_proposals(text: str) -> str | None:
    match = re.search(r"proposals?\s*:?\s*([\w\s-]{1,24})", text, re.I)
    return " ".join(match.group(1).split()) if match else None


def _extract_posted_text(text: str) -> str | None:
    match = re.search(r"posted\s+([^\n|]{1,40})", text, re.I)
    return " ".join(match.group(1).split()) if match else None


def _engagement_type(text: str) -> str:
    if re.search(r"hourly", text, re.I):
        return "hourly"
    if re.search(r"fixed(?:-price)?", text, re.I):
        return "fixed"
    return "unknown"


def _amount(value: str) -> float:
    normalized = value.replace(",", "").replace(" ", "").lower()
    multiplier = 1.0
    if normalized.endswith("k"):
        multiplier = 1_000.0
        normalized = normalized[:-1]
    elif normalized.endswith("m"):
        multiplier = 1_000_000.0
        normalized = normalized[:-1]
    return float(normalized) * multiplier


def _source_id_from_url(value: str) -> str:
    match = re.search(r"(~[A-Za-z0-9]+)", value)
    if match:
        return match.group(1)
    path = urlsplit(value).path.rstrip("/")
    return path.rsplit("/", 1)[-1] if path else ""


def _clean(value: object) -> str:
    return " ".join(str(value or "").split())


def _clean_list(value: object) -> list[str]:
    if not isinstance(value, (list, tuple)):
        return []
    return [_clean(item) for item in value if _clean(item)]


def _required(value: dict[str, object], key: str) -> str:
    text = _clean(value.get(key))
    if not text:
        raise ValueError(f"{key} is required")
    return text


def _validated_url(value: str) -> str:
    parts = urlsplit(value)
    if parts.scheme != "https" or not parts.netloc.endswith("upwork.com"):
        raise ValueError("Upwork saved-search URL must use https://*.upwork.com")
    return value
