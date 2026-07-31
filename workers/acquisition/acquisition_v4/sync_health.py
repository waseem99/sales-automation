from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
from typing import Any
from urllib.parse import urlsplit

SYNC_HEALTH_VERSION = "sync-health.v1"
EXPECTED_RECONCILIATION_VERSION = "acquisition-reconciliation.v1"
SOURCES = ("linkedin", "upwork", "sales_navigator")
REPLAYABLE_STATUSES = {"pending", "retrying", "dead_letter"}
SECRET_KEY = re.compile(r"token|cookie|authorization|password|secret|credential|csrf|session|private.?message|message.?body", re.I)
BEARER = re.compile(r"Bearer\s+\S+", re.I)
URL_SECRET = re.compile(r"([?&](?:token|key|secret|auth|signature)=)[^&\s]+", re.I)


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _parse_iso(value: Any) -> datetime | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed.astimezone(timezone.utc) if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _load_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
        return value if isinstance(value, dict) else {}
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        return {}


def _atomic_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    temp.replace(path)


def _load_json_lines(path: Path, limit: int = 5000) -> list[dict[str, Any]]:
    try:
        lines = path.read_text(encoding="utf-8").splitlines()[-limit:]
    except (OSError, UnicodeDecodeError):
        return []
    output: list[dict[str, Any]] = []
    for line in lines:
        try:
            value = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict):
            output.append(value)
    return output


def redact_diagnostic(value: Any, depth: int = 0) -> str:
    if depth > 3:
        return "[depth-limited]"
    if value is None:
        return ""
    if isinstance(value, str):
        return URL_SECRET.sub(r"\1[redacted]", BEARER.sub("Bearer [redacted]", value))[:500]
    if isinstance(value, (int, float, bool)):
        return str(value)
    if isinstance(value, list):
        return "; ".join(redact_diagnostic(item, depth + 1) for item in value[:20])[:500]
    if isinstance(value, dict):
        parts: list[str] = []
        for key, item in list(value.items())[:30]:
            if SECRET_KEY.search(str(key)):
                parts.append(f"{key}=[redacted]")
            else:
                parts.append(f"{key}={redact_diagnostic(item, depth + 1)}")
        return "; ".join(parts)[:500]
    return str(value)[:500]


def collect_sync_health(state_root: Path, source: str, *, collected_at: str | None = None) -> dict[str, Any]:
    if source not in SOURCES:
        raise ValueError(f"Unsupported sync source: {source}")
    collected_at = collected_at or _utc_now_iso()
    outbox_path = state_root / "sync" / "outbox" / f"{source}.json"
    reconciliation_path = state_root / "sync" / "reconciliation" / f"{source}.jsonl"
    config_path = state_root / "config" / "prospect-desk-sync.json"
    outbox_file = _load_json(outbox_path)
    entries_value = outbox_file.get("entries") if isinstance(outbox_file.get("entries"), dict) else {}
    entries = {str(key): item for key, item in entries_value.items() if isinstance(item, dict)}
    reconciliation = _load_json_lines(reconciliation_path)
    config = _load_json(config_path)

    endpoint = str(config.get("endpoint", "")).strip()
    parsed_endpoint = urlsplit(endpoint) if endpoint else None
    endpoint_host = (parsed_endpoint.hostname or "")[:200] if parsed_endpoint else ""
    endpoint_path = (parsed_endpoint.path or "")[:300] if parsed_endpoint else ""
    versions = [str(item.get("version", "")).strip() for item in reconciliation if str(item.get("version", "")).strip()]
    endpoint_version = versions[-1] if versions else ""

    status_counts = {name: 0 for name in ("pending", "retrying", "dead_letter", "conflicted")}
    records: list[dict[str, Any]] = []
    diagnostics: list[str] = []
    latencies: list[int] = []
    for key, item in sorted(entries.items()):
        status = str(item.get("status", "pending"))
        if status in status_counts:
            status_counts[status] += 1
        created = _parse_iso(item.get("created_at"))
        updated = _parse_iso(item.get("updated_at"))
        if created and updated and updated >= created:
            latencies.append(round((updated - created).total_seconds() * 1000))
        last_error = redact_diagnostic(item.get("last_error"))
        if last_error:
            diagnostics.append(last_error)
        records.append({
            "idempotencyKey": key[:180],
            "dedupeKeyHash": hashlib.sha256(str(item.get("dedupe_key", "")).encode("utf-8")).hexdigest()[:24],
            "status": status if status in status_counts else "pending",
            "attempts": max(0, int(item.get("attempts", 0) or 0)),
            "nextRetryAt": str(item.get("next_attempt_at", "")) or None,
            "createdAt": str(item.get("created_at", "")) or None,
            "updatedAt": str(item.get("updated_at", "")) or None,
            "lastError": last_error or None,
        })

    reconciliation_counts = {name: 0 for name in ("applied", "duplicate", "merged", "failed", "conflicted")}
    last_successful: datetime | None = None
    last_attempt: datetime | None = None
    for item in reconciliation:
        status = str(item.get("status", ""))
        occurred = _parse_iso(item.get("occurred_at"))
        if occurred and (last_attempt is None or occurred > last_attempt):
            last_attempt = occurred
        if status in reconciliation_counts:
            reconciliation_counts[status] += 1
        if status in {"applied", "duplicate", "merged"} and occurred and (last_successful is None or occurred > last_successful):
            last_successful = occurred
        reason = redact_diagnostic(item.get("reason"))
        if reason and status in {"failed", "conflicted"}:
            diagnostics.append(reason)

    enabled = config.get("enabled") is True and source in [str(item) for item in config.get("sources", [])]
    configured = bool(endpoint_host and len(str(config.get("token", ""))) >= 32)
    pending_total = status_counts["pending"] + status_counts["retrying"]
    blocked = status_counts["dead_letter"] > 0 or status_counts["conflicted"] > 0
    endpoint_mismatch = bool(endpoint_version and endpoint_version != EXPECTED_RECONCILIATION_VERSION)
    snapshot = {
        "version": SYNC_HEALTH_VERSION,
        "source": source,
        "collectedAt": collected_at,
        "capture": "healthy" if enabled else "blocked",
        "localProcessing": "healthy" if configured else "blocked",
        "outbox": "blocked" if blocked else "degraded" if pending_total else "healthy",
        "prospectDeskIngestion": "blocked" if endpoint_mismatch else "degraded" if reconciliation_counts["failed"] else "healthy" if last_successful else "unknown",
        "endpointHost": endpoint_host or None,
        "endpointPath": endpoint_path or None,
        "endpointVersion": endpoint_version or None,
        "pending": status_counts["pending"],
        "retrying": status_counts["retrying"],
        "deadLetter": status_counts["dead_letter"],
        "conflicted": status_counts["conflicted"],
        "applied": reconciliation_counts["applied"],
        "duplicates": reconciliation_counts["duplicate"],
        "merged": reconciliation_counts["merged"],
        "failed": reconciliation_counts["failed"],
        "lastAttemptAt": last_attempt.isoformat() if last_attempt else None,
        "lastSuccessfulSyncAt": last_successful.isoformat() if last_successful else None,
        "averageLatencyMs": round(sum(latencies) / len(latencies)) if latencies else None,
        "records": records[:500],
        "diagnostics": list(dict.fromkeys(diagnostics))[:100],
        "stateRootPreserved": True,
        "humanReviewRequired": True,
        "externalActionAutomated": False,
    }
    return snapshot


