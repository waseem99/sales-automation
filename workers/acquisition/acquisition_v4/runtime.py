from __future__ import annotations

import argparse
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import threading
import time
from typing import Any
from urllib.parse import urlsplit

from . import __version__
from .models import NormalizedRecord, SUPPORTED_SOURCES, utc_now_iso
from .storage import AtomicRecordStore

MAX_REQUEST_BYTES = 1_000_000
MAX_RECORDS_PER_CAPTURE = 50
ALLOWED_SOURCE_ORIGINS = {
    "upwork": {"https://www.upwork.com", "https://upwork.com"},
    "linkedin": {"https://www.linkedin.com", "https://linkedin.com"},
}


def _safe_error(error: Exception) -> str:
    if isinstance(error, ValueError):
        return str(error)[:300]
    return f"{error.__class__.__name__}: local processing failed"


def _safe_counter(value: Any) -> int:
    try:
        return max(0, int(value))
    except (TypeError, ValueError):
        return 0


def _validate_page_url(source: str, value: Any) -> str:
    raw = str(value or "").strip()
    parsed = urlsplit(raw)
    origin = f"{parsed.scheme.lower()}://{(parsed.hostname or '').lower()}"
    if origin not in ALLOWED_SOURCE_ORIGINS[source]:
        raise ValueError(f"The page URL does not belong to {source}.")
    return raw[:2_000]


