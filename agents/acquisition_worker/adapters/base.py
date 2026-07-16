from __future__ import annotations

from collections.abc import Iterable
from typing import Protocol

from acquisition_worker.models import Opportunity


class OpportunityAdapter(Protocol):
    def collect(self) -> Iterable[Opportunity]:
        """Yield normalized opportunities from a source."""
