from __future__ import annotations

from pathlib import Path
from typing import Any

from . import review as _review


def load_combined_records(state_root: Path) -> list[dict[str, Any]]:
    records = [
        *_review._load_jsonl(state_root / "upwork" / "records.jsonl"),
        *_review._load_jsonl(state_root / "linkedin" / "records.jsonl"),
        *_review._load_jsonl(state_root / "sales_navigator" / "records.jsonl"),
    ]
    records.sort(key=_review._rank)
    return records


_review.load_combined_records = load_combined_records
write_review_outputs = _review.write_review_outputs

__all__ = ["load_combined_records", "write_review_outputs"]
