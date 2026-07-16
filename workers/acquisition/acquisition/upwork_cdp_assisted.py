from __future__ import annotations

import argparse
import json
import logging
from pathlib import Path
import sys
import time
from typing import Any
from urllib.parse import urlparse

from .models import OpportunityRecord
from .qualification import load_qualification_config, qualify
from .upwork_assisted import (
    AssistedCaptureStopped,
    AssistedSegment,
    _operator_resolve_access,
    _search_label,
    extract_visible_job_cards,
)
from .upwork_pilot import (
    PilotItem,
    PilotNoData,
    PilotSummary,
    _dedupe_key,
    _load_seen,
    _save_seen,
    external_job_id,
    load_upwork_pilot_config,
    utc_now_iso,
    write_pilot_outputs,
)


class CdpConnectionError(RuntimeError):
    """Raised when the normal installed browser cannot be attached locally."""


def run_upwork_cdp_assisted(
    *,
    cdp_endpoint: str,
    pilot_config_path: Path,
    qualification_config_path: Path,
    output_directory: Path,
    checkpoint_path: Path,
) -> tuple[PilotSummary, list[PilotItem]]:
    """Read visible Upwork cards from a normal Chrome session navigated by the operator.

    Chrome is launched externally by the Windows runner without Playwright launch
    arguments. This process attaches to that already-open browser over localhost,
    never enters search URLs, never opens job details, and never performs any
    application, message, proposal, or anti-detection action.
    """
    try:
        from playwright.sync_api import Error as PlaywrightError
        from playwright.sync_api import sync_playwright
    except ImportError as error:
        raise CdpConnectionError('Playwright is not installed. Run the Windows worker setup first.') from error

    pilot_config = load_upwork_pilot_config(pilot_config_path)
    qualification_config = load_qualification_config(qualification_config_path)
    segments = tuple(
        AssistedSegment(
            id=search.id,
            label=_search_label(search.id, search.url),
            max_jobs=search.max_jobs,
        )
        for search in pilot_config.searches
    )

    seen = _load_seen(checkpoint_path)
    session_seen: set[str] = set()
    summary = PilotSummary(started_at=utc_now_iso())
    items: list[PilotItem] = []

    with sync_playwright() as playwright:
        try:
            browser = playwright.chromium.connect_over_cdp(cdp_endpoint, timeout=30_000)
        except PlaywrightError as error:
            raise CdpConnectionError(
                "Could not attach to the normal Chrome capture window. Close it and rerun the launcher."
            ) from error

        if not browser.contexts:
            raise CdpConnectionError("The attached Chrome session did not expose a browser context.")

        context = browser.contexts[0]
        page = _select_operator_page(context)
        _operator_resolve_access(page)

        print("\nUPWORK OPERATOR-ASSISTED CAPTURE")
        print("This is a normal installed Chrome window. Navigate Upwork yourself.")
        print("Open the requested saved search, wait for visible result cards, then return here.")
        print("The worker reads only the visible cards after you press Enter.")
        print("It does not navigate searches, open job details, send messages, submit proposals, or bypass safeguards.\n")

        stop_requested = False
        for index, segment in enumerate(segments, start=1):
            if summary.reviewed >= pilot_config.max_jobs_total or stop_requested:
                break

            while True:
                page = _select_operator_page(context)
                print(f"[{index}/{len(segments)}] Open your Upwork saved search for: {segment.label}")
                print("Wait until normal job-result cards are visible in Chrome.")
                choice = input("Press Enter to capture, type S to skip, or Q to finish: ").strip().lower()
                if choice == "q":
                    stop_requested = True
                    break
                if choice == "s":
                    break

                page = _select_operator_page(context)
                _operator_resolve_access(page)
                snapshots = extract_visible_job_cards(page, segment.max_jobs)
                if not snapshots:
                    print("No visible Upwork job cards were detected on the current page.")
                    print("Open the saved-search results, wait for cards to load, then try again.\n")
                    continue

                summary.links_found += len(snapshots)
                for snapshot in snapshots:
                    if summary.reviewed >= pilot_config.max_jobs_total:
                        break
                    source_id = external_job_id(snapshot.source_url)
                    if source_id in seen or source_id in session_seen:
                        summary.duplicates += 1
                        continue

                    summary.reviewed += 1
                    try:
                        evidence = snapshot.to_evidence(segment.id)
                        if len(evidence.body.strip()) < pilot_config.min_description_chars:
                            summary.rejected_extraction += 1
                            continue
                        record = OpportunityRecord(
                            dedupe_key=_dedupe_key(evidence),
                            evidence=evidence,
                        )
                        decision = qualify(record, qualification_config)
                        items.append(PilotItem(record=record, qualification=decision))
                        seen.add(source_id)
                        session_seen.add(source_id)
                        _save_seen(checkpoint_path, seen)
                        summary.extracted += 1
                    except Exception:
                        summary.failed += 1

                print(f"Captured {len(snapshots)} visible card(s) for {segment.label}.\n")
                time.sleep(1.0)
                break

    summary.completed_at = utc_now_iso()
    if summary.links_found == 0 or summary.extracted == 0:
        raise PilotNoData(
            "No usable visible Upwork cards were captured. Navigate to a normal saved-search results page before pressing Enter."
        )

    write_pilot_outputs(
        output_directory=output_directory,
        summary=summary,
        items=items,
        config_version=f"{pilot_config.version}.normal-chrome-cdp-assisted",
    )
    return summary, items


def _select_operator_page(context: Any) -> Any:
    pages = list(context.pages)
    for page in reversed(pages):
        if urlparse(page.url).hostname in {"upwork.com", "www.upwork.com"}:
            return page
    if pages:
        return pages[-1]
    raise AssistedCaptureStopped("No browser tab is available. Keep the dedicated Chrome window open.")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="upwork-cdp-assisted")
    parser.add_argument("--cdp-endpoint", required=True)
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--qualification-config", type=Path, required=True)
    parser.add_argument("--output-directory", type=Path, required=True)
    parser.add_argument("--checkpoint", type=Path, required=True)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        summary, items = run_upwork_cdp_assisted(
            cdp_endpoint=args.cdp_endpoint,
            pilot_config_path=args.config,
            qualification_config_path=args.qualification_config,
            output_directory=args.output_directory,
            checkpoint_path=args.checkpoint,
        )
    except (AssistedCaptureStopped, CdpConnectionError) as error:
        logging.getLogger("acquisition.worker").warning("human_action_required reason=%s", str(error))
        return 4
    except PilotNoData as error:
        logging.getLogger("acquisition.worker").warning("pilot_no_data reason=%s", str(error))
        return 5

    payload = {
        "summary": summary.to_dict(),
        "report": str(args.output_directory / "report.html"),
        "qualified_or_better": sum(
            1
            for item in items
            if item.qualification.disposition in {"qualified", "contact_ready", "proposal_ready"}
        ),
        "dashboard_ingestion_enabled": False,
        "capture_mode": "normal_chrome_operator_assisted_cdp",
    }
    print(json.dumps(payload, indent=2, sort_keys=True))
    return 0 if summary.failed == 0 else 2


if __name__ == "__main__":
    sys.exit(main())
