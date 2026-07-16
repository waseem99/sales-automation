from __future__ import annotations

from dataclasses import dataclass
import json
import os
from pathlib import Path
from typing import Protocol
from urllib.request import Request, urlopen

from .models import OpportunityRecord


class OpportunitySink(Protocol):
    def write(self, record: OpportunityRecord) -> None: ...


@dataclass(slots=True)
class JsonlSink:
    path: Path

    def write(self, record: OpportunityRecord) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(record.to_dict(), ensure_ascii=False, sort_keys=True))
            handle.write("\n")


@dataclass(slots=True)
class HttpIngestionSink:
    endpoint: str
    token_env: str = "ACQUISITION_INGEST_TOKEN"
    timeout_seconds: float = 30.0

    def write(self, record: OpportunityRecord) -> None:
        token = os.environ.get(self.token_env, "").strip()
        if not token:
            raise RuntimeError(f"{self.token_env} is required for ingestion mode")
        body = json.dumps(record.to_dict()).encode("utf-8")
        request = Request(
            self.endpoint,
            data=body,
            method="POST",
            headers={
                "authorization": f"Bearer {token}",
                "content-type": "application/json",
                "user-agent": "codistan-acquisition-worker/0.1",
            },
        )
        with urlopen(request, timeout=self.timeout_seconds) as response:
            if response.status < 200 or response.status >= 300:
                raise RuntimeError(f"Ingestion endpoint returned HTTP {response.status}")
