from __future__ import annotations

import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from acquisition_v4.automation_controller import AutomationController
from acquisition_v4.qualification_router_v2 import _apply_route_resolution, route_scores
from acquisition_v4.review_v5 import write_review_outputs


class CaptureAutomationControllerTests(unittest.TestCase):
    def test_controller_persists_safe_status_and_token(self) -> None:
        with TemporaryDirectory() as directory:
            state_root = Path(directory)
            controller = AutomationController(state_root)
            status = controller.status()
            self.assertEqual(status["schema_version"], "codistan-capture-automation.v1")
            self.assertEqual(status["interval_minutes"], 15)
            self.assertEqual(status["sales_navigator_interval_hours"], 12)
            self.assertFalse(status["external_actions_enabled"])
            self.assertTrue((state_root / "status" / "automation-controller.json").exists())
            token = (state_root / "config" / "automation-control-token.txt").read_text(encoding="utf-8").strip()
            self.assertGreaterEqual(len(token), 32)

    def test_controller_control_is_explicit_and_state_preserving(self) -> None:
        with TemporaryDirectory() as directory:
            controller = AutomationController(Path(directory))
            self.assertTrue(controller.control("pause")["paused"])
            self.assertFalse(controller.control("resume")["paused"])
            self.assertFalse(controller.control("run_now")["paused"])
            with self.assertRaises(ValueError):
                controller.control("send_message")

    def test_fintech_software_request_routes_to_software_not_animation(self) -> None:
        record = {
            "source": "linkedin",
            "title": "Seeking IT service provider and development partner",
            "body": (
                "We are building a fraud analytics portal for NBFCs and small finance banks. "
                "We need scalable product development, backend APIs, platform engineering and fintech solutions."
            ),
            "commercial_evidence": {"service_lanes": ["creative_animation", "software_product"]},
            "raw_evidence": {"skills": ["Python", "API", "React"]},
        }
        scores = route_scores(record, ["creative_animation", "software_product"])
        self.assertGreater(scores["software_product"], scores["creative_animation"])
        decision = _apply_route_resolution(
            record,
            {
                "disposition": "priority_a",
                "service_lanes": ["creative_animation", "software_product"],
                "service_route": "creative_animation",
                "positive_reasons": ["service fit: creative_animation"],
                "missing_evidence": [],
                "risk_reasons": [],
            },
        )
        self.assertEqual(decision["service_route"], "software_product")
        self.assertNotEqual(decision["service_route"], "creative_animation")

    def test_ambiguous_priority_is_failed_closed_to_research(self) -> None:
        record = {
            "source": "linkedin",
            "title": "Looking for a partner",
            "body": "Need a software platform and animation studio for a combined campaign.",
            "commercial_evidence": {},
            "raw_evidence": {},
        }
        decision = _apply_route_resolution(
            record,
            {
                "disposition": "priority_a",
                "service_lanes": ["software_product", "creative_animation"],
                "positive_reasons": [],
                "missing_evidence": [],
                "risk_reasons": [],
            },
        )
        if decision["service_route_confidence"] == "low":
            self.assertEqual(decision["disposition"], "research")
            self.assertIn("clear service route", decision["missing_evidence"])

    def test_lead_desk_includes_status_and_operator_controls(self) -> None:
        with TemporaryDirectory() as directory:
            state_root = Path(directory)
            controller = AutomationController(state_root)
            controller.control("pause")
            result = write_review_outputs(state_root)
            html = Path(result["html_path"]).read_text(encoding="utf-8")
            queue = json.loads(Path(result["json_path"]).read_text(encoding="utf-8"))
            self.assertIn("Capture automation", html)
            self.assertIn("Run Capture Now", html)
            self.assertIn("Resume automated capture", html)
            self.assertIn("http://127.0.0.1:8795/control", html)
            self.assertIn("automation", queue)
            self.assertFalse(queue["automation"]["external_actions_enabled"])

    def test_extension_controller_contracts_are_bounded_and_self_cleaning(self) -> None:
        root = Path(__file__).resolve().parents[1]
        upwork_trigger = (root / "extensions" / "upwork" / "automation-trigger.js").read_text(encoding="utf-8")
        linkedin_trigger = (root / "extensions" / "linkedin" / "automation-trigger.js").read_text(encoding="utf-8")
        detail = (root / "extensions" / "upwork" / "detail-enrichment.js").read_text(encoding="utf-8")
        supervisor = (root / "acquisition_v4" / "supervisor.py").read_text(encoding="utf-8")

        for content in (upwork_trigger, linkedin_trigger):
            self.assertIn("/event", content)
            self.assertIn("chrome.tabs.remove", content)
            self.assertNotIn("submitProposal", content)
            self.assertNotIn("sendMessageToBuyer", content)
        self.assertIn("MAX_DETAIL_RECORDS = 5", detail)
        self.assertIn("active: false", detail)
        self.assertIn("chrome.tabs.remove", detail)
        self.assertIn("external_action_performed: false", detail)
        self.assertIn("AutomationController", supervisor)
        self.assertIn("127.0.0.1:8795/status", supervisor)

    def test_extension_manifests_pin_controller_permissions_and_versions(self) -> None:
        root = Path(__file__).resolve().parents[1]
        upwork = json.loads((root / "extensions" / "upwork" / "manifest.json").read_text(encoding="utf-8"))
        linkedin = json.loads((root / "extensions" / "linkedin" / "manifest.json").read_text(encoding="utf-8"))
        self.assertEqual(upwork["version"], "1.1.2")
        self.assertEqual(linkedin["version"], "1.6.2")
        self.assertEqual(upwork["background"]["service_worker"], "service-worker.js")
        self.assertIn("http://127.0.0.1:8795/*", upwork["host_permissions"])
        self.assertIn("http://127.0.0.1:8795/*", linkedin["host_permissions"])


if __name__ == "__main__":
    unittest.main()
