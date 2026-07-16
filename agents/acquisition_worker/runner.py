from __future__ import annotations

import json
import sys
from collections.abc import Callable, Iterable
from dataclasses import replace

from .checkpoint import Checkpoint
from .ingestion import DashboardIngestionClient
from .jsonl import append_opportunities
from .models import Opportunity, RunSummary
from .qualification import QualificationDecision
from .redaction import redact


Qualifier = Callable[[Opportunity], QualificationDecision]


def run_collection(
    opportunities: Iterable[Opportunity],
    checkpoint: Checkpoint,
    output_path: str,
    ingestion_client: DashboardIngestionClient | None = None,
    qualifier: Qualifier | None = None,
) -> RunSummary:
    summary = RunSummary()
    archived: list[Opportunity] = []
    accepted: list[Opportunity] = []
    rejected_keys: list[str] = []

    for opportunity in opportunities:
        summary.reviewed += 1
        try:
            if checkpoint.contains(opportunity.dedupe_key):
                summary.duplicates += 1
                continue
            summary.extracted += 1
            if qualifier is None:
                enriched = opportunity
                summary.qualified += 1
                accepted.append(enriched)
            else:
                decision = qualifier(opportunity)
                enriched = replace(
                    opportunity,
                    metadata={
                        **opportunity.metadata,
                        "qualification": decision.as_dict(),
                    },
                )
                if decision.disposition == "reject":
                    summary.rejected += 1
                    rejected_keys.append(opportunity.dedupe_key)
                    _event(
                        "opportunity_rejected",
                        {
                            "reason_codes": list(decision.risk_flags),
                            "disposition": decision.disposition,
                        },
                    )
                else:
                    summary.qualified += 1
                    accepted.append(enriched)
            archived.append(enriched)
        except Exception as error:
            summary.failed += 1
            _event("opportunity_failed", {"error_type": type(error).__name__})

    if archived:
        summary.written += append_opportunities(output_path, archived)

    for key in rejected_keys:
        checkpoint.mark_seen(key)

    for opportunity in accepted:
        if ingestion_client is not None:
            try:
                ingestion_client.ingest(opportunity)
                summary.ingested += 1
            except Exception as error:
                summary.failed += 1
                _event("ingestion_failed", {"error_type": type(error).__name__})
                continue
        checkpoint.mark_seen(opportunity.dedupe_key)

    checkpoint.save()
    _event("run_summary", summary.as_dict())
    return summary


def _event(name: str, value: object) -> None:
    print(json.dumps({"event": name, "data": redact(value)}, sort_keys=True), file=sys.stderr)
