from __future__ import annotations

import re
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator


_CHALLENGE_PATTERN = re.compile(
    r"(verify your identity|security check|captcha|two-step verification|unusual activity|account restricted)",
    re.IGNORECASE,
)


def ensure_external_profile_path(path: str | Path) -> Path:
    target = Path(path).expanduser().resolve()
    repository_agents = Path(__file__).resolve().parents[1]
    if target == repository_agents or repository_agents in target.parents:
        raise ValueError("browser profiles must be stored outside the repository")
    target.mkdir(parents=True, exist_ok=True)
    return target


@contextmanager
def persistent_browser(
    profile_path: str | Path,
    *,
    headless: bool = False,
    slow_mo_ms: int = 150,
) -> Iterator[object]:
    try:
        from playwright.sync_api import sync_playwright
    except ImportError as error:
        raise RuntimeError("Playwright is not installed. Run `python -m pip install -e .`.") from error
    target = ensure_external_profile_path(profile_path)
    with sync_playwright() as playwright:
        context = playwright.chromium.launch_persistent_context(
            user_data_dir=str(target),
            headless=headless,
            slow_mo=max(0, slow_mo_ms),
            viewport={"width": 1440, "height": 1000},
        )
        try:
            yield context
        finally:
            context.close()


def page_requires_human_action(page: object) -> bool:
    url = str(getattr(page, "url", ""))
    title = ""
    body_text = ""
    try:
        title = str(page.title())
    except Exception:
        pass
    try:
        body_text = str(page.locator("body").inner_text(timeout=2_000))[:8_000]
    except Exception:
        pass
    return bool(_CHALLENGE_PATTERN.search(" ".join([url, title, body_text])))
