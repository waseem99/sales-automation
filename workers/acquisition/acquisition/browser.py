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
        from playwright.sync_api import Error as PlaywrightError
        from playwright.sync_api import sync_playwright
    except ImportError as error:
        raise BrowserDependencyError(
            'Playwright is not installed. Run: pip install -e ".[browser]" && playwright install chromium'
        ) from error

    profile_path.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as playwright:
        context = None
        failures: list[str] = []
        # Prefer a normal installed browser for authenticated account sessions.
        # Fall back only when Chrome/Edge is unavailable on the worker machine.
        for channel in ("chrome", "msedge", None):
            try:
                options: dict[str, object] = {
                    "user_data_dir": str(profile_path),
                    "headless": headless,
                    "viewport": {"width": 1440, "height": 1000},
                }
                if channel is not None:
                    options["channel"] = channel
                context = playwright.chromium.launch_persistent_context(**options)
                break
            except PlaywrightError as error:
                label = channel or "bundled-chromium"
                failures.append(f"{label}:{error.__class__.__name__}")

        if context is None:
            raise BrowserDependencyError(
                "Could not launch Chrome, Edge, or bundled Chromium (" + ", ".join(failures) + ")"
            )

        try:
            yield context
        finally:
            context.close()


def bootstrap_authorized_profile(profile_path: Path, url: str) -> None:
    with persistent_chromium(profile_path, headless=False) as context:
        page = context.pages[0] if context.pages else context.new_page()
        page.goto(url, wait_until="domcontentloaded", timeout=60_000)
        print("Complete any required login or verification in the official browser window.")
        input("Press Enter after the authorized session is ready and the target page is visible... ")
