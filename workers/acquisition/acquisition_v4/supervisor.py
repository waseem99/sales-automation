from __future__ import annotations

import argparse
from pathlib import Path
import signal
import threading

from .runtime import CollectorServer, create_server

DEFAULT_PORTS = {"upwork": 8765, "linkedin": 8775}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run both Codistan Acquisition V4 collectors.")
    parser.add_argument("--state-root", type=Path, required=True)
    parser.add_argument("--upwork-port", type=int, default=DEFAULT_PORTS["upwork"])
    parser.add_argument("--linkedin-port", type=int, default=DEFAULT_PORTS["linkedin"])
    parser.add_argument("--upwork-parser-version", default="upwork-extension-unset")
    parser.add_argument("--linkedin-parser-version", default="linkedin-extension-unset")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    servers: list[CollectorServer] = [
        create_server("upwork", args.state_root, args.upwork_port, args.upwork_parser_version),
        create_server("linkedin", args.state_root, args.linkedin_port, args.linkedin_parser_version),
    ]
    threads = [
        threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.25}, daemon=True)
        for server in servers
    ]
    stopping = threading.Event()

    def stop(_signum: int, _frame: object) -> None:
        stopping.set()

    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)
    for thread in threads:
        thread.start()

    print(f"Upwork collector:  http://127.0.0.1:{args.upwork_port}/health")
    print(f"LinkedIn collector: http://127.0.0.1:{args.linkedin_port}/health")
    print(f"State root: {args.state_root}")
    try:
        while not stopping.wait(0.5):
            if not all(thread.is_alive() for thread in threads):
                return 1
    finally:
        for server in servers:
            server.shutdown()
        for server in servers:
            server.server_close()
        for thread in threads:
            thread.join(timeout=5)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