@dataclass
class CollectorState:
    source: str
    state_root: Path
    parser_version: str
    started_monotonic: float = field(default_factory=time.monotonic)
    started_at: str = field(default_factory=utc_now_iso)

    def __post_init__(self) -> None:
        if self.source not in SUPPORTED_SOURCES:
            raise ValueError("Unsupported collector source.")
        self.store = AtomicRecordStore(self.state_root, self.source)
        self.records = self.store.load_records()
        self.seen = self.store.load_seen()
        previous_status = self.store.load_status()
        self.lock = threading.RLock()
        self.last_capture_at = str(previous_status.get("last_capture_at", ""))[:100]
        self.last_error = str(previous_status.get("last_error", ""))[:300]
        self.total_received = _safe_counter(previous_status.get("received"))
        self.total_accepted = len(self.records)
        self.total_duplicates = _safe_counter(previous_status.get("duplicates"))
        self.total_rejected = _safe_counter(previous_status.get("rejected"))
        self._write_status()

    def capture(self, payload: dict[str, Any]) -> dict[str, Any]:
        with self.lock:
            try:
                result = self._capture_locked(payload)
                self.last_error = ""
                self._write_status()
                return result
            except Exception as error:
                self.last_error = _safe_error(error)
                self._write_status()
                raise

    def _capture_locked(self, payload: dict[str, Any]) -> dict[str, Any]:
        if payload.get("external_action_performed") not in {False, None}:
            raise ValueError("Captures that performed an external action are rejected.")
        supplied_source = str(payload.get("source", "")).strip().lower()
        if supplied_source != self.source:
            raise ValueError(f"This collector accepts only {self.source} captures.")

        page_url = _validate_page_url(self.source, payload.get("page_url"))
        page_identity = str(payload.get("page_identity", "")).strip()[:500]
        parser_version = str(payload.get("parser_version", self.parser_version)).strip()[:100]
        source_subtype = str(payload.get("source_subtype", "visible_page")).strip()[:100]
        raw_records = payload.get("records")
        if not isinstance(raw_records, list) or not raw_records:
            raise ValueError("At least one visible record is required.")
        if len(raw_records) > MAX_RECORDS_PER_CAPTURE:
            raise ValueError("Too many records were supplied in one capture.")

        accepted: list[NormalizedRecord] = []
        duplicates = 0
        rejected = 0
        batch_seen: set[str] = set()
        self.total_received += len(raw_records)

        for raw in raw_records:
            if not isinstance(raw, dict):
                rejected += 1
                continue
            try:
                record = NormalizedRecord.from_capture(
                    source=self.source,
                    parser_version=parser_version,
                    source_subtype=source_subtype,
                    page_url=page_url,
                    page_identity=page_identity,
                    raw=raw,
                )
            except ValueError:
                rejected += 1
                continue
            if record.dedupe_key in self.seen or record.dedupe_key in batch_seen:
                duplicates += 1
                continue
            batch_seen.add(record.dedupe_key)
            accepted.append(record)

        if accepted:
            self.store.append_atomically(self.records, accepted)
            next_seen = {*self.seen, *(record.dedupe_key for record in accepted)}
            self.store.persist_seen(next_seen)
            self.records.extend(record.as_dict() for record in accepted)
            self.seen = next_seen

        self.total_accepted += len(accepted)
        self.total_duplicates += duplicates
        self.total_rejected += rejected
        self.last_capture_at = utc_now_iso()
        return {
            "source": self.source,
            "accepted": len(accepted),
            "duplicates": duplicates,
            "rejected": rejected,
            "total_records": len(self.records),
            "records_path": str(self.store.records_path),
            "external_action_performed": False,
        }

    def health(self) -> dict[str, Any]:
        with self.lock:
            return self._health_unlocked()

    def _health_unlocked(self) -> dict[str, Any]:
        return {
            "ready": True,
            "runtime_version": __version__,
            "schema_version": "codistan-acquisition-health.v1",
            "source": self.source,
            "parser_version": self.parser_version,
            "started_at": self.started_at,
            "uptime_seconds": int(time.monotonic() - self.started_monotonic),
            "last_capture_at": self.last_capture_at,
            "last_error": self.last_error,
            "received": self.total_received,
            "accepted": self.total_accepted,
            "duplicates": self.total_duplicates,
            "rejected": self.total_rejected,
            "records_path": str(self.store.records_path),
            "status_path": str(self.store.status_path),
            "external_actions_enabled": False,
        }

    def _write_status(self) -> None:
        self.store.persist_status(self._health_unlocked())


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
        if self.path in {"/health", "/status"}:
            self._send_json(200, self.server.state.health())
            return
        self._send_json(404, {"error": "Not found"})

    def do_POST(self) -> None:  # noqa: N802
        try:
            self._validate_origin()
            payload = self._read_json()
            if self.path == "/capture":
                self._send_json(200, self.server.state.capture(payload))
                return
            self._send_json(404, {"error": "Not found"})
        except ValueError as error:
            self._send_json(422, {"error": str(error)})
        except Exception as error:
            self._send_json(500, {"error": _safe_error(error)})

    def _validate_origin(self) -> None:
        origin = self.headers.get("Origin", "").strip()
        if origin and not (
            origin.startswith("chrome-extension://")
            or origin in {"http://127.0.0.1", "http://localhost"}
        ):
            raise ValueError("Request origin is not allowed.")

    def _read_json(self) -> dict[str, Any]:
        try:
            length = int(self.headers.get("Content-Length", "0") or "0")
        except ValueError as error:
            raise ValueError("Invalid request size.") from error
        if length <= 0 or length > MAX_REQUEST_BYTES:
            raise ValueError("Invalid request size.")
        try:
            value = json.loads(self.rfile.read(length).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise ValueError("Request body must be valid UTF-8 JSON.") from error
        if not isinstance(value, dict):
            raise ValueError("Request body must be a JSON object.")
        return value

    def _send_json(self, status: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload, ensure_ascii=False, sort_keys=True).encode("utf-8")
        self.send_response(status)
        self._cors_headers()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def _cors_headers(self) -> None:
        origin = self.headers.get("Origin", "")
        if origin.startswith("chrome-extension://"):
            self.send_header("Access-Control-Allow-Origin", origin)
        else:
            self.send_header("Access-Control-Allow-Origin", "http://127.0.0.1")
        self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")


def create_server(source: str, state_root: Path, port: int, parser_version: str) -> CollectorServer:
    server = CollectorServer(("127.0.0.1", port), CollectorHandler)
    server.state = CollectorState(source=source, state_root=state_root, parser_version=parser_version)
    return server


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run one Codistan Acquisition V4 local collector.")
    parser.add_argument("--source", choices=sorted(SUPPORTED_SOURCES), required=True)
    parser.add_argument("--state-root", type=Path, required=True)
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--parser-version", default="extension-unset")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    server = create_server(args.source, args.state_root, args.port, args.parser_version)
    print(f"Codistan {args.source} collector ready at http://127.0.0.1:{args.port}")
    try:
        server.serve_forever(poll_interval=0.25)
    except KeyboardInterrupt:
        return 130
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
