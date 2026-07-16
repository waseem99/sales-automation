from __future__ import annotations

from typing import Iterable, Protocol

from ..models import SourceEvidence


class AcquisitionAdapter(Protocol):
    adapter_id: str

    def collect(self, *, limit: int, enabled_segments: set[str]) -> Iterable[SourceEvidence]: ...
