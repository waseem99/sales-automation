from __future__ import annotations

import argparse
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import threading
from typing import Any
from urllib.parse import urlparse

from .models import OpportunityRecord, SourceEvidence
from .pilot_v2_output import write_pilot_v2_outputs, write_recoverable_snapshot
from .qualification import load_qualification_config, qualify
from .upwork_card import canonical_visible_job_url, clean_visible_description, parse_visible_card_metrics
from .upwork_market import annotate_profile_and_market, apply_market_policy
from .upwork_pilot import (
    PilotItem,
    PilotSummary,
    _dedupe_key,
    _load_seen,
    _save_seen,
    external_job_id,
    load_upwork_pilot_config,
    utc_now_iso,
)

MAX_REQUEST_BYTES = 1_000_000
SEARCH_PATHS = {
    "/nx/find-work/9652811": "ai-jobs",
    "/nx/find-work/9652860": "roshana-2d-3d",
    "/nx/find-work/9652877": "nadir-game-ar-vr",
}


def _segment_for_page(value: str) -> str | None:
    parsed = urlparse(value)
    if parsed.hostname not in {"upwork.com", "www.upwork.com"}:
        return None
    return SEARCH_PATHS.get(parsed.path.rstrip("/"))


@dataclass
class CaptureServiceState:
    config_path: Path
    qualification_config_path: Path
    output_directory: Path
    checkpoint_path: Path
    state_directory: Path

    def __post_init__(self) -> None:
        self.pilot_config = load_upwork_pilot_config(self.config_path)
        self.qualification_config = load_qualification_config(self.qualification_config_path)
        self.allowed_segments = {search.id for search in self.pilot_config.searches}
        self.seen = _load_seen(self.checkpoint_path)
        self.session_seen: set[str] = set()
        self.summary = PilotSummary(started_at=utc_now_iso())
        self.items: list[PilotItem] = []
        self.lock = threading.RLock()
        self.output_directory.mkdir(parents=True, exist_ok=True)
        self.state_directory.mkdir(parents=True, exist_ok=True)
        self._write_outputs()
        self._write_service_status()

    def capture(self, payload: dict[str, Any]) -> dict[str, Any]:
        page_url = str(payload.get("page_url", "")).strip()
        segment = _segment_for_page(page_url)
        supplied = str(payload.get("segment", "")).strip()
        if not segment or segment not in self.allowed_segments:
            raise ValueError("Capture is allowed only from the three approved Upwork saved searches.")
        if supplied and supplied != segment:
            raise ValueError("Saved-search URL and profile category do not match.")
        raw_cards = payload.get("cards")
        if not isinstance(raw_cards, list) or not raw_cards:
            raise ValueError("No visible job cards were supplied.")

        accepted = 0
        duplicates = 0
        rejected = 0
        accepted_priorities = {"A": 0, "B": 0, "C": 0}
        new_source_ids: set[str] = set()

        with self.lock:
            for raw in raw_cards[:10]:
                if not isinstance(raw, dict):
                    rejected += 1
                    continue
                source_url = canonical_visible_job_url(str(raw.get("source_url", "")))
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
                    item = self._build_item(raw, segment, payload)
                    self.items.append(item)
                    self.session_seen.add(source_id)
                    new_source_ids.add(source_id)
                    self.summary.extracted += 1
                    accepted += 1
                    priority = item.qualification.priority
                    accepted_priorities[priority] = accepted_priorities.get(priority, 0) + 1
                except Exception:
                    self.summary.failed += 1
                    rejected += 1

            self.summary.status = "live"
            self.summary.completed_at = utc_now_iso()
            self._write_outputs()
            if new_source_ids:
                self.seen.update(new_source_ids)
                _save_seen(self.checkpoint_path, self.seen)
            self._write_service_status()

            return {
                "accepted": accepted,
                "duplicates": duplicates,
                "rejected": rejected,
                "accepted_priority_counts": accepted_priorities,
                "total_extracted": self.summary.extracted,
                "priority_counts": self._priority_counts(),
                "report_path": str(self.output_directory / "report.html"),
                "dashboard_ready_path": str(self.output_directory / "dashboard-ready.jsonl"),
                "capture_mode": "normal_chrome_auto_capture",
            }

    def _build_item(self, raw: dict[str, Any], segment: str, payload: dict[str, Any]) -> PilotItem:
        source_url = canonical_visible_job_url(str(raw.get("source_url", "")))
        if not source_url:
            raise ValueError("A concrete Upwork job URL is required.")
        title = str(raw.get("title", "")).strip()[:500]
        card_text = str(raw.get("card_text", ""))[:12_000]
        body, capture_meta = clean_visible_description(
            description=str(raw.get("description", ""))[:10_000],
            card_text=card_text,
            title=title,
        )
        if len(body.strip()) < self.pilot_config.min_description_chars:
            self.summary.rejected_extraction += 1
            raise ValueError("Visible description was too short for qualification.")

        attributes = parse_visible_card_metrics(card_text)
        attributes.update(capture_meta)
        attributes.update({
            "skills": [
                str(value)[:80]
                for value in raw.get("skills", [])[:20]
                if str(value).strip()
            ] if isinstance(raw.get("skills", []), list) else [],
            "captured_from": "normal_chrome_extension_visible_card",
            "capture_mode": "user_navigated_normal_chrome_auto_capture",
            "capture_trigger": str(payload.get("trigger", "automatic_visible_page"))[:80],
            "capture_schema_version": "upwork-normal-chrome-capture.v1",
        })

        evidence = SourceEvidence(
            source="upwork",
            source_id=external_job_id(source_url),
            source_url=source_url,
            captured_at=utc_now_iso(),
            title=title or "Untitled Upwork opportunity",
            body=body,
            segment=segment,
            attributes=attributes,
        )
        evidence = annotate_profile_and_market(
            evidence,
            segment,
            visible_client_card_text=card_text,
        )
        evidence.validate()
        record = OpportunityRecord(dedupe_key=_dedupe_key(evidence), evidence=evidence)
        decision = apply_market_policy(record, qualify(record, self.qualification_config))
        return PilotItem(record=record, qualification=decision)

    def status(self) -> dict[str, Any]:
        with self.lock:
            return self._status_unlocked()

    def snapshot(self) -> dict[str, Any]:
        with self.lock:
            self.summary.completed_at = utc_now_iso()
            self._write_outputs()
            self._write_service_status()
            return self._status_unlocked()

    def _status_unlocked(self) -> dict[str, Any]:
        return {
            "ready": True,
            "mode": "normal_chrome_auto_capture",
            "started_at": self.summary.started_at,
            "updated_at": self.summary.completed_at,
            "links_found": self.summary.links_found,
            "reviewed": self.summary.reviewed,
            "extracted": self.summary.extracted,
            "duplicates": self.summary.duplicates,
            "failed": self.summary.failed,
            "priority_counts": self._priority_counts(),
            "report_path": str(self.output_directory / "report.html"),
        }

    def _priority_counts(self) -> dict[str, int]:
        counts = {"A": 0, "B": 0, "C": 0}
        for item in self.items:
            priority = item.qualification.priority
            counts[priority] = counts.get(priority, 0) + 1
        return counts

    def _write_outputs(self) -> None:
        write_recoverable_snapshot(self.output_directory, self.summary, self.items)
        write_pilot_v2_outputs(
            output_directory=self.output_directory,
            summary=self.summary,
            items=self.items,
            config_version=f"{self.pilot_config.version}.normal-chrome-auto-capture-v1",
        )

    def _write_service_status(self) -> None:
        payload = {
            "schema_version": "codistan-upwork-normal-chrome-service.v1",
            **self._status_unlocked(),
        }
        (self.state_directory / "upwork-normal-chrome-service-status.json").write_text(
            json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True),
            encoding="utf-8",
        )


