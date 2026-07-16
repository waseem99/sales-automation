from __future__ import annotations

from contextlib import contextmanager
from pathlib import Path
from typing import Iterator


class BrowserDependencyError(RuntimeError):
    pass


def validate_external_profile_path(profile_path: Path, repository_root: Path) -> Path:
    resolved = profile_path.expanduser().resolve()
    repo = repository_root.resolve()
    if resolved == repo or repo in resolved.parents:
        raise ValueError("Browser profile must be stored outside the repository")
    return resolved


@contextmanager
def persistent_chromium(profile_path: Path, *, headless: bool = False) -> Iterator[object]:
    try:
        from playwright.sync_api import sync_playwright
    except ImportError as error:
        raise BrowserDependencyError(
            'Playwright is not installed. Run: pip install -e ".[browser]" && playwright install chromium'
        ) from error
    profile_path.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as playwright:
        context = playwright.chromium.launch_persistent_context(
            user_data_dir=str(profile_path),
            headless=headless,
            viewport={"width": 1440, "height": 1000},
        )
        try:
            yield context
        finally:
            context.close()


def bootstrap_authorized_profile(profile_path: Path, url: str) -> None:
    with persistent_chromium(profile_path, headless=False) as context:
        page = context.pages[0] if context.pages else context.new_page()
        page.goto(url, wait_until="domcontentloaded")
        print("Complete any required login or verification in Chromium.")
        input("Press Enter after the authorized session is ready and the target page is visible... ")
