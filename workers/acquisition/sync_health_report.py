from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

from acquisition_v4.sync_health import collect_all_sync_health, collect_sync_health, prepare_safe_replay


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Inspect Codistan Sales Automation synchronization health without exposing source evidence or credentials.")
    parser.add_argument("--state-root", required=True, help="Existing Codistan Acquisition state root. The command never deletes or relocates it.")
    parser.add_argument("--source", choices=("linkedin", "upwork", "sales_navigator"))
    parser.add_argument("--replay-key", action="append", default=[], help="Idempotency key to reset to pending. May be specified up to 25 times.")
    parser.add_argument("--actor", help="Authenticated operator identity for an explicitly approved replay.")
    parser.add_argument("--allow-replay", action="store_true", help="Required explicit permission gate for replay preparation.")
    parser.add_argument("--json", action="store_true", help="Emit machine-readable JSON.")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    state_root = Path(args.state_root).expanduser().resolve()
    if args.replay_key:
        if not args.source:
            raise SystemExit("--source is required with --replay-key.")
        result = prepare_safe_replay(
            state_root,
            args.source,
            args.replay_key,
            actor=str(args.actor or ""),
            permission_confirmed=args.allow_replay,
        )
    else:
        result = collect_sync_health(state_root, args.source) if args.source else collect_all_sync_health(state_root)

    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True))
    else:
        values = result if isinstance(result, list) else [result]
        for item in values:
            print(f"{item.get('source', 'unknown')}: pending={item.get('pending', 0)} retrying={item.get('retrying', 0)} dead_letter={item.get('deadLetter', 0)} conflicted={item.get('conflicted', 0)} last_success={item.get('lastSuccessfulSyncAt') or 'never'}")
        print("State root preserved. No external sales action was performed.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ValueError, PermissionError) as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(2) from error
