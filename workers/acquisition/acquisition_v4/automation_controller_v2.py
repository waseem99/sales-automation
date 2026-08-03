from __future__ import annotations

from datetime import timedelta
import secrets
import threading
import time
from typing import Any

from .automation_controller import (
    AutomationController as BaseAutomationController,
    AutomationHandler,
    AutomationServer,
    COMBINED_INTERVAL_SECONDS,
    SALES_NAV_INTERVAL_SECONDS,
    SourceResult,
    safe_int,
    safe_text,
    utc_iso,
    utc_now,
)
from .review_v5 import write_review_outputs


class AutomationController(BaseAutomationController):
    """Sequential controller with controller-owned extension handoffs.

    The HTTP endpoint is bound before the first cycle starts, source events are
    accepted only for the active cycle, and the controller—not one extension—
    launches each subsequent source trigger.
    """

    def start(self) -> None:
        with self.lock:
            if self.thread and self.thread.is_alive():
                return
            self.paused = False
            self.stop_event.clear()
            self.run_requested.set()
            self.next_combined_at = utc_now()

            self.server = AutomationServer(("127.0.0.1", self.port), AutomationHandler)
            self.server.controller = self
            self.server_thread = threading.Thread(
                target=self.server.serve_forever,
                kwargs={"poll_interval": 0.25},
                name="codistan-automation-control-http",
                daemon=True,
            )
            self.thread = threading.Thread(
                target=self._loop,
                name="codistan-automation-controller",
                daemon=True,
            )
            self.server_thread.start()
            self.thread.start()
            self._persist_status()

    def report_event(self, payload: dict[str, Any]) -> dict[str, Any]:
        source = safe_text(payload.get("source"), 50).lower()
        cycle_id = safe_text(payload.get("cycle_id"), 120)
        with self.condition:
            if not self.running_cycle_id or cycle_id != self.running_cycle_id:
                raise ValueError("The automation event does not belong to the active cycle.")
            if source != self.running_source:
                raise ValueError("The automation event does not match the active source stage.")
        return super().report_event(payload)

    def _run_combined_cycle(self) -> None:
        cycle_id = f"capture-{int(time.time())}-{secrets.token_hex(4)}"
        started_at = utc_iso()
        config = self._browser_config()
        upwork_id = safe_text(config.get("upwork_extension_id"), 120)
        linkedin_id = safe_text(config.get("linkedin_sales_navigator_extension_id"), 120)
        source_results: dict[str, dict[str, Any]] = {}

        with self.lock:
            self.running_cycle_id = cycle_id
            self.running_source = "upwork"
            self._persist_status()

        upwork_query = f"cycle_id={cycle_id}&controller_port={self.port}&source=upwork"
        self._launch_extension_page(upwork_id, "automation-trigger.html", upwork_query)
        upwork = self._wait_for_source(cycle_id, "upwork")
        source_results["upwork"] = upwork.as_dict()

        if not self.stop_event.is_set():
            with self.lock:
                self.running_source = "linkedin"
                self._persist_status()
            linkedin_query = f"cycle_id={cycle_id}&controller_port={self.port}&source=linkedin"
            self._launch_extension_page(linkedin_id, "automation-trigger.html", linkedin_query)
            linkedin = self._wait_for_source(cycle_id, "linkedin")
            source_results["linkedin"] = linkedin.as_dict()

        now = utc_now()
        sales_nav_due = now >= self.next_sales_nav_at
        if sales_nav_due and not self.stop_event.is_set():
            with self.lock:
                self.running_source = "sales_navigator"
                self._persist_status()
            sales_query = f"cycle_id={cycle_id}&controller_port={self.port}&source=sales_navigator"
            self._launch_extension_page(linkedin_id, "automation-trigger.html", sales_query)
            sales_nav = self._wait_for_source(cycle_id, "sales_navigator")
            source_results["sales_navigator"] = sales_nav.as_dict()
            self.last_sales_nav_at = now
            self.next_sales_nav_at = now + timedelta(seconds=SALES_NAV_INTERVAL_SECONDS)

        write_review_outputs(self.state_root)
        completed_at = utc_iso()
        errors = [
            result.get("last_error")
            for result in source_results.values()
            if result.get("status") != "completed" or result.get("last_error")
        ]
        status_value = "completed_with_source_errors" if errors else "completed"
        totals = {
            key: sum(safe_int(result.get(key)) for result in source_results.values())
            for key in ("accepted", "duplicates", "enriched", "rejected", "detail_enriched")
        }

        with self.lock:
            self.last_cycle = {
                "cycle_id": cycle_id,
                "status": status_value,
                "started_at": started_at,
                "completed_at": completed_at,
                "sources": source_results,
                "totals": totals,
                "last_error": "; ".join(str(error) for error in errors if error)[:500],
            }
            self.running_cycle_id = ""
            self.running_source = ""
            self.next_combined_at = utc_now() + timedelta(seconds=COMBINED_INTERVAL_SECONDS)
            self._persist_status()


__all__ = ["AutomationController", "SourceResult"]