def collect_all_sync_health(state_root: Path, *, collected_at: str | None = None) -> list[dict[str, Any]]:
    return [collect_sync_health(state_root, source, collected_at=collected_at) for source in SOURCES]


def prepare_safe_replay(
    state_root: Path,
    source: str,
    idempotency_keys: list[str],
    *,
    actor: str,
    permission_confirmed: bool,
    requested_at: str | None = None,
) -> dict[str, Any]:
    if source not in SOURCES:
        raise ValueError(f"Unsupported sync source: {source}")
    if not permission_confirmed:
        raise PermissionError("Explicit replay permission is required.")
    actor = actor.strip()
    if not actor:
        raise ValueError("actor is required.")
    requested_at = requested_at or _utc_now_iso()
    outbox_path = state_root / "sync" / "outbox" / f"{source}.json"
    value = _load_json(outbox_path)
    entries_value = value.get("entries") if isinstance(value.get("entries"), dict) else {}
    entries = {str(key): dict(item) for key, item in entries_value.items() if isinstance(item, dict)}
    requested = list(dict.fromkeys(key.strip() for key in idempotency_keys if key.strip()))[:25]
    if not requested:
        raise ValueError("At least one idempotency key is required.")

    replayed: list[str] = []
    skipped: list[dict[str, str]] = []
    for key in requested:
        item = entries.get(key)
        if not item:
            skipped.append({"idempotencyKey": key, "reason": "Record is not present in the durable outbox."})
            continue
        status = str(item.get("status", "pending"))
        if status not in REPLAYABLE_STATUSES:
            skipped.append({"idempotencyKey": key, "reason": "Conflicted records require manual seller-field resolution."})
            continue
        history = item.get("replay_history") if isinstance(item.get("replay_history"), list) else []
        history.append({
            "actor": actor,
            "requested_at": requested_at,
            "prior_status": status,
            "prior_attempts": int(item.get("attempts", 0) or 0),
        })
        item["status"] = "pending"
        item["next_attempt_at"] = requested_at
        item["updated_at"] = requested_at
        item["last_error"] = ""
        item["replay_history"] = history[-20:]
        entries[key] = item
        replayed.append(key)

    _atomic_json(outbox_path, {
        "version": int(value.get("version", 1) or 1),
        "source": source,
        "updated_at": requested_at,
        "entries": entries,
        "external_action_automated": False,
    })
    material = json.dumps({"source": source, "actor": actor, "requestedAt": requested_at, "replayed": replayed, "skipped": skipped}, sort_keys=True)
    return {
        "version": "sync-replay-execution.v1",
        "source": source,
        "actor": actor,
        "requestedAt": requested_at,
        "replayed": replayed,
        "skipped": skipped,
        "idempotencyKeysPreserved": True,
        "sourceEvidencePreserved": True,
        "stateRootPreserved": True,
        "permissionConfirmed": True,
        "humanReviewRequired": True,
        "externalActionAutomated": False,
        "executionHash": hashlib.sha256(material.encode("utf-8")).hexdigest(),
    }
