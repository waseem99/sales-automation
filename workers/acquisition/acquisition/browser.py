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
def persistent_chromium(
    profile_path: Path,
    *,
    headless: bool = False,
    installed_only: bool = False,
) -> Iterator[object]:
    try:
        from playwright.sync_api import Error as PlaywrightError
        from playwright.sync_api import sync_playwright
    except ImportError as error:
        raise BrowserDependencyError(
            'Playwright is not installed. Run: pip install -e ".[browser]"'
        ) from error

    profile_path.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as playwright:
        context = None
        failures: list[str] = []
        # Use a normal installed browser for authenticated account sessions. The
        # scheduled Upwork worker sets installed_only=True so it never falls back
        # to a bundled browser with a different profile/runtime signature.
        channels: tuple[str | None, ...] = ("chrome", "msedge") if installed_only else ("chrome", "msedge", None)
        for channel in channels:
            try:
                options: dict[str, object] = {
                    "user_data_dir": str(profile_path),
                    "headless": headless,
                    "viewport": {"width": 1440, "height": 1000},
                    "no_viewport": False,
                    # Playwright includes --no-sandbox in its Chromium defaults.
                    # This Windows workstation does not require that exception;
                    # retain Chrome's normal sandbox and remove the warning bar.
                    "ignore_default_args": ["--no-sandbox"],
                }
                if channel is not None:
                    options["channel"] = channel
                context = playwright.chromium.launch_persistent_context(**options)
                break
            except PlaywrightError as error:
                label = channel or "bundled-chromium"
                failures.append(f"{label}:{error.__class__.__name__}")

        if context is None:
            scope = "installed Chrome or Edge" if installed_only else "Chrome, Edge, or bundled Chromium"
            raise BrowserDependencyError(
                f"Could not launch {scope} (" + ", ".join(failures) + ")"
            )

        try:
            yield context
        finally:
            context.close()


def bootstrap_authorized_profile(profile_path: Path, url: str) -> None:
    with persistent_chromium(profile_path, headless=False, installed_only=True) as context:
        page = context.pages[0] if context.pages else context.new_page()
        page.goto(url, wait_until="domcontentloaded", timeout=60_000)
        print("Complete any required login or verification in the official browser window.")
        input("Press Enter after the authorized session is ready and the target page is visible... ")
