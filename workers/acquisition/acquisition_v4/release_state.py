from __future__ import annotations

import argparse
import hashlib
import json
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

from .storage import atomic_write_text

RELEASE_STATE_SCHEMA = "codistan-acquisition-release-state.v1"
PROTECTED_RELATIVE_PATHS = (
    "config/prospect-desk-sync.json",
    "upwork/records.jsonl",
    "upwork/seen.json",
    "linkedin/records.jsonl",
    "linkedin/seen.json",
    "sales_navigator/records.jsonl",
    "sales_navigator/seen.json",
)
REGENERABLE_RELATIVE_PATHS = (
    "upwork/status.json",
    "linkedin/status.json",
    "sales_navigator/status.json",
    "review/index.html",
    "runtime.pid",
    "watchdog.pid",
    "watchdog.lock",
)


@dataclass(frozen=True)
class StateComparison:
    preserved: bool
    missing_after: tuple[str, ...]
    changed: tuple[str, ...]
    added: tuple[str, ...]

    def as_dict(self) -> dict[str, object]:
        return {
            "preserved": self.preserved,
            "missing_after": list(self.missing_after),
            "changed": list(self.changed),
            "added": list(self.added),
        }


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def snapshot_state(state_root: Path) -> dict[str, object]:
    root = state_root.expanduser().resolve()
    files: dict[str, dict[str, object]] = {}
    for relative in PROTECTED_RELATIVE_PATHS:
        path = root / relative
        if not path.exists():
            files[relative] = {"exists": False}
            continue
        entry: dict[str, object] = {
            "exists": True,
            "size_bytes": path.stat().st_size,
            "sha256": sha256_file(path),
        }
        if relative.endswith("records.jsonl"):
            entry["record_count"] = count_jsonl_records(path)
        elif relative.endswith("seen.json"):
            entry["dedupe_count"] = count_json_list(path)
        elif relative == "config/prospect-desk-sync.json":
            entry["configuration"] = safe_sync_configuration(path)
        files[relative] = entry
    return {
        "schema_version": RELEASE_STATE_SCHEMA,
        "generated_at": utc_now(),
        "state_root": str(root),
        "protected_files": files,
        "regenerable_files": list(REGENERABLE_RELATIVE_PATHS),
    }


def compare_snapshots(before: dict[str, object], after: dict[str, object]) -> StateComparison:
    validate_snapshot(before)
    validate_snapshot(after)
    before_files = protected_files(before)
    after_files = protected_files(after)
    missing_after: list[str] = []
    changed: list[str] = []
    added: list[str] = []
    for relative, previous in before_files.items():
        current = after_files.get(relative, {"exists": False})
        if previous.get("exists") is True and current.get("exists") is not True:
            missing_after.append(relative)
            continue
        if previous.get("exists") is True and current.get("exists") is True:
            if previous.get("sha256") != current.get("sha256"):
                changed.append(relative)
        if previous.get("exists") is not True and current.get("exists") is True:
            added.append(relative)
    return StateComparison(
        preserved=not missing_after and not changed,
        missing_after=tuple(sorted(missing_after)),
        changed=tuple(sorted(changed)),
        added=tuple(sorted(added)),
    )


def verify_state(before_path: Path, state_root: Path) -> dict[str, object]:
    before = json.loads(before_path.read_text(encoding="utf-8"))
    after = snapshot_state(state_root)
    comparison = compare_snapshots(before, after)
    return {
        "schema_version": RELEASE_STATE_SCHEMA,
        "checked_at": utc_now(),
        "before_snapshot": str(before_path.resolve()),
        "comparison": comparison.as_dict(),
        "after": after,
    }


def write_json(path: Path, payload: dict[str, object]) -> None:
    atomic_write_text(path, json.dumps(payload, indent=2, sort_keys=True) + "\n")


def release_diagnostics(state_root: Path, release_manifest_path: Path) -> dict[str, object]:
    release = json.loads(release_manifest_path.read_text(encoding="utf-8"))
    validate_release_manifest(release)
    snapshot = snapshot_state(state_root)
    root = state_root.expanduser().resolve()
    app_slots = {
        name: application_slot_summary(root / name)
        for name in ("app-current", "app-previous")
    }
    source_summary: dict[str, object] = {}
    protected = protected_files(snapshot)
    for source in ("upwork", "linkedin", "sales_navigator"):
        records = protected[f"{source}/records.jsonl"]
        seen = protected[f"{source}/seen.json"]
        source_summary[source] = {
            "records_present": records.get("exists") is True,
            "record_count": records.get("record_count", 0),
            "records_sha256": records.get("sha256"),
            "dedupe_present": seen.get("exists") is True,
            "dedupe_count": seen.get("dedupe_count", 0),
            "dedupe_sha256": seen.get("sha256"),
            "status_present": (root / source / "status.json").exists(),
        }
    config = protected["config/prospect-desk-sync.json"].get("configuration", {})
    return {
        "schema_version": "codistan-acquisition-diagnostics.v1",
        "generated_at": utc_now(),
        "release": {
            "product_name": release["product_name"],
            "release_version": release["release_version"],
            "release_status": release["release_status"],
            "components": release["components"],
        },
        "application_slots": app_slots,
        "state": {
            "root": str(root),
            "sources": source_summary,
            "sync_configuration": config,
        },
        "privacy": {
            "opportunity_bodies_included": False,
            "credentials_included": False,
            "cookies_included": False,
            "sync_token_included": False,
        },
        "live_acceptance": {
            source["id"]: {
                "required": True,
                "status": source["acceptance_gate"],
            }
            for source in release["active_sources"]
        },
    }


