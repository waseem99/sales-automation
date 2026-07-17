from __future__ import annotations

import json
from pathlib import Path
import tempfile
import unittest

from acquisition.upwork_extension_service import (
    APPROVED_SAVED_SEARCHES,
    CaptureServiceState,
    SEARCH_PATHS,
    _search_for_page,
    _segment_for_page,
)


class NormalChromeCaptureTests(unittest.TestCase):
    def test_maps_only_the_three_exact_saved_searches(self) -> None:
        expected = {
            "/nx/find-work/9652811": {
                "segment": "ai-jobs",
                "profile_owner": "Waseem",
                "saved_search_name": "AI + Fullstack AI 16 July 2026",
            },
            "/nx/find-work/9652860": {
                "segment": "roshana-2d-3d",
                "profile_owner": "Roshana",
                "saved_search_name": "3D Design & Creatives 15 July 2026",
            },
            "/nx/find-work/9652877": {
                "segment": "nadir-game-ar-vr",
                "profile_owner": "Nadir",
                "saved_search_name": "Game & AR/VR 16 July 2026",
            },
        }
        self.assertEqual(SEARCH_PATHS, {path: item["segment"] for path, item in expected.items()})
        self.assertEqual(set(APPROVED_SAVED_SEARCHES), set(expected))
        for path, identity in expected.items():
            search = _search_for_page(f"https://www.upwork.com{path}")
            self.assertIsNotNone(search)
            assert search is not None
            self.assertEqual(search.segment, identity["segment"])
            self.assertEqual(search.profile_owner, identity["profile_owner"])
            self.assertEqual(search.saved_search_name, identity["saved_search_name"])
            self.assertEqual(_segment_for_page(f"https://www.upwork.com{path}/"), identity["segment"])

    def test_rejects_generic_or_wrong_upwork_pages(self) -> None:
        self.assertIsNone(_segment_for_page("https://www.upwork.com/nx/find-work/"))
        self.assertIsNone(_segment_for_page("https://www.upwork.com/nx/find-work/best-matches"))
        self.assertIsNone(_segment_for_page("https://example.com/nx/find-work/9652811"))

    def test_extension_is_exact_search_auto_capture_version(self) -> None:
        root = Path(__file__).resolve().parents[1]
        manifest = json.loads((root / "browser-extension" / "manifest.json").read_text(encoding="utf-8"))
        background = (root / "browser-extension" / "background.js").read_text(encoding="utf-8")
        self.assertEqual(manifest["version"], "0.5.0")
        self.assertEqual(manifest["background"]["service_worker"], "background.js")
        self.assertIn("http://127.0.0.1:8765/*", manifest["host_permissions"])
        self.assertIn("AI + Fullstack AI 16 July 2026", background)
        self.assertIn("3D Design & Creatives 15 July 2026", background)
        self.assertIn("Game & AR/VR 16 July 2026", background)

    def test_extension_does_not_navigate_or_mimic_human_activity(self) -> None:
        root = Path(__file__).resolve().parents[1]
        background = (root / "browser-extension" / "background.js").read_text(encoding="utf-8").casefold()
        prohibited = (
            "chrome.tabs.create",
            "chrome.tabs.update",
            "navigator.webdriver",
            "mousemove",
            "dispatch_event",
            "dispatchevent",
            "math.random",
            "cloudflare",
            "captcha",
        )
        for marker in prohibited:
            self.assertNotIn(marker, background)

    def test_processor_only_setup_does_not_install_playwright(self) -> None:
        root = Path(__file__).resolve().parents[1]
        setup = (root / "scripts" / "windows" / "setup-normal-chrome-worker.ps1").read_text(encoding="utf-8")
        lowered = setup.casefold()
        self.assertNotIn("playwright install", lowered)
        self.assertNotIn(".[browser]", lowered)
        self.assertIn('pip install -e "."', setup)

    def test_capture_writes_identity_report_and_deduplicates_immediately(self) -> None:
        root = Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory() as directory:
            temp = Path(directory)
            output = temp / "output"
            checkpoint = temp / "seen.json"
            state = CaptureServiceState(
                config_path=root / "config" / "upwork-automation.toml",
                qualification_config_path=root / "config" / "qualification.example.toml",
                output_directory=output,
                checkpoint_path=checkpoint,
                state_directory=temp / "state",
            )
            payload = {
                "segment": "ai-jobs",
                "profile_owner": "Waseem",
                "saved_search_name": "AI + Fullstack AI 16 July 2026",
                "saved_search_path": "/nx/find-work/9652811",
                "page_url": "https://www.upwork.com/nx/find-work/9652811",
                "page_title": "AI + Fullstack AI 16 July 2026",
                "trigger": "test",
                "cards": [{
                    "source_url": "https://www.upwork.com/jobs/AI-Agent_~022077770760696635841/",
                    "title": "AI Voice Agent for SaaS Product",
                    "description": (
                        "Build a production AI voice agent for our SaaS product with website knowledge, "
                        "customer support workflows, integrations, analytics and a long-term enhancement roadmap."
                    ),
                    "card_text": (
                        "Posted 20 minutes ago Proposals: 5 to 10 Fixed-price Expert "
                        "Est. Budget: $8,000 Payment verified $50K+ spent United States "
                        "AI Voice Agent for SaaS Product"
                    ),
                    "skills": ["AI Agent Development", "Voice AI"],
                }],
            }
            first = state.capture(payload)
            second = state.capture(payload)

            self.assertEqual(first["accepted"], 1)
            self.assertEqual(first["profile_owner"], "Waseem")
            self.assertEqual(first["saved_search_name"], "AI + Fullstack AI 16 July 2026")
            self.assertEqual(sum(first["priority_counts"].values()), 1)
            self.assertTrue((output / "report.html").exists())
            opportunities = json.loads((output / "opportunities.json").read_text(encoding="utf-8"))
            attributes = opportunities[0]["record"]["evidence"]["attributes"]
            self.assertEqual(attributes["upwork_profile_owner"], "Waseem")
            self.assertEqual(attributes["upwork_saved_search_name"], "AI + Fullstack AI 16 July 2026")
            self.assertTrue(checkpoint.exists())
            self.assertEqual(second["accepted"], 0)
            self.assertEqual(second["duplicates"], 1)

    def test_rejects_mismatched_saved_search_identity(self) -> None:
        root = Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory() as directory:
            temp = Path(directory)
            state = CaptureServiceState(
                config_path=root / "config" / "upwork-automation.toml",
                qualification_config_path=root / "config" / "qualification.example.toml",
                output_directory=temp / "output",
                checkpoint_path=temp / "seen.json",
                state_directory=temp / "state",
            )
            with self.assertRaisesRegex(ValueError, "profile owner"):
                state.capture({
                    "segment": "ai-jobs",
                    "profile_owner": "Nadir",
                    "page_url": "https://www.upwork.com/nx/find-work/9652811",
                    "cards": [{}],
                })


if __name__ == "__main__":
    unittest.main()
