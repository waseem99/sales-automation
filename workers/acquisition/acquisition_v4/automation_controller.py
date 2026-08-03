from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import secrets
import subprocess
import threading
import time
from typing import Any
from urllib.parse import urlsplit

from .review_v5 import write_review_outputs
from .storage import atomic_write_text

CONTROL_PORT = 8795
COMBINED_INTERVAL_SECONDS = 15 * 60
SALES_NAV_INTERVAL_SECONDS = 12 * 60 * 60
SOURCE_TIMEOUT_SECONDS = {
    "upwork": 8 * 60,
    "linkedin": 8 * 60,
    "sales_navigator": 12 * 60,
}
SOURCE_PORTS = {"upwork": 8765, "linkedin": 8775, "sales_navigator": 8785}


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def utc_iso(value: datetime | None = None) -> str:
    return (value or utc_now()).isoformat()


def safe_int(value: Any) -> int:
    try:
        return max(0, int(value))
    except (TypeError, ValueError):
        return 0


def safe_text(value: Any, limit: int = 500) -> str:
    return str(value or "").strip()[:limit]


@dataclass
class SourceResult:
    source: str
    cycle_id: str
    status: str = "pending"
    started_at: str = ""
    completed_at: str = ""
    accepted: int = 0
    duplicates: int = 0
    enriched: int = 0
    rejected: int = 0
    detail_enriched: int = 0
    last_error: str = ""
    searches: list[dict[str, Any]] = field(default_factory=list)

    @classmethod
    def from_event(cls, source: str, cycle_id: str, payload: dict[str, Any]) -> "SourceResult":
        result = payload.get("result")
        value = result if isinstance(result, dict) else payload
        return cls(
            source=source,
            cycle_id=cycle_id,
            status="completed" if payload.get("ok") is not False else "failed",
            started_at=safe_text(value.get("started_at"), 100),
            completed_at=safe_text(value.get("completed_at"), 100) or utc_iso(),
            accepted=safe_int(value.get("accepted")),
            duplicates=safe_int(value.get("duplicates")),
            enriched=safe_int(value.get("enriched")),
            rejected=safe_int(value.get("rejected")),
            detail_enriched=safe_int(value.get("detail_enriched")),
            last_error=safe_text(value.get("last_error") or payload.get("error"), 500),
            searches=value.get("searches") if isinstance(value.get("searches"), list) else [],
        )

    def as_dict(self) -> dict[str, Any]:
        return {
            "source": self.source,
            "cycle_id": self.cycle_id,
            "status": self.status,
            "started_at": self.started_at,
            "completed_at": self.completed_at,
            "accepted": self.accepted,
            "duplicates": self.duplicates,
            "enriched": self.enriched,
            "rejected": self.rejected,
            "detail_enriched": self.detail_enriched,
            "last_error": self.last_error,
            "searches": self.searches,
        }


