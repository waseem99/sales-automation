from __future__ import annotations

import argparse
import json
import sys

from .adapters import FixtureHtmlAdapter
from .adapters.upwork import HumanActionRequired, UpworkSavedSearchAdapter, load_upwork_searches
from .browser import page_requires_human_action, persistent_browser
from .checkpoint import Checkpoint
from .ingestion import DashboardIngestionClient
from .qualification import qualify_opportunity
from .runner import run_collection


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="acquisition-worker",
        description="Local, human-controlled opportunity research worker.",
    )
    commands = parser.add_subparsers(dest="command", required=True)

    fixture = commands.add_parser("fixture", help="Run the local HTML fixture adapter.")
    _add_collection_arguments(fixture)
    fixture.add_argument("--input", required=True)
    fixture.add_argument(
        "--source",
        choices=["upwork", "linkedin", "sales_navigator", "public_web", "manual"],
        required=True,
    )
    fixture.add_argument("--segment", required=True)
    fixture.add_argument("--qualify", action="store_true")

    upwork = commands.add_parser(
        "upwork",
        help="Research configured Upwork saved searches through an authorized browser profile.",
    )
    _add_collection_arguments(upwork)
    upwork.add_argument("--config", required=True)
    upwork.add_argument("--profile-path", required=True)
    upwork.add_argument("--search-id", action="append", default=[])
    upwork.add_argument("--headless", action="store_true")
    upwork.add_argument("--slow-mo-ms", type=int, default=150)

    browser = commands.add_parser("browser", help="Open a user-authorized persistent Chromium profile.")
    browser.add_argument("--profile-path", required=True)
    browser.add_argument("--start-url", required=True)
    browser.add_argument("--headless", action="store_true")
    browser.add_argument("--slow-mo-ms", type=int, default=150)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.command == "fixture":
        client = _ingestion_client(args)
        adapter = FixtureHtmlAdapter(args.input, args.source, args.segment)
        summary = run_collection(
            adapter.collect(),
            Checkpoint.load(args.checkpoint),
            args.output,
            client,
            qualify_opportunity if args.qualify else None,
        )
        print(json.dumps(summary.as_dict(), sort_keys=True))
        return 0 if summary.failed == 0 else 1

    if args.command == "upwork":
        client = _ingestion_client(args)
        selected_ids = set(args.search_id) if args.search_id else None
        searches = load_upwork_searches(args.config, selected_ids)
        try:
            with persistent_browser(
                args.profile_path,
                headless=args.headless,
                slow_mo_ms=args.slow_mo_ms,
            ) as context:
                adapter = UpworkSavedSearchAdapter(context, searches)
                summary = run_collection(
                    adapter.collect(),
                    Checkpoint.load(args.checkpoint),
                    args.output,
                    client,
                    qualify_opportunity,
                )
        except HumanActionRequired as error:
            print(str(error), file=sys.stderr)
            return 3
        print(json.dumps(summary.as_dict(), sort_keys=True))
        return 0 if summary.failed == 0 else 1

    with persistent_browser(
        args.profile_path,
        headless=args.headless,
        slow_mo_ms=args.slow_mo_ms,
    ) as context:
        page = context.pages[0] if context.pages else context.new_page()
        page.goto(args.start_url, wait_until="domcontentloaded")
        if page_requires_human_action(page):
            print("Human action required: complete the account or verification challenge in the open browser.")
        else:
            print("Browser opened. Research remains manual until a source-specific adapter is enabled.")
        if not args.headless:
            input("Press Enter to close the browser...")
    return 0


def _add_collection_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--output", required=True)
    parser.add_argument("--checkpoint", required=True)
    parser.add_argument("--ingest", action="store_true")
    parser.add_argument("--confirm-ingestion", action="store_true")


def _ingestion_client(args: argparse.Namespace) -> DashboardIngestionClient | None:
    if args.ingest and not args.confirm_ingestion:
        raise SystemExit("--ingest requires --confirm-ingestion")
    return DashboardIngestionClient.from_environment() if args.ingest else None


if __name__ == "__main__":
    raise SystemExit(main())
