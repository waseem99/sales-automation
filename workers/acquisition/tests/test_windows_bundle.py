from __future__ import annotations

from pathlib import Path
import unittest


class WindowsBundleTests(unittest.TestCase):
    def test_installer_is_local_first_and_supportable(self) -> None:
        root = Path(__file__).resolve().parents[1]
        installer = (root / "scripts/windows/install-acquisition-v4.ps1").read_text(encoding="utf-8")
        starter = (root / "scripts/windows/start-acquisition-v4.ps1").read_text(encoding="utf-8")
        diagnostics = (root / "scripts/windows/diagnose-acquisition-v4.ps1").read_text(encoding="utf-8")
        rollback = (root / "scripts/windows/rollback-acquisition-v4.ps1").read_text(encoding="utf-8")
        configure = (root / "scripts/windows/configure-prospect-desk-sync.ps1").read_text(encoding="utf-8")
        sales_nav_pilot = (root / "scripts/windows/check-sales-navigator-pilot.ps1").read_text(encoding="utf-8")
        readiness = (root / "scripts/windows/check-prospecting-os-release.ps1").read_text(encoding="utf-8")
        release_manifest = (root / "release-manifest.json").read_text(encoding="utf-8")
        canonical_start = (root / "START-HERE-PROSPECTING-OS.cmd").read_text(encoding="utf-8")
        canonical_check = (root / "CHECK-PROSPECTING-OS-RELEASE.cmd").read_text(encoding="utf-8")
        supervisor = (root / "acquisition_v4/supervisor.py").read_text(encoding="utf-8")

        for marker in [
            "app-current", "app-previous", "$extensionRoot", '@("upwork", "linkedin")',
            "Start Prospecting OS.lnk", "Check Prospecting OS Release.lnk",
            "Diagnose Prospecting OS.lnk", "Rollback Prospecting OS.lnk",
            "Open Upwork Searches.lnk", "Open LinkedIn Lead Searches.lnk", "Open Acquisition Review.lnk",
            "Check Sales Navigator Pilot.lnk", "Configure Prospect Desk Sync.lnk", "Codistan Prospecting OS.lnk",
            "Start Acquisition V5.lnk", "Check Acquisition V5.lnk",
            "127.0.0.1:8765", "127.0.0.1:8775", "127.0.0.1:8785", "watchdog.pid",
            '$enabledSources = @("linkedin", "upwork", "sales_navigator")',
            "$migratedConfig", "Sync sources: LinkedIn warm, Upwork warm and Sales Navigator cold campaigns",
            "release-manifest.json", "external_actions_enabled -eq $false",
            "The previous application folder was restored",
        ]:
            self.assertIn(marker, installer)

        for marker in [
            '$enabledSources = @("linkedin", "upwork", "sales_navigator")',
            "Sources: LinkedIn warm leads, Upwork jobs and Sales Navigator cold prospects",
            "http://127.0.0.1:8765/health",
            "http://127.0.0.1:8775/health",
            "http://127.0.0.1:8785/health",
            "All running collectors will detect this configuration",
        ]:
            self.assertIn(marker, configure)

        for marker in [
            "watchdog.pid", "watchdog.lock", "watchdog.log", "runtime.log",
            "Test-CollectorHealth", "while ($true)", "Restarting in 5 seconds",
            "acquisition_v4.supervisor", "Sales Navigator collector", "8765, 8775, 8785",
        ]:
            self.assertIn(marker, starter)

        for marker in [
            "http://127.0.0.1:8785/health",
            "extensions\\linkedin\\manifest.json",
            "1.4.1",
            "acquisition_v4.sales_navigator_acceptance",
            "Campaign settings",
            "Local review",
        ]:
            self.assertIn(marker, sales_nav_pilot)

        for marker in [
            "codistan-prospecting-os-readiness.v1",
            "ready_for_local_capture",
            "ready_for_commercial_pilot",
            "prospecting-os-release-readiness.json",
            "external_actions_enabled = $false",
        ]:
            self.assertIn(marker, readiness)

        self.assertIn('"product": "Codistan Prospecting OS"', release_manifest)
        self.assertIn('"release_version": "1.0.0-rc.1"', release_manifest)
        self.assertIn("install-acquisition-v4.ps1", canonical_start)
        self.assertIn("check-prospecting-os-release.ps1", canonical_check)
        self.assertIn('"sales_navigator": 8785', supervisor)
        self.assertIn("runtime.pid", supervisor)
        self.assertIn("watchdog_pid_present", diagnostics)
        self.assertIn("runtime log tails only", diagnostics.lower())
        self.assertIn("no opportunity bodies, cookies or credentials", diagnostics.lower())
        self.assertIn("Captured records and deduplication state were preserved", rollback)

        combined = "\n".join([
            installer, starter, diagnostics, rollback, sales_nav_pilot,
            readiness, canonical_start, canonical_check,
        ]).lower()
        for prohibited in ["database_url", "password=", "linkedin message", "upwork proposal"]:
            self.assertNotIn(prohibited, combined)

    def test_chrome_launchers_build_argument_arrays_before_start_process(self) -> None:
        root = Path(__file__).resolve().parents[1]
        launchers = [
            root / "scripts/windows/open-approved-upwork-searches.ps1",
            root / "scripts/windows/open-linkedin-lead-searches.ps1",
        ]
        for launcher in launchers:
            content = launcher.read_text(encoding="utf-8")
            self.assertIn("$chromeArguments", content)
            self.assertIn("-ArgumentList $chromeArguments", content)
            self.assertNotIn('-ArgumentList @("--new-window") +', content)


if __name__ == "__main__":
    unittest.main()
