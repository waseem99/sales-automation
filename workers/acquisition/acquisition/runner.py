from __future__ import annotations

from dataclasses import dataclass
import logging

from .adapters.base import AcquisitionAdapter
from .checkpoints import CheckpointStore
from .deduplication import build_dedupe_key
from .models import OpportunityRecord, RunSummary
from .storage import OpportunitySink

LOGGER = logging.getLogger("acquisition.worker")


@dataclass(slots=True)
class AcquisitionRunner:
    adapter: AcquisitionAdapter
    sink: OpportunitySink
    checkpoints: CheckpointStore
    run_key: str

    def run(self, *, limit: int, enabled_segments: set[str]) -> RunSummary:
        summary = RunSummary()
        state = self.checkpoints.load(self.run_key)
        for evidence in self.adapter.collect(limit=limit, enabled_segments=enabled_segments):
            summary.reviewed += 1
            try:
                evidence.validate()
                key = build_dedupe_key(evidence)
                if key in state.seen_keys:
                    summary.duplicates += 1
                    continue
                record = OpportunityRecord(dedupe_key=key, evidence=evidence)
                self.sink.write(record)
                state.seen_keys.add(key)
                state.cursor = evidence.source_id
                self.checkpoints.save(self.run_key, state)
                summary.extracted += 1
                summary.ingested += 1
            except ValueError as error:
                summary.rejected += 1
                LOGGER.warning("record_rejected reason=%s", error.__class__.__name__)
            except Exception as error:
                summary.failed += 1
                LOGGER.error("record_failed error_type=%s", error.__class__.__name__)
        summary.finish()
        return summary
