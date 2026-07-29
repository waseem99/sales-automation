from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import threading
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

SYNC_SCHEMA_VERSION = "codistan-acquisition-sync.v1"
CONFIG_VERSION = 1
STATE_VERSION = 1
MAX_BATCH_RECORDS = 25
DEFAULT_INTERVAL_SECONDS = 60
MIN_INTERVAL_SECONDS = 30
MAX_INTERVAL_SECONDS = 3600


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _atomic_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    temp.replace(path)


def _load_json(path: Path) -> dict[str, Any]:
    try:
        raw = path.read_text(encoding="utf-8").strip()
        value = json.loads(raw) if raw else {}
        return value if isinstance(value, dict) else {}
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        return {}


def _safe_int(value: Any, fallback: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return fallback
    return max(MIN_INTERVAL_SECONDS, min(MAX_INTERVAL_SECONDS, parsed))


def _record_fingerprint(record: dict[str, Any]) -> str:
    body = json.dumps(record, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(body.encode("utf-8")).hexdigest()


@dataclass(frozen=True, slots=True)
class ProspectDeskSyncConfig:
    enabled: bool
    endpoint: str
    token: str
    sources: tuple[str, ...]
    interval_seconds: int

    @classmethod
    def from_file(cls, path: Path) -> "ProspectDeskSyncConfig":
        value = _load_json(path)
        endpoint = str(value.get("endpoint", "")).strip()
        token = str(value.get("token", "")).strip()
        raw_sources = value.get("sources") if isinstance(value.get("sources"), list) else ["linkedin"]
        sources = tuple(sorted({str(item).strip().lower() for item in raw_sources if str(item).strip()}))
        enabled = value.get("enabled") is True
        interval_seconds = _safe_int(value.get("interval_seconds"), DEFAULT_INTERVAL_SECONDS)
        return cls(
            enabled=enabled,
            endpoint=endpoint,
            token=token,
            sources=sources or ("linkedin",),
            interval_seconds=interval_seconds,
        )

    def validate_for_source(self, source: str) -> None:
        if not self.enabled:
            raise ValueError("Prospect Desk sync is disabled.")
        if source not in self.sources:
            raise ValueError(f"Prospect Desk sync is not enabled for {source}.")
        parsed = urlsplit(self.endpoint)
        is_local = parsed.hostname in {"127.0.0.1", "localhost"}
        if parsed.scheme != "https" and not (is_local and parsed.scheme == "http"):
            raise ValueError("Prospect Desk endpoint must use HTTPS.")
        if not parsed.netloc or not parsed.path.endswith("/api/acquisition-ingest"):
            raise ValueError("Prospect Desk endpoint must end with /api/acquisition-ingest.")
        if len(self.token) < 32:
            raise ValueError("Prospect Desk sync token must contain at least 32 characters.")


class ProspectDeskSync:
    def __init__(
        self,
        *,
        state_root: Path,
        source: str,
        records_provider: Callable[[], list[dict[str, Any]]],
    ) -> None:
        self.state_root = state_root
        self.source = source
        self.records_provider = records_provider
        self.config_path = state_root / "config" / "prospect-desk-sync.json"
        self.sync_state_path = state_root / "sync" / f"{source}.json"
        self._wake = threading.Event()
        self._lock = threading.RLock()
        self._thread: threading.Thread | None = None
        self._running = False
        self._status: dict[str, Any] = {
            "enabled": False,
            "configured": False,
            "source": source,
            "endpoint_host": "",
            "interval_seconds": DEFAULT_INTERVAL_SECONDS,
            "pending_records": 0,
            "last_attempt_at": "",
            "last_success_at": "",
            "last_error": "",
            "last_submitted": 0,
            "last_created": 0,
            "last_updated": 0,
            "last_unchanged": 0,
            "last_rejected": 0,
            "total_successful_batches": 0,
        }

    def start(self) -> None:
        with self._lock:
            if self._thread and self._thread.is_alive():
                return
            self._thread = threading.Thread(
                target=self._loop,
                name=f"prospect-desk-sync-{self.source}",
                daemon=True,
            )
            self._thread.start()
        self._wake.set()

    def notify(self) -> None:
        self._wake.set()

    def health(self) -> dict[str, Any]:
        with self._lock:
            return dict(self._status)

    def run_once_for_test(self) -> dict[str, Any]:
        self._sync_once()
        return self.health()

    def _loop(self) -> None:
        while True:
            config = ProspectDeskSyncConfig.from_file(self.config_path)
            self._update_config_status(config)
            wait_seconds = config.interval_seconds if config.enabled else DEFAULT_INTERVAL_SECONDS
            self._wake.wait(wait_seconds)
            self._wake.clear()
            try:
                self._sync_once()
            except Exception as error:  # noqa: BLE001 - sync must never stop the collector
                self._set_status(last_error=self._safe_error(error))

    def _sync_once(self) -> None:
        config = ProspectDeskSyncConfig.from_file(self.config_path)
        self._update_config_status(config)
        if not config.enabled or self.source not in config.sources:
            return
        try:
            config.validate_for_source(self.source)
        except ValueError as error:
            self._set_status(last_error=str(error)[:300])
            return

        records = self.records_provider()
        fingerprints = self._load_fingerprints()
        pending: list[tuple[dict[str, Any], str, str]] = []
        for record in records:
            qualification = record.get("qualification") if isinstance(record.get("qualification"), dict) else {}
            if qualification.get("disposition") == "reject":
                continue
            dedupe_key = str(record.get("dedupe_key", "")).strip()
            if not dedupe_key:
                continue
            fingerprint = _record_fingerprint(record)
            if fingerprints.get(dedupe_key) == fingerprint:
                continue
            pending.append((record, dedupe_key, fingerprint))

        self._set_status(pending_records=len(pending), last_error="")
        if not pending:
            return

        for offset in range(0, len(pending), MAX_BATCH_RECORDS):
            batch = pending[offset : offset + MAX_BATCH_RECORDS]
            self._submit_batch(config, batch)
            for _record, dedupe_key, fingerprint in batch:
                fingerprints[dedupe_key] = fingerprint
            self._persist_fingerprints(fingerprints)
        self._set_status(pending_records=0)

    def _submit_batch(
        self,
        config: ProspectDeskSyncConfig,
        batch: list[tuple[dict[str, Any], str, str]],
    ) -> None:
        payload = {
            "schema_version": SYNC_SCHEMA_VERSION,
            "source": self.source,
            "external_action_performed": False,
            "records": [record for record, _dedupe_key, _fingerprint in batch],
        }
        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        request = Request(
            config.endpoint,
            data=body,
            method="POST",
            headers={
                "Authorization": f"Bearer {config.token}",
                "Content-Type": "application/json",
                "Accept": "application/json",
                "User-Agent": "Codistan-Acquisition-V4/0.2.0",
            },
        )
        self._set_status(last_attempt_at=_utc_now_iso(), last_submitted=len(batch), last_error="")
        try:
            with urlopen(request, timeout=30) as response:  # noqa: S310 - endpoint is validated HTTPS/localhost
                raw = response.read(1_000_000).decode("utf-8")
                value = json.loads(raw) if raw else {}
                if not isinstance(value, dict) or value.get("ok") is not True:
                    raise ValueError("Prospect Desk returned an invalid sync response.")
        except HTTPError as error:
            raise RuntimeError(f"Prospect Desk sync returned HTTP {error.code}.") from error
        except URLError as error:
            raise RuntimeError("Prospect Desk sync endpoint is unreachable.") from error
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise RuntimeError("Prospect Desk sync returned invalid JSON.") from error

        with self._lock:
            self._status["last_success_at"] = _utc_now_iso()
            self._status["last_error"] = ""
            self._status["last_created"] = max(0, int(value.get("created", 0) or 0))
            self._status["last_updated"] = max(0, int(value.get("updated", 0) or 0))
            self._status["last_unchanged"] = max(0, int(value.get("unchanged", 0) or 0))
            self._status["last_rejected"] = max(0, int(value.get("rejected", 0) or 0))
            self._status["total_successful_batches"] = int(self._status.get("total_successful_batches", 0)) + 1

    def _update_config_status(self, config: ProspectDeskSyncConfig) -> None:
        host = urlsplit(config.endpoint).hostname or ""
        configured = bool(config.endpoint and config.token and len(config.token) >= 32)
        self._set_status(
            enabled=config.enabled and self.source in config.sources,
            configured=configured,
            endpoint_host=host[:200],
            interval_seconds=config.interval_seconds,
        )

    def _load_fingerprints(self) -> dict[str, str]:
        value = _load_json(self.sync_state_path)
        fingerprints = value.get("fingerprints") if isinstance(value.get("fingerprints"), dict) else {}
        return {
            str(key): str(fingerprint)
            for key, fingerprint in fingerprints.items()
            if str(key).strip() and str(fingerprint).strip()
        }

    def _persist_fingerprints(self, fingerprints: dict[str, str]) -> None:
        _atomic_json(
            self.sync_state_path,
            {
                "version": STATE_VERSION,
                "source": self.source,
                "updated_at": _utc_now_iso(),
                "fingerprints": fingerprints,
            },
        )

    def _set_status(self, **updates: Any) -> None:
        with self._lock:
            self._status.update(updates)

    @staticmethod
    def _safe_error(error: Exception) -> str:
        if isinstance(error, ValueError):
            return str(error)[:300]
        return f"{error.__class__.__name__}: Prospect Desk sync failed"[:300]
