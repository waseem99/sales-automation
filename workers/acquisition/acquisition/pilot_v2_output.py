from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .reporting import write_csv_report, write_html_report


def write_pilot_v2_outputs(
    *,
    output_directory: Path,
    summary: Any,
    items: list[Any],
    config_version: str,
) -> None:
    output_directory.mkdir(parents=True, exist_ok=True)
    priority_counts = {"A": 0, "B": 0, "C": 0}
    for item in items:
        priority = item.qualification.priority
        priority_counts[priority] = priority_counts.get(priority, 0) + 1

    payload = {
        "schema_version": "upwork-bd-pilot-report.v3",
        "config_version": config_version,
        "summary": summary.to_dict(),
        "priority_counts": priority_counts,
        "items": [item.to_dict() for item in items],
        "dashboard_ingestion": {
            "enabled": False,
            "eligibility": "priority A or B only",
            "reason": "Dry-run review approval is required before dashboard ingestion.",
        },
    }
    (output_directory / "opportunities.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True),
        encoding="utf-8",
    )
    (output_directory / "run-summary.json").write_text(
        json.dumps(
            {**summary.to_dict(), "priority_counts": priority_counts},
            indent=2,
            sort_keys=True,
        ),
        encoding="utf-8",
    )
    write_csv_report(output_directory / "opportunities.csv", items)
    with (output_directory / "dashboard-ready.jsonl").open("w", encoding="utf-8") as handle:
        for item in items:
            if item.qualification.priority not in {"A", "B"}:
                continue
            handle.write(json.dumps(item.to_dict(), ensure_ascii=False, sort_keys=True))
            handle.write("\n")
    write_html_report(output_directory / "report.html", summary, items)


def write_recoverable_snapshot(output_directory: Path, summary: Any, items: list[Any]) -> None:
    output_directory.mkdir(parents=True, exist_ok=True)
    path = output_directory / "capture-snapshot.json"
    temp = path.with_suffix(".json.tmp")
    temp.write_text(
        json.dumps(
            {
                "schema_version": "upwork-capture-snapshot.v1",
                "summary": summary.to_dict(),
                "items": [item.to_dict() for item in items],
            },
            ensure_ascii=False,
            indent=2,
            sort_keys=True,
        ),
        encoding="utf-8",
    )
    temp.replace(path)
