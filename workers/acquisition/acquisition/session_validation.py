from __future__ import annotations

from dataclasses import asdict, dataclass
from pathlib import Path
from urllib.parse import urlparse

from .browser import persistent_chromium


@dataclass(frozen=True, slots=True)
class SessionCheck:
    account: str
    authenticated: bool
    challenge_detected: bool
    host: str
    path: str
    markers_found: tuple[str, ...]
    reason: str

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


_ACCOUNT_RULES: dict[str, dict[str, object]] = {
    "upwork": {
        "url": "https://www.upwork.com/nx/find-work/",
        "allowed_hosts": ("upwork.com", "www.upwork.com"),
        "blocked_paths": ("/ab/account-security/login", "/login", "/signup"),
        "challenge_paths": ("/ab/account-security", "/identity-verification", "/captcha"),
        "markers": ("Find work", "My jobs", "Messages", "Talent"),
    },
    "linkedin": {
        "url": "https://www.linkedin.com/sales/home",
        "allowed_hosts": ("linkedin.com", "www.linkedin.com"),
        "blocked_paths": ("/login", "/uas/login"),
        "challenge_paths": ("/checkpoint", "/challenge"),
        "markers": ("Sales Navigator", "Home", "Accounts", "Leads"),
    },
}


def validate_session(profile_path: Path, account: str) -> SessionCheck:
    account_key = account.strip().lower()
    if account_key not in _ACCOUNT_RULES:
        raise ValueError(f"Unsupported account: {account}")
    rules = _ACCOUNT_RULES[account_key]

    with persistent_chromium(profile_path, headless=False) as context:
        page = context.pages[0] if context.pages else context.new_page()
        page.goto(str(rules["url"]), wait_until="domcontentloaded", timeout=60_000)
        page.wait_for_timeout(3_000)

        parsed = urlparse(page.url)
        host = parsed.hostname or ""
        path = parsed.path or "/"
        blocked_paths = tuple(str(item) for item in rules["blocked_paths"])
        challenge_paths = tuple(str(item) for item in rules["challenge_paths"])
        allowed_hosts = tuple(str(item) for item in rules["allowed_hosts"])
        marker_candidates = tuple(str(item) for item in rules["markers"])

        challenge = any(fragment in path.lower() for fragment in challenge_paths)
        blocked = any(fragment in path.lower() for fragment in blocked_paths)
        host_allowed = host.lower() in allowed_hosts or any(host.lower().endswith(f".{item}") for item in allowed_hosts)

        found: list[str] = []
        body = page.locator("body")
        for marker in marker_candidates:
            try:
                if body.get_by_text(marker, exact=False).first.is_visible(timeout=1_000):
                    found.append(marker)
            except Exception:
                continue

        authenticated = host_allowed and not blocked and not challenge and bool(found)
        if challenge:
            reason = "Account verification or security challenge is visible. Complete it manually and retry."
        elif blocked:
            reason = "The saved profile returned to a login page. Reconnect the account and retry."
        elif not host_allowed:
            reason = "The browser was redirected outside the expected account domain."
        elif not found:
            reason = "The account domain opened, but authenticated navigation markers were not detected."
        else:
            reason = "Authorized session confirmed using non-sensitive page markers."

        return SessionCheck(
            account=account_key,
            authenticated=authenticated,
            challenge_detected=challenge,
            host=host,
            path=path,
            markers_found=tuple(found),
            reason=reason,
        )
