from __future__ import annotations

import json
import os
from dataclasses import dataclass
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin
from urllib.request import Request, urlopen

from .models import Opportunity


@dataclass(slots=True)
class DashboardIngestionClient:
    base_url: str
    cookie: str
    timeout_seconds: float = 30.0

    @classmethod
    def from_environment(cls) -> "DashboardIngestionClient":
        base_url = os.environ.get("SA_DASHBOARD_BASE_URL", "").strip()
        cookie = os.environ.get("SA_DASHBOARD_COOKIE", "").strip()
        if not base_url:
            raise ValueError("SA_DASHBOARD_BASE_URL is required for ingestion")
        if not cookie:
            raise ValueError("SA_DASHBOARD_COOKIE is required for ingestion")
        return cls(base_url=base_url.rstrip("/") + "/", cookie=cookie)

    def build_payload(self, opportunity: Opportunity) -> dict[str, Any]:
        if opportunity.source in {"linkedin", "sales_navigator"}:
            return {
                "sourceKind": "linkedin_signal",
                "content": opportunity.description,
                "sourceUrl": opportunity.source_url,
                "title": opportunity.title,
                "companyName": opportunity.company_name,
                "country": opportunity.country,
            }
        return {
            "sourceKind": "auto_batch",
            "content": opportunity.intake_content(),
        }

    def ingest(self, opportunity: Opportunity) -> dict[str, Any]:
        endpoint = urljoin(self.base_url, "api/prospects/manual-intake")
        body = json.dumps(self.build_payload(opportunity)).encode("utf-8")
        request = Request(
            endpoint,
            data=body,
            method="POST",
            headers={
                "content-type": "application/json",
                "accept": "application/json",
                "cookie": self.cookie,
                "user-agent": "codistan-acquisition-worker/0.1",
            },
        )
        try:
            with urlopen(request, timeout=self.timeout_seconds) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except HTTPError as error:
            detail = error.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"dashboard ingestion failed with HTTP {error.code}: {detail[:200]}") from error
        except URLError as error:
            raise RuntimeError("dashboard ingestion could not reach the configured server") from error
        if not isinstance(payload, dict) or payload.get("ok") is not True:
            raise RuntimeError("dashboard ingestion returned an invalid response")
        if payload.get("externalActionAutomated") is not False:
            raise RuntimeError("dashboard ingestion safety contract was not confirmed")
        return payload
