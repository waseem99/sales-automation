from __future__ import annotations

import json
from pathlib import Path
import unittest

from acquisition.upwork_extension_service import SEARCH_PATHS, _segment_for_page


class NormalChromeCaptureTests(unittest.TestCase):
    def test_maps_only_the_three_exact_saved_searches(self) -> None:
        expected = {
            "/nx/find-work/9652811": "ai-jobs",
            "/nx/find-work/9652860": "roshana-2d-3d",
            "/nx/find-work/9652877": "nadir-game-ar-vr",
        }
        self.assertEqual(SEARCH_PATHS, expected)
        for path, segment in expected.items():
            self.assertEqual(_segment_for_page(f"https://www.upwork.com{path}"), segment)
            self.assertEqual(_segment_for_page(f"https://www.upwork.com{path}/"), segment)

    def test_rejects_generic_or_wrong_upwork_pages(self) -> None:
        self.assertIsNone(_segment_for_page("https://www.upwork.com/nx/find-work/"))
        self.assertIsNone(_segment_for_page("https://www.upwork.com/nx/find-work/best-matches"))
        self.assertIsNone(_segment_for_page("https://example.com/nx/find-work/9652811"))

    def test_extension_is_auto_capture_version(self) -> None:
        root = Path(__file__).resolve().parents[1]
        manifest = json.loads((root / "browser-extension" / "manifest.json").read_text(encoding="utf-8"))
        self.assertEqual(manifest["version"], "0.4.0")
        self.assertEqual(manifest["background"]["service_worker"], "background.js")
        self.assertIn("http://127.0.0.1:8765/*", manifest["host_permissions"])

    def test_processor_only_setup_does_not_install_playwright(self) -> None:
        root = Path(__file__).resolve().parents[1]
        setup = (root / "scripts" / "windows" / "setup-normal-chrome-worker.ps1").read_text(encoding="utf-8")
        lowered = setup.casefold()
        self.assertNotIn("playwright install", lowered)
        self.assertNotIn(".[browser]", lowered)
        self.assertIn('pip install -e "."', setup)


if __name__ == "__main__":
    unittest.main()