class AutomationController:
    def __init__(self, state_root: Path, port: int = CONTROL_PORT) -> None:
        self.state_root = state_root
        self.port = port
        self.status_path = state_root / "status" / "automation-controller.json"
        self.token_path = state_root / "config" / "automation-control-token.txt"
        self.marker_path = state_root / "config" / "browser-extensions-confirmed.json"
        self.stop_event = threading.Event()
        self.run_requested = threading.Event()
        self.lock = threading.RLock()
        self.condition = threading.Condition(self.lock)
        self.paused = False
        self.running_cycle_id = ""
        self.running_source = ""
        self.events: dict[tuple[str, str], SourceResult] = {}
        self.last_cycle: dict[str, Any] | None = None
        self.last_sales_nav_at: datetime | None = None
        self.next_combined_at = utc_now()
        self.next_sales_nav_at = utc_now() + timedelta(minutes=10)
        self.thread: threading.Thread | None = None
        self.server: ThreadingHTTPServer | None = None
        self.server_thread: threading.Thread | None = None
        self.control_token = self._load_or_create_token()
        self._persist_status()

    def _load_or_create_token(self) -> str:
        self.token_path.parent.mkdir(parents=True, exist_ok=True)
        if self.token_path.exists():
            value = self.token_path.read_text(encoding="utf-8").strip()
            if len(value) >= 32:
                return value
        value = secrets.token_urlsafe(32)
        atomic_write_text(self.token_path, value + "\n")
        return value

    def start(self) -> None:
        with self.lock:
            if self.thread and self.thread.is_alive():
                return
            self.paused = False
            self.stop_event.clear()
            self.run_requested.set()
            self.next_combined_at = utc_now()
            self.thread = threading.Thread(target=self._loop, name="codistan-automation-controller", daemon=True)
            self.thread.start()
            self.server = AutomationServer(("127.0.0.1", self.port), AutomationHandler)
            self.server.controller = self
            self.server_thread = threading.Thread(
                target=self.server.serve_forever,
                kwargs={"poll_interval": 0.25},
                name="codistan-automation-control-http",
                daemon=True,
            )
            self.server_thread.start()
            self._persist_status()

    def stop(self) -> None:
        self.stop_event.set()
        self.run_requested.set()
        with self.condition:
            self.condition.notify_all()
        if self.server:
            self.server.shutdown()
            self.server.server_close()
        if self.server_thread:
            self.server_thread.join(timeout=5)
        if self.thread:
            self.thread.join(timeout=10)
        self.server = None
        self.server_thread = None
        self.thread = None
        self._persist_status()

    def control(self, action: str) -> dict[str, Any]:
        with self.lock:
            normalized = action.strip().lower()
            if normalized == "pause":
                self.paused = True
            elif normalized == "resume":
                self.paused = False
                self.next_combined_at = utc_now()
                self.run_requested.set()
            elif normalized == "run_now":
                self.paused = False
                self.next_combined_at = utc_now()
                self.run_requested.set()
            else:
                raise ValueError("Unsupported automation control action.")
            self._persist_status()
            return self.status()

    def report_event(self, payload: dict[str, Any]) -> dict[str, Any]:
        source = safe_text(payload.get("source"), 50).lower()
        cycle_id = safe_text(payload.get("cycle_id"), 120)
        if source not in SOURCE_PORTS:
            raise ValueError("Unsupported automation source.")
        if not cycle_id:
            raise ValueError("Automation cycle ID is required.")
        result = SourceResult.from_event(source, cycle_id, payload)
        with self.condition:
            self.events[(cycle_id, source)] = result
            self.condition.notify_all()
            self._persist_status()
        return {"accepted": True, "source": source, "cycle_id": cycle_id}

    def status(self) -> dict[str, Any]:
        with self.lock:
            now = utc_now()
            source_events = {
                source: result.as_dict()
                for (cycle_id, source), result in self.events.items()
                if cycle_id == self.running_cycle_id
            }
            return {
                "schema_version": "codistan-capture-automation.v1",
                "ready": bool(self.thread and self.thread.is_alive()),
                "paused": self.paused,
                "cycle_running": bool(self.running_cycle_id),
                "running_cycle_id": self.running_cycle_id,
                "running_source": self.running_source,
                "interval_minutes": 15,
                "sales_navigator_interval_hours": 12,
                "next_cycle_at": utc_iso(self.next_combined_at),
                "next_cycle_in_seconds": max(0, int((self.next_combined_at - now).total_seconds())),
                "next_sales_navigator_at": utc_iso(self.next_sales_nav_at),
                "last_cycle": self.last_cycle,
                "current_source_results": source_events,
                "control_port": self.port,
                "external_actions_enabled": False,
            }

    def _persist_status(self) -> None:
        self.status_path.parent.mkdir(parents=True, exist_ok=True)
        atomic_write_text(self.status_path, json.dumps(self.status(), ensure_ascii=False, indent=2) + "\n")

    def _loop(self) -> None:
        while not self.stop_event.is_set():
            now = utc_now()
            should_run = self.run_requested.is_set() or (not self.paused and now >= self.next_combined_at)
            if should_run and not self.paused:
                self.run_requested.clear()
                try:
                    self._run_combined_cycle()
                except Exception as error:
                    with self.lock:
                        self.last_cycle = {
                            "cycle_id": self.running_cycle_id,
                            "status": "failed",
                            "started_at": "",
                            "completed_at": utc_iso(),
                            "last_error": safe_text(error, 500),
                            "sources": {},
                        }
                        self.running_cycle_id = ""
                        self.running_source = ""
                        self.next_combined_at = utc_now() + timedelta(seconds=COMBINED_INTERVAL_SECONDS)
                        self._persist_status()
            self.stop_event.wait(1)

    def _browser_config(self) -> dict[str, Any]:
        if not self.marker_path.exists():
            raise RuntimeError("Browser extension configuration is missing.")
        value = json.loads(self.marker_path.read_text(encoding="utf-8-sig"))
        if not isinstance(value, dict) or value.get("confirmed") is not True:
            raise RuntimeError("Browser extension configuration is not confirmed.")
        executable = Path(str(value.get("browser_executable") or ""))
        if not executable.exists():
            raise RuntimeError("Configured Chrome executable was not found.")
        if str(value.get("browser_id") or "") != "chrome":
            raise RuntimeError("Automated capture is configured only for the approved Google Chrome profile.")
        if not value.get("upwork_extension_id") or not value.get("linkedin_sales_navigator_extension_id"):
            raise RuntimeError("One or both extension IDs are missing from the browser marker.")
        return value

    def _launch_extension_page(self, extension_id: str, page: str, query: str) -> None:
        config = self._browser_config()
        command = [str(config["browser_executable"])]
        profile_argument = safe_text(config.get("browser_profile_argument"), 300)
        if profile_argument:
            command.append(profile_argument)
        command.append(f"chrome-extension://{extension_id}/{page}?{query}")
        subprocess.Popen(
            command,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            stdin=subprocess.DEVNULL,
            close_fds=os.name != "nt",
        )

    def _run_combined_cycle(self) -> None:
        cycle_id = f"capture-{int(time.time())}-{secrets.token_hex(4)}"
        started_at = utc_iso()
        with self.lock:
            self.running_cycle_id = cycle_id
            self.running_source = "upwork"
            self._persist_status()

        config = self._browser_config()
        upwork_id = safe_text(config.get("upwork_extension_id"), 120)
        linkedin_id = safe_text(config.get("linkedin_sales_navigator_extension_id"), 120)
        query = (
            f"cycle_id={cycle_id}"
            f"&controller_port={self.port}"
            f"&next_extension_id={linkedin_id}"
            "&next_source=linkedin"
        )
        self._launch_extension_page(upwork_id, "automation-trigger.html", query)

        source_results: dict[str, dict[str, Any]] = {}
        upwork = self._wait_for_source(cycle_id, "upwork")
        source_results["upwork"] = upwork.as_dict()

        with self.lock:
            self.running_source = "linkedin"
            self._persist_status()
        linkedin = self._wait_for_source(cycle_id, "linkedin")
        source_results["linkedin"] = linkedin.as_dict()

        now = utc_now()
        sales_nav_due = now >= self.next_sales_nav_at
        if sales_nav_due and not self.stop_event.is_set():
            with self.lock:
                self.running_source = "sales_navigator"
                self._persist_status()
            sales_query = f"cycle_id={cycle_id}&controller_port={self.port}&source=sales_navigator"
            self._launch_extension_page(linkedin_id, "automation-trigger.html", sales_query)
            sales_nav = self._wait_for_source(cycle_id, "sales_navigator")
            source_results["sales_navigator"] = sales_nav.as_dict()
            self.last_sales_nav_at = now
            self.next_sales_nav_at = now + timedelta(seconds=SALES_NAV_INTERVAL_SECONDS)

        write_review_outputs(self.state_root)
        completed_at = utc_iso()
        status_value = "completed"
        errors = [
            result.get("last_error")
            for result in source_results.values()
            if result.get("status") != "completed" or result.get("last_error")
        ]
        if errors:
            status_value = "completed_with_source_errors"

        totals = {
            key: sum(safe_int(result.get(key)) for result in source_results.values())
            for key in ("accepted", "duplicates", "enriched", "rejected", "detail_enriched")
        }
        with self.lock:
            self.last_cycle = {
                "cycle_id": cycle_id,
                "status": status_value,
                "started_at": started_at,
                "completed_at": completed_at,
                "sources": source_results,
                "totals": totals,
                "last_error": "; ".join(str(error) for error in errors if error)[:500],
            }
            self.running_cycle_id = ""
            self.running_source = ""
            self.next_combined_at = utc_now() + timedelta(seconds=COMBINED_INTERVAL_SECONDS)
            self._persist_status()

    def _wait_for_source(self, cycle_id: str, source: str) -> SourceResult:
        deadline = time.monotonic() + SOURCE_TIMEOUT_SECONDS[source]
        with self.condition:
            while not self.stop_event.is_set():
                result = self.events.get((cycle_id, source))
                if result:
                    return result
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    result = SourceResult(
                        source=source,
                        cycle_id=cycle_id,
                        status="failed",
                        completed_at=utc_iso(),
                        last_error=f"{source} capture cycle timed out.",
                    )
                    self.events[(cycle_id, source)] = result
                    return result
                self.condition.wait(timeout=min(1.0, remaining))
        return SourceResult(
            source=source,
            cycle_id=cycle_id,
            status="stopped",
            completed_at=utc_iso(),
            last_error="Automation controller stopped.",
        )


