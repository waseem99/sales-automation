from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import hashlib
import json
from pathlib import Path
import threading
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from urllib.request import Request, urlopen

SYNC_SCHEMA_VERSION = "codistan-acquisition-sync.v1"
RECONCILIATION_VERSION = "acquisition-reconciliation.v1"
CONFIG_VERSION = 1
STATE_VERSION = 2
OUTBOX_VERSION = 1
MAX_BATCH_RECORDS = 25
MAX_RETRY_ATTEMPTS = 5
RETRY_DELAYS_SECONDS = (30, 60, 120, 300, 600)
DEFAULT_INTERVAL_SECONDS = 60
MIN_INTERVAL_SECONDS = 30
MAX_INTERVAL_SECONDS = 3600
TERMINAL_SUCCESS = {"applied", "duplicate", "merged"}
TERMINAL_CONFLICT = {"conflicted"}


def _utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(microsecond=0)


def _utc_now_iso() -> str:
    return _utc_now().isoformat()


def _atomic_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    temp.replace(path)


def _append_json_line(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as stream:
        stream.write(json.dumps(value, ensure_ascii=False, sort_keys=True) + "\n")


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


def _normalized_url(value: Any) -> str:
    raw = str(value or "").strip()
    if not raw:
        return ""
    try:
        parsed = urlsplit(raw)
        query = [
            (key, item)
            for key, item in parse_qsl(parsed.query, keep_blank_values=True)
            if not key.lower().startswith("utm_") and key.lower() not in {"trk", "rcm"}
        ]
        normalized = urlunsplit((
            parsed.scheme.lower(),
            parsed.netloc.lower(),
            parsed.path,
            urlencode(query),
            "",
        ))
        return normalized.rstrip("/").lower()
    except ValueError:
        return raw.rstrip("/").lower()


def _source_idempotency_key(source: str, record: dict[str, Any]) -> str:
    dedupe_key = str(record.get("dedupe_key", "")).strip().lower()
    material = "\n".join((source, dedupe_key, _normalized_url(record.get("canonical_url"))))
    return f"sync-{source}-{hashlib.sha256(material.encode('utf-8')).hexdigest()}"


def _parse_iso(value: Any) -> datetime | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed.astimezone(timezone.utc) if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


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
        self.outbox_path = state_root / "sync" / "outbox" / f"{source}.json"
        self.reconciliation_path = state_root / "sync" / "reconciliation" / f"{source}.jsonl"
        self._wake = threading.Event()
        self._lock = threading.RLock()
        self._thread: threading.Thread | None = None
        self._status: dict[str, Any] = {
            "enabled": False,
            "configured": False,
            "source": source,
            "endpoint_host": "",
            "interval_seconds": DEFAULT_INTERVAL_SECONDS,
            "pending_records": 0,
            "retrying_records": 0,
            "dead_letter_records": 0,
            "conflicted_records": 0,
            "last_attempt_at": "",
            "last_success_at": "",
            "last_error": "",
            "last_submitted": 0,
            "last_created": 0,
            "last_updated": 0,
            "last_unchanged": 0,
            "last_rejected": 0,
            "last_applied": 0,
            "last_duplicate": 0,
            "last_merged": 0,
            "last_conflicted": 0,
            "last_failed": 0,
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
        self._sync_once(force_due=True)
        return self.health()

    def _loop(self) -> None:
        while True:
            config = ProspectDeskSyncConfig.from_file(self.config_path)
            self._update_config_status(config)
            wait_seconds = config.interval_seconds if config.enabled else DEFAULT_INTERVAL_SECONDS
            self._wake.wait(wait_seconds)
            self._wake.clear()
            try:
                self._sync_once(force_due=False)
            except Exception as error:  # noqa: BLE001 - sync must never stop the collector
                self._set_status(last_error=self._safe_error(error))

    def _sync_once(self, *, force_due: bool) -> None:
        config = ProspectDeskSyncConfig.from_file(self.config_path)
        self._update_config_status(config)
        if not config.enabled or self.source not in config.sources:
            return
        try:
            config.validate_for_source(self.source)
        except ValueError as error:
            self._set_status(last_error=str(error)[:300])
            return

        fingerprints = self._load_fingerprints()
        outbox = self._load_outbox()
        changed = self._enqueue_records(self.records_provider(), fingerprints, outbox)
        if changed:
            self._persist_outbox(outbox)
        self._update_outbox_status(outbox)

        due = self._due_entries(outbox, force_due=force_due)
        if not due:
            return

        for offset in range(0, len(due), MAX_BATCH_RECORDS):
            batch = due[offset : offset + MAX_BATCH_RECORDS]
            try:
                outcomes, counters = self._submit_batch(config, batch)
            except Exception as error:  # noqa: BLE001 - preserve batch for bounded replay
                self._record_batch_failure(outbox, batch, error)
                self._persist_outbox(outbox)
                self._update_outbox_status(outbox)
                self._set_status(last_error=self._safe_error(error))
                continue
            self._apply_outcomes(outbox, fingerprints, batch, outcomes)
            self._persist_fingerprints(fingerprints)
            self._persist_outbox(outbox)
            self._update_outbox_status(outbox)
            self._set_status(
                last_success_at=_utc_now_iso(),
                last_error="",
                last_created=counters["created"],
                last_updated=counters["updated"],
                last_unchanged=counters["unchanged"],
                last_rejected=counters["rejected"],
                total_successful_batches=int(self.health().get("total_successful_batches", 0)) + 1,
            )

    def _enqueue_records(
        self,
        records: list[dict[str, Any]],
        fingerprints: dict[str, str],
        outbox: dict[str, dict[str, Any]],
    ) -> bool:
        changed = False
        now = _utc_now_iso()
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
            idempotency_key = _source_idempotency_key(self.source, record)
            existing = outbox.get(idempotency_key)
            if existing and existing.get("fingerprint") == fingerprint and existing.get("status") not in {"dead_letter", "conflicted"}:
                continue
            outbox[idempotency_key] = {
                "idempotency_key": idempotency_key,
                "dedupe_key": dedupe_key,
                "fingerprint": fingerprint,
                "record": record,
                "status": "pending",
                "attempts": 0,
                "next_attempt_at": now,
                "created_at": str(existing.get("created_at", now)) if existing else now,
                "updated_at": now,
                "last_error": "",
            }
            changed = True
        return changed

    def _due_entries(self, outbox: dict[str, dict[str, Any]], *, force_due: bool) -> list[dict[str, Any]]:
        now = _utc_now()
        entries: list[dict[str, Any]] = []
        for item in outbox.values():
            if item.get("status") not in {"pending", "retrying"}:
                continue
            next_attempt = _parse_iso(item.get("next_attempt_at"))
            if force_due or next_attempt is None or next_attempt <= now:
                entries.append(item)
        return sorted(entries, key=lambda item: (str(item.get("created_at", "")), str(item.get("idempotency_key", ""))))

    def _submit_batch(
        self,
        config: ProspectDeskSyncConfig,
        batch: list[dict[str, Any]],
    ) -> tuple[dict[str, dict[str, Any]], dict[str, int]]:
        records: list[dict[str, Any]] = []
        for item in batch:
            record = dict(item.get("record") if isinstance(item.get("record"), dict) else {})
            record["idempotency_key"] = item["idempotency_key"]
            records.append(record)
        payload = {
            "schema_version": SYNC_SCHEMA_VERSION,
            "source": self.source,
            "external_action_performed": False,
            "records": records,
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
                "User-Agent": "Codistan-Sales-Automation/1.0",
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

        outcomes = self._outcomes_from_response(value, batch)
        counters = {
            "created": max(0, int(value.get("created", 0) or 0)),
            "updated": max(0, int(value.get("updated", 0) or 0)),
            "unchanged": max(0, int(value.get("unchanged", 0) or 0)),
            "rejected": max(0, int(value.get("rejected", 0) or 0)),
        }
        return outcomes, counters

    def _outcomes_from_response(
        self,
        value: dict[str, Any],
        batch: list[dict[str, Any]],
    ) -> dict[str, dict[str, Any]]:
        reconciliation = value.get("reconciliation") if isinstance(value.get("reconciliation"), dict) else {}
        records = reconciliation.get("records") if isinstance(reconciliation.get("records"), list) else []
        outcomes: dict[str, dict[str, Any]] = {}
        for item in records:
            if not isinstance(item, dict):
                continue
            key = str(item.get("idempotencyKey", "")).strip()
            if key:
                outcomes[key] = {
                    "status": str(item.get("status", "pending")),
                    "reason": str(item.get("reason", ""))[:500],
                    "outcome": str(item.get("outcome", ""))[:100],
                }
        if outcomes:
            return outcomes
        fallback_status = "failed" if int(value.get("rejected", 0) or 0) >= len(batch) else "applied"
        for item in batch:
            outcomes[str(item["idempotency_key"])] = {
                "status": fallback_status,
                "reason": "Legacy Prospect Desk response accepted the idempotent batch." if fallback_status == "applied" else "Prospect Desk rejected the batch.",
                "outcome": "created" if fallback_status == "applied" else "rejected",
            }
        return outcomes

    def _apply_outcomes(
        self,
        outbox: dict[str, dict[str, Any]],
        fingerprints: dict[str, str],
        batch: list[dict[str, Any]],
        outcomes: dict[str, dict[str, Any]],
    ) -> None:
        counts = {"applied": 0, "duplicate": 0, "merged": 0, "conflicted": 0, "failed": 0}
        for item in batch:
            key = str(item["idempotency_key"])
            outcome = outcomes.get(key, {"status": "pending", "reason": "No terminal outcome returned.", "outcome": ""})
            status = str(outcome.get("status", "pending"))
            reason = str(outcome.get("reason", ""))[:500]
            if status in TERMINAL_SUCCESS:
                fingerprints[str(item["dedupe_key"])] = str(item["fingerprint"])
                outbox.pop(key, None)
                counts[status] += 1
            elif status in TERMINAL_CONFLICT:
                item["status"] = "conflicted"
                item["updated_at"] = _utc_now_iso()
                item["last_error"] = reason
                counts["conflicted"] += 1
            else:
                self._schedule_retry(item, reason or "Prospect Desk did not return a terminal success outcome.")
                counts["failed"] += 1
            self._record_reconciliation(item, status, reason, str(outcome.get("outcome", "")))
        self._set_status(
            last_applied=counts["applied"],
            last_duplicate=counts["duplicate"],
            last_merged=counts["merged"],
            last_conflicted=counts["conflicted"],
            last_failed=counts["failed"],
        )

    def _record_batch_failure(
        self,
        outbox: dict[str, dict[str, Any]],
        batch: list[dict[str, Any]],
        error: Exception,
    ) -> None:
        reason = self._safe_error(error)
        for item in batch:
            self._schedule_retry(item, reason)
            self._record_reconciliation(item, "failed", reason, "transport_failure")
            outbox[str(item["idempotency_key"])] = item

    def _schedule_retry(self, item: dict[str, Any], reason: str) -> None:
        attempts = int(item.get("attempts", 0)) + 1
        item["attempts"] = attempts
        item["updated_at"] = _utc_now_iso()
        item["last_error"] = reason[:500]
        if attempts >= MAX_RETRY_ATTEMPTS:
            item["status"] = "dead_letter"
            item["next_attempt_at"] = ""
            return
        item["status"] = "retrying"
        delay = RETRY_DELAYS_SECONDS[min(attempts - 1, len(RETRY_DELAYS_SECONDS) - 1)]
        item["next_attempt_at"] = (_utc_now() + timedelta(seconds=delay)).isoformat()

    def _record_reconciliation(self, item: dict[str, Any], status: str, reason: str, outcome: str) -> None:
        _append_json_line(self.reconciliation_path, {
            "version": RECONCILIATION_VERSION,
            "occurred_at": _utc_now_iso(),
            "source": self.source,
            "idempotency_key": item.get("idempotency_key"),
            "dedupe_key": item.get("dedupe_key"),
            "fingerprint": item.get("fingerprint"),
            "status": status,
            "outcome": outcome,
            "reason": reason[:500],
            "attempts": int(item.get("attempts", 0)),
            "seller_fields_preserved": True,
            "source_evidence_retained": True,
            "external_action_automated": False,
        })

    def _load_fingerprints(self) -> dict[str, str]:
        value = _load_json(self.sync_state_path)
        fingerprints = value.get("fingerprints") if isinstance(value.get("fingerprints"), dict) else {}
        return {
            str(key): str(fingerprint)
            for key, fingerprint in fingerprints.items()
            if str(key).strip() and str(fingerprint).strip()
        }

    def _persist_fingerprints(self, fingerprints: dict[str, str]) -> None:
        _atomic_json(self.sync_state_path, {
            "version": STATE_VERSION,
            "source": self.source,
            "updated_at": _utc_now_iso(),
            "fingerprints": fingerprints,
        })

    def _load_outbox(self) -> dict[str, dict[str, Any]]:
        value = _load_json(self.outbox_path)
        entries = value.get("entries") if isinstance(value.get("entries"), dict) else {}
        return {
            str(key): dict(item)
            for key, item in entries.items()
            if str(key).strip() and isinstance(item, dict)
        }

    def _persist_outbox(self, outbox: dict[str, dict[str, Any]]) -> None:
        _atomic_json(self.outbox_path, {
            "version": OUTBOX_VERSION,
            "source": self.source,
            "updated_at": _utc_now_iso(),
            "entries": outbox,
            "external_action_automated": False,
        })

    def _update_outbox_status(self, outbox: dict[str, dict[str, Any]]) -> None:
        pending = sum(1 for item in outbox.values() if item.get("status") in {"pending", "retrying"})
        retrying = sum(1 for item in outbox.values() if item.get("status") == "retrying")
        dead_letter = sum(1 for item in outbox.values() if item.get("status") == "dead_letter")
        conflicted = sum(1 for item in outbox.values() if item.get("status") == "conflicted")
        self._set_status(
            pending_records=pending,
            retrying_records=retrying,
            dead_letter_records=dead_letter,
            conflicted_records=conflicted,
        )

    def _update_config_status(self, config: ProspectDeskSyncConfig) -> None:
        host = urlsplit(config.endpoint).hostname or ""
        configured = bool(config.endpoint and config.token and len(config.token) >= 32)
        self._set_status(
            enabled=config.enabled and self.source in config.sources,
            configured=configured,
            endpoint_host=host[:200],
            interval_seconds=config.interval_seconds,
        )

    def _set_status(self, **updates: Any) -> None:
        with self._lock:
            self._status.update(updates)

    @staticmethod
    def _safe_error(error: Exception) -> str:
        if isinstance(error, ValueError):
            return str(error)[:300]
        return f"{error.__class__.__name__}: Prospect Desk sync failed"[:300]
