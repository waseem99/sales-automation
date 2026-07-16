from __future__ import annotations

import argparse
import json
import logging
from pathlib import Path
import sys

from .adapters.fixture import FixtureHtmlAdapter
from .browser import bootstrap_authorized_profile, validate_external_profile_path
from .checkpoints import CheckpointStore
from .config import load_worker_config
from .redaction import sanitize_log_text
from .runner import AcquisitionRunner
from .storage import HttpIngestionSink, JsonlSink


class _SanitizingFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        return sanitize_log_text(super().format(record))


def configure_logging(verbose: bool) -> None:
    handler = logging.StreamHandler()
    handler.setFormatter(_SanitizingFormatter("%(levelname)s %(name)s %(message)s"))
    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(logging.DEBUG if verbose else logging.INFO)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="acquisition-worker")
    parser.add_argument("--verbose", action="store_true")
    subparsers = parser.add_subparsers(dest="command", required=True)

    run = subparsers.add_parser("run", help="Run a configured acquisition adapter")
    run.add_argument("--adapter", choices=["fixture"], default="fixture")
    run.add_argument("--input", type=Path, required=True)
    run.add_argument("--config", type=Path, required=True)
    run.add_argument("--output", type=Path, default=Path(".data/acquisition/dry-run.jsonl"))
    run.add_argument("--checkpoint", type=Path, default=Path(".data/acquisition/checkpoints.json"))
    run.add_argument("--run-key", default="fixture-default")
    run.add_argument("--ingest-url")
    run.add_argument("--dry-run", action="store_true", default=False)

    browser = subparsers.add_parser("browser", help="Bootstrap a user-authorized Chromium profile")
    browser.add_argument("--profile", type=Path, required=True)
    browser.add_argument("--url", required=True)
    browser.add_argument("--repository-root", type=Path, default=Path.cwd())
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    configure_logging(args.verbose)
    if args.command == "browser":
        profile = validate_external_profile_path(args.profile, args.repository_root)
        bootstrap_authorized_profile(profile, args.url)
        return 0

    config = load_worker_config(args.config)
    if args.ingest_url and args.dry_run:
        parser.error("--dry-run and --ingest-url cannot be used together")
    sink = HttpIngestionSink(args.ingest_url) if args.ingest_url else JsonlSink(args.output)
    adapter = FixtureHtmlAdapter(args.input)
    runner = AcquisitionRunner(
        adapter=adapter,
        sink=sink,
        checkpoints=CheckpointStore(args.checkpoint),
        run_key=args.run_key,
    )
    summary = runner.run(limit=config.max_items, enabled_segments=config.enabled_segment_ids())
    print(json.dumps(summary.to_dict(), indent=2, sort_keys=True))
    return 0 if summary.failed == 0 else 2


if __name__ == "__main__":
    sys.exit(main())
