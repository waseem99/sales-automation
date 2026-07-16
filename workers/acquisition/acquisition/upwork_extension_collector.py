from __future__ import annotations

import argparse
from dataclasses import dataclass
import json
from pathlib import Path
import threading
import time
from typing import Any
from urllib.parse import urlparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from .models import OpportunityRecord
from .qualification import load_qualification_config, qualify
from .upwork_assisted import VisibleJobCard, _canonical_visible_job_url
from .upwork_pilot import (
    PilotItem,
    PilotSummary,
    _dedupe_key,
    _load_seen,
    _save_seen,
    external_job_id,
    load_upwork_pilot_config,
    utc_now_iso,
    write_pilot_outputs,
)

MAX_REQUEST_BYTES = 1_000_000


@dataclass(slots=True)
class CollectorState:
    pilot_config_path: Path
    qualification_config_path: Path
    output_directory: Path
    checkpoint_path: Path

    def __post_init__(self) -> None:
        self.pilot_config = load_upwork_pilot_config(self.pilot_config_path)
        self.qualification_config = load_qualification_config(self.qualification_config_path)
        self.allowed_segments = {search.id for search in self.pilot_config.searches}
        self.seen = _load_seen(self.checkpoint_path)
        self.session_seen: set[str] = set()
        self.summary = PilotSummary(started_at=utc_now_iso())
        self.items: list[PilotItem] = []
        self.lock = threading.Lock()
        self.finished = False

    def capture(self, payload: dict[str, Any]) -> dict[str, Any]:
        segment = str(payload.get("segment", "")).strip()
        if segment not in self.allowed_segments:
            raise ValueError("Unknown service category.")

        page_url = str(payload.get("page_url", "")).strip()
        parsed_page = urlparse(page_url)
        if parsed_page.hostname not in {"upwork.com", "www.upwork.com"}:
            raise ValueError("Capture must come from an Upwork page.")

        raw_cards = payload.get("cards")
        if not isinstance(raw_cards, list) or not raw_cards:
            raise ValueError("No visible job cards were supplied.")

        accepted = 0
        duplicates = 0
        rejected = 0
        with self.lock:
            if self.finished:
                raise ValueError("This capture session is already finished.")

            remaining = max(0, self.pilot_config.max_jobs_total - self.summary.reviewed)
            for raw in raw_cards[: min(10, remaining)]:
                if not isinstance(raw, dict):
                    rejected += 1
                    continue
                source_url = _canonical_visible_job_url(str(raw.get("source_url", "")))
                if not source_url:
                    rejected += 1
                    continue

                self.summary.links_found += 1
                source_id = external_job_id(source_url)
                if source_id in self.seen or source_id in self.session_seen:
                    self.summary.duplicates += 1
                    duplicates += 1
                    continue

                self.summary.reviewed += 1
                try:
                    card = VisibleJobCard(
                        source_url=source_url,
                        title=str(raw.get("title", ""))[:500],
                        description=str(raw.get("description", ""))[:10_000],
                        card_text=str(raw.get("card_text", ""))[:12_000],
                        skills=tuple(
                            str(value)[:80]
                            for value in raw.get("skills", [])[:20]
                            if str(value).strip()
                        ) if isinstance(raw.get("skills", []), list) else (),
                    )
                    evidence = card.to_evidence(segment)
                    if len(evidence.body.strip()) < self.pilot_config.min_description_chars:
                        self.summary.rejected_extraction += 1
                        rejected += 1
                        continue
                    record = OpportunityRecord(
                        dedupe_key=_dedupe_key(evidence),
                        evidence=evidence,
                    )
                    decision = qualify(record, self.qualification_config)
                    self.items.append(PilotItem(record=record, qualification=decision))
                    self.seen.add(source_id)
                    self.session_seen.add(source_id)
                    _save_seen(self.checkpoint_path, self.seen)
                    self.summary.extracted += 1
                    accepted += 1
                except Exception:
                    self.summary.failed += 1
                    rejected += 1

        return {
            "accepted": accepted,
            "duplicates": duplicates,
            "rejected": rejected,
            "total_extracted": self.summary.extracted,
            "remaining_capacity": max(0, self.pilot_config.max_jobs_total - self.summary.reviewed),
        }

    def finish(self) -> dict[str, Any]:
        with self.lock:
            if self.finished:
                return self._result_payload()
            if self.summary.extracted == 0:
                raise ValueError("Capture at least one usable Upwork opportunity before creating the report.")
            self.finished = True
            self.summary.completed_at = utc_now_iso()
            write_pilot_outputs(
                output_directory=self.output_directory,
                summary=self.summary,
                items=self.items,
                config_version=f"{self.pilot_config.version}.manual-extension",
            )
            result = self._result_payload()
            (self.output_directory / "collector-result.json").write_text(
                json.dumps(result, indent=2, sort_keys=True),
                encoding="utf-8",
            )
            return result

    def status(self) -> dict[str, Any]:
        with self.lock:
            return {
                "ready": True,
                "finished": self.finished,
                "links_found": self.summary.links_found,
                "reviewed": self.summary.reviewed,
                "extracted": self.summary.extracted,
                "duplicates": self.summary.duplicates,
                "failed": self.summary.failed,
                "max_jobs_total": self.pilot_config.max_jobs_total,
            }

    def _result_payload(self) -> dict[str, Any]:
        return {
            "finished": True,
            "total_extracted": self.summary.extracted,
            "qualified_or_better": sum(
                1
                for item in self.items
                if item.qualification.disposition in {"qualified", "contact_ready", "proposal_ready"}
            ),
            "report_path": str(self.output_directory / "report.html"),
            "dashboard_ready_path": str(self.output_directory / "dashboard-ready.jsonl"),
            "dashboard_ingestion_enabled": False,
            "capture_mode": "manual_chrome_extension_visible_cards",
        }