class CaptureServer(ThreadingHTTPServer):
    state: CaptureServiceState


class CaptureHandler(BaseHTTPRequestHandler):
    server: CaptureServer

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
            if self.path in {"/finish", "/snapshot"}:
                self._send_json(200, self.server.state.snapshot())
                return
            self._send_json(404, {"error": "Not found"})
        except ValueError as error:
            self._send_json(422, {"error": str(error)})
        except Exception as error:
            self._send_json(500, {
                "error": "The local capture processor could not process this request.",
                "error_type": error.__class__.__name__,
            })

    def _read_json(self) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length", "0") or "0")
        if length <= 0 or length > MAX_REQUEST_BYTES:
            raise ValueError("Invalid request size.")
        value = json.loads(self.rfile.read(length).decode("utf-8"))
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
        self.send_header(
            "Access-Control-Allow-Origin",
            origin if origin.startswith("chrome-extension://") else "http://127.0.0.1:8765",
        )
        self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Continuously process visible cards from normal Chrome.")
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--qualification-config", type=Path, required=True)
    parser.add_argument("--output-directory", type=Path, required=True)
    parser.add_argument("--checkpoint", type=Path, required=True)
    parser.add_argument("--state-directory", type=Path, required=True)
    parser.add_argument("--port", type=int, default=8765)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    state = CaptureServiceState(
        config_path=args.config,
        qualification_config_path=args.qualification_config,
        output_directory=args.output_directory,
        checkpoint_path=args.checkpoint,
        state_directory=args.state_directory,
    )
    server = CaptureServer(("127.0.0.1", args.port), CaptureHandler)
    server.state = state
    print("CODISTAN NORMAL-CHROME UPWORK CAPTURE SERVICE")
    print(f"Local processor ready at http://127.0.0.1:{args.port}")
    print("Open any approved saved search in normal Chrome; visible cards are processed automatically.")
    try:
        server.serve_forever(poll_interval=0.25)
    except KeyboardInterrupt:
        return 130
    finally:
        try:
            state.snapshot()
        finally:
            server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