class AutomationServer(ThreadingHTTPServer):
    controller: AutomationController


class AutomationHandler(BaseHTTPRequestHandler):
    server: AutomationServer

    def log_message(self, _format: str, *_args: Any) -> None:
        return

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(204)
        self._cors_headers()
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        if urlsplit(self.path).path == "/status":
            self._send_json(200, self.server.controller.status())
            return
        self._send_json(404, {"error": "Not found"})

    def do_POST(self) -> None:  # noqa: N802
        try:
            path = urlsplit(self.path).path
            payload = self._read_json()
            if path == "/event":
                self._validate_extension_origin()
                self._send_json(200, self.server.controller.report_event(payload))
                return
            if path == "/control":
                self._validate_control(payload)
                action = safe_text(payload.get("action"), 50)
                self._send_json(200, self.server.controller.control(action))
                return
            self._send_json(404, {"error": "Not found"})
        except ValueError as error:
            self._send_json(422, {"error": str(error)})
        except Exception as error:
            self._send_json(500, {"error": f"{error.__class__.__name__}: automation control failed"})

    def _validate_extension_origin(self) -> None:
        origin = self.headers.get("Origin", "").strip()
        if not origin.startswith("chrome-extension://"):
            raise ValueError("Automation events are accepted only from the installed extensions.")

    def _validate_control(self, payload: dict[str, Any]) -> None:
        supplied = safe_text(payload.get("token"), 200)
        if not secrets.compare_digest(supplied, self.server.controller.control_token):
            raise ValueError("Automation control token is invalid.")
        origin = self.headers.get("Origin", "").strip()
        if origin not in {"", "null"} and not origin.startswith("file://"):
            raise ValueError("Automation control origin is not allowed.")

    def _read_json(self) -> dict[str, Any]:
        try:
            length = int(self.headers.get("Content-Length", "0") or "0")
        except ValueError as error:
            raise ValueError("Invalid request size.") from error
        if length <= 0 or length > 500_000:
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
        origin = self.headers.get("Origin", "").strip()
        if origin.startswith("chrome-extension://"):
            self.send_header("Access-Control-Allow-Origin", origin)
        elif origin == "null":
            self.send_header("Access-Control-Allow-Origin", "null")
        else:
            self.send_header("Access-Control-Allow-Origin", "http://127.0.0.1")
        self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