class CollectorServer(ThreadingHTTPServer):
    state: CollectorState


class CollectorHandler(BaseHTTPRequestHandler):
    server: CollectorServer

    def log_message(self, _format: str, *_args: Any) -> None:
        return

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(204)
        self._cors_headers()
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/status":
            self._send_json(200, self.server.state.status())
            return
        self._send_json(404, {"error": "Not found"})

    def do_POST(self) -> None:  # noqa: N802
        try:
            payload = self._read_json()
            if self.path == "/capture":
                self._send_json(200, self.server.state.capture(payload))
                return
            if self.path == "/finish":
                result = self.server.state.finish()
                self._send_json(200, result)
                threading.Thread(target=self._shutdown_soon, daemon=True).start()
                return
            self._send_json(404, {"error": "Not found"})
        except ValueError as error:
            self._send_json(422, {"error": str(error)})
        except Exception:
            self._send_json(500, {"error": "The local collector could not process this request."})

    def _read_json(self) -> dict[str, Any]:
        content_length = int(self.headers.get("Content-Length", "0") or "0")
        if content_length <= 0 or content_length > MAX_REQUEST_BYTES:
            raise ValueError("Invalid request size.")
        value = json.loads(self.rfile.read(content_length).decode("utf-8"))
        if not isinstance(value, dict):
            raise ValueError("Request must be a JSON object.")
        return value

    def _send_json(self, status: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload, ensure_ascii=False, sort_keys=True).encode("utf-8")
        self.send_response(status)
        self._cors_headers()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _cors_headers(self) -> None:
        origin = self.headers.get("Origin", "")
        if origin.startswith("chrome-extension://"):
            self.send_header("Access-Control-Allow-Origin", origin)
        else:
            self.send_header("Access-Control-Allow-Origin", "http://127.0.0.1:8765")
        self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _shutdown_soon(self) -> None:
        time.sleep(1.0)
        self.server.shutdown()


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Receive manual Upwork extension captures on localhost.")
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--qualification-config", type=Path, required=True)
    parser.add_argument("--output-directory", type=Path, required=True)
    parser.add_argument("--checkpoint", type=Path, required=True)
    parser.add_argument("--port", type=int, default=8765)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    args.output_directory.mkdir(parents=True, exist_ok=True)
    state = CollectorState(
        pilot_config_path=args.config,
        qualification_config_path=args.qualification_config,
        output_directory=args.output_directory,
        checkpoint_path=args.checkpoint,
    )
    server = CollectorServer(("127.0.0.1", args.port), CollectorHandler)
    server.state = state
    print("CODISTAN UPWORK MANUAL CAPTURE COLLECTOR")
    print(f"Local collector ready at http://127.0.0.1:{args.port}")
    print("Use the Chrome extension on normal Upwork saved-search pages.")
    print("Click 'Finish and create report' in the extension when done.\n")
    try:
        server.serve_forever(poll_interval=0.25)
    except KeyboardInterrupt:
        return 130
    finally:
        server.server_close()
    return 0 if state.finished else 5


if __name__ == "__main__":
    raise SystemExit(main())
