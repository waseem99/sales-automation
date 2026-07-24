from __future__ import annotations

import argparse
import json
from pathlib import Path
from urllib.request import Request, urlopen

PORTS = {"upwork": 8765, "linkedin": 8775}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Submit a local sanitized fixture to a V4 collector.")
    parser.add_argument("source", choices=sorted(PORTS))
    parser.add_argument("fixture", type=Path)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    body = args.fixture.read_bytes()
    request = Request(
        f"http://127.0.0.1:{PORTS[args.source]}/capture",
        data=body,
        headers={"Content-Type": "application/json", "Origin": "http://127.0.0.1"},
        method="POST",
    )
    with urlopen(request, timeout=5) as response:  # noqa: S310 - localhost-only CLI
        print(json.dumps(json.loads(response.read().decode("utf-8")), indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