def validate_release_manifest(value: object) -> None:
    if not isinstance(value, dict):
        raise ValueError("Release manifest must be a JSON object.")
    required = {
        "schema_version",
        "product_name",
        "release_version",
        "release_status",
        "components",
        "active_sources",
        "state_contract",
        "merge_gate",
    }
    missing = sorted(required - set(value))
    if missing:
        raise ValueError(f"Release manifest is missing: {', '.join(missing)}")
    if value.get("schema_version") != "codistan-acquisition-release.v1":
        raise ValueError("Unsupported release manifest schema.")
    if value.get("release_status") not in {"live-validation", "accepted", "rolled-back"}:
        raise ValueError("Release status is invalid.")
    sources = value.get("active_sources")
    if not isinstance(sources, list) or {item.get("id") for item in sources if isinstance(item, dict)} != {
        "upwork",
        "linkedin",
        "sales_navigator",
    }:
        raise ValueError("Release manifest must define exactly the three active acquisition sources.")
    if value.get("merge_gate", {}).get("main_update_allowed") is not False and value.get("release_status") == "live-validation":
        raise ValueError("A live-validation release must not allow a main update.")


def validate_snapshot(value: object) -> None:
    if not isinstance(value, dict) or value.get("schema_version") != RELEASE_STATE_SCHEMA:
        raise ValueError("Unsupported release-state snapshot.")
    files = value.get("protected_files")
    if not isinstance(files, dict):
        raise ValueError("Release-state snapshot is missing protected files.")
    missing_keys = sorted(set(PROTECTED_RELATIVE_PATHS) - set(files))
    if missing_keys:
        raise ValueError(f"Release-state snapshot is incomplete: {', '.join(missing_keys)}")


def protected_files(snapshot: dict[str, object]) -> dict[str, dict[str, object]]:
    value = snapshot["protected_files"]
    if not isinstance(value, dict):
        raise ValueError("Protected files are invalid.")
    return {
        str(key): item
        for key, item in value.items()
        if isinstance(item, dict)
    }


def count_jsonl_records(path: Path) -> int:
    count = 0
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        try:
            value = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict):
            count += 1
    return count


def count_json_list(path: Path) -> int:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return 0
    return len({str(item) for item in value}) if isinstance(value, list) else 0


def safe_sync_configuration(path: Path) -> dict[str, object]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"valid": False}
    if not isinstance(value, dict):
        return {"valid": False}
    return {
        "valid": True,
        "enabled": value.get("enabled") is True,
        "endpoint_configured": bool(str(value.get("endpoint", "")).strip()),
        "token_configured": bool(str(value.get("token", "")).strip()),
        "sources": sorted(str(item) for item in value.get("sources", []) if str(item).strip()),
        "interval_seconds": value.get("interval_seconds"),
    }


def application_slot_summary(path: Path) -> dict[str, object]:
    version_path = path / "workers" / "acquisition" / "VERSION"
    release_path = path / "workers" / "acquisition" / "RELEASE.json"
    version = version_path.read_text(encoding="utf-8").strip() if version_path.exists() else None
    release_status = None
    if release_path.exists():
        try:
            release = json.loads(release_path.read_text(encoding="utf-8"))
            release_status = release.get("release_status") if isinstance(release, dict) else None
        except json.JSONDecodeError:
            release_status = "invalid-manifest"
    return {
        "present": path.exists(),
        "version": version,
        "release_status": release_status,
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Verify and diagnose Codistan Acquisition release state.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    snapshot = subparsers.add_parser("snapshot", help="Write a protected-state snapshot.")
    snapshot.add_argument("--state-root", type=Path, required=True)
    snapshot.add_argument("--output", type=Path, required=True)

    verify = subparsers.add_parser("verify", help="Compare protected state with a previous snapshot.")
    verify.add_argument("--state-root", type=Path, required=True)
    verify.add_argument("--before", type=Path, required=True)
    verify.add_argument("--output", type=Path)

    diagnostics = subparsers.add_parser("diagnostics", help="Write redacted release diagnostics.")
    diagnostics.add_argument("--state-root", type=Path, required=True)
    diagnostics.add_argument("--release-manifest", type=Path, required=True)
    diagnostics.add_argument("--output", type=Path, required=True)

    validate = subparsers.add_parser("validate-manifest", help="Validate RELEASE.json.")
    validate.add_argument("--release-manifest", type=Path, required=True)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.command == "snapshot":
        write_json(args.output, snapshot_state(args.state_root))
        print(args.output)
        return 0
    if args.command == "verify":
        result = verify_state(args.before, args.state_root)
        if args.output:
            write_json(args.output, result)
        print(json.dumps(result["comparison"], indent=2, sort_keys=True))
        return 0 if result["comparison"]["preserved"] else 2
    if args.command == "diagnostics":
        write_json(args.output, release_diagnostics(args.state_root, args.release_manifest))
        print(args.output)
        return 0
    if args.command == "validate-manifest":
        value = json.loads(args.release_manifest.read_text(encoding="utf-8"))
        validate_release_manifest(value)
        print(f"VALID {value['product_name']} {value['release_version']} ({value['release_status']})")
        return 0
    raise AssertionError("Unhandled command")


if __name__ == "__main__":
    raise SystemExit(main())
