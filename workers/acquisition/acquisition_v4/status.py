from __future__ import annotations

import argparse
import json
from urllib.error import URLError
from urllib.request import urlopen

DEFAULT_ENDPOINTS = {
    "upwork": "http://127.0.0.1:8765/health",
    "linkedin": "http://127.0.0.1:8775/health",
}


def read_health(url: str) -> dict[str, object]:
    with urlopen(url, timeout=3) as response:  # noqa: S310 - localhost-only CLI
        value = json.loads(response.read().decode("utf-8"))
    if not isinstance(value, dict):
        raise ValueError("Health response was not an object.")
    return value


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Check both Codistan acquisition collectors.")
    parser.add_argument("--json", action="store_true", dest="as_json")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    results: dict[str, dict[str, object]] = {}
    healthy = True
    for source, url in DEFAULT_ENDPOINTS.items():
        try:
            results[source] = read_health(url)
        except (URLError, TimeoutError, ValueError, json.JSONDecodeError) as error:
            healthy = False
            results[source] = {"ready": False, "error": error.__class__.__name__, "url": url}

    if args.as_json:
        print(json.dumps({"ready": healthy, "sources": results}, indent=2, sort_keys=True))
    else:
        for source in ("upwork", "linkedin"):
            value = results[source]
            status = "HEALTHY" if value.get("ready") else "UNHEALTHY"
            print(f"{source.upper():8} {status:9} {value.get('last_error') or value.get('error') or ''}")
        print("OVERALL  HEALTHY" if healthy else "OVERALL  UNHEALTHY")
    return 0 if healthy else 1


if __name__ == "__main__":
    raise SystemExit(main())
