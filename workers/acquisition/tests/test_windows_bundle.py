from __future__ import annotations

from pathlib import Path
import unittest


class WindowsBundleTests(unittest.TestCase):
    def test_installer_is_local_first_and_supportable(self) -> None:
        root = Path(__file__).resolve().parents[1]
        installer = (root / "scripts/windows/install-acquisition-v4.ps1").read_text(encoding="utf-8")
        diagnostics = (root / "scripts/windows/diagnose-acquisition-v4.ps1").read_text(encoding="utf-8")
        rollback = (root / "scripts/windows/rollback-acquisition-v4.ps1").read_text(encoding="utf-8")
        supervisor = (root / "acquisition_v4/supervisor.py").read_text(encoding="utf-8")
        for marker in [
            "app-current", "app-previous", "$extensionRoot", '@("upwork", "linkedin")',
            "Open Upwork Searches.lnk", "Open LinkedIn Lead Searches.lnk", "Open Acquisition Review.lnk",
            "Codistan Acquisition V4.lnk", "127.0.0.1:8765", "127.0.0.1:8775",
        ]:
            self.assertIn(marker, installer)
        self.assertIn("runtime.pid", supervisor)
        self.assertIn("no opportunity bodies, cookies or credentials", diagnostics.lower())
        self.assertIn("Captured records and deduplication state were preserved", rollback)
        combined = "\n".join([installer, diagnostics, rollback]).lower()
        for prohibited in ["vercel", "database_url", "password=", "linkedin message", "upwork proposal"]:
            self.assertNotIn(prohibited, combined)


if __name__ == "__main__":
    unittest.main()
