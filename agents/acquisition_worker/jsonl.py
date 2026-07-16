from __future__ import annotations

import json
from pathlib import Path
from typing import Iterable

from .models import Opportunity


def append_opportunities(path: str | Path, values: Iterable[Opportunity]) -> int:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    count = 0
    with target.open("a", encoding="utf-8") as handle:
        for value in values:
            handle.write(json.dumps(value.as_dict(), sort_keys=True, ensure_ascii=False))
            handle.write("\n")
            count += 1
    return count
