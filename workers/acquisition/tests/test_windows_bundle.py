from __future__ import annotations

from pathlib import Path
import unittest


class WindowsBundleTests(unittest.TestCase):
    def test_installer_is_local_first_and_supportable(self) -> None:
        root = Path(__file__).resolve().parents[1]
        installer = (root / "scripts/windows/install-acquisition-v4.ps1").read_text(encoding="utf-8")
        starter = (root / "scripts/windows/start-acquisition-v4.ps1").read_text(encoding="utf-8")
        stopper = (root / "scripts/windows/stop-sales-automation.ps1").read_text(encoding="utf-8")
        autostart_cleanup = (root / "scripts/windows/cleanup-sales-automation-autostart.ps1").read_text(encoding="utf-8")
        diagnostics = (root / "scripts/windows/diagnose-acquisition-v4.ps1").read_text(encoding="utf-8")
        rollback = (root / "scripts/windows/rollback-acquisition-v4.ps1").read_text(encoding="utf-8")
        configure = (root / "scripts/windows/configure-prospect-desk-sync.ps1").read_text(encoding="utf-8")
        sales_nav_pilot = (root / "scripts/windows/check-sales-navigator-pilot.ps1").read_text(encoding="utf-8")
        combined_pilot = (root / "scripts/windows/check-sales-automation-pilot.ps1").read_text(encoding="utf-8")
        readiness = (root / "scripts/windows/check-sales-automation-release.ps1").read_text(encoding="utf-8")
        release_manifest = (root / "release-manifest.json").read_text(encoding="utf-8")
        canonical_install = (root / "START-HERE-SALES-AUTOMATION.cmd").read_text(encoding="utf-8")
        canonical_start = (root / "START-SALES-AUTOMATION.cmd").read_text(encoding="utf-8")
        canonical_stop = (root / "STOP-SALES-AUTOMATION.cmd").read_text(encoding="utf-8")
        canonical_cleanup = (root / "CLEANUP-SALES-AUTOMATION-AUTOSTART.cmd").read_text(encoding="utf-8")
        canonical_check = (root / "CHECK-SALES-AUTOMATION-RELEASE.cmd").read_text(encoding="utf-8")
        canonical_pilot = (root / "CHECK-SALES-AUTOMATION-PILOT.cmd").read_text(encoding="utf-8")
        legacy_install = (root / "START-HERE-PROSPECTING-OS.cmd").read_text(encoding="utf-8")
        legacy_check = (root / "CHECK-PROSPECTING-OS-RELEASE.cmd").read_text(encoding="utf-8")
        legacy_pilot = (root / "CHECK-PROSPECTING-OS-PILOT.cmd").read_text(encoding="utf-8")
        supervisor = (root / "acquisition_v4/supervisor.py").read_text(encoding="utf-8")

        for marker in [
            "app-current", "app-previous", "$extensionRoot", '@("upwork", "linkedin")',
            "Run Sales Automation.lnk", "Start Sales Automation.lnk",
            "Check Sales Automation Release.lnk", "Check Sales Automation Pilot.lnk",
            "Diagnose Sales Automation.lnk", "Rollback Sales Automation.lnk",
            "Open Upwork Searches.lnk", "Open LinkedIn Lead Searches.lnk", "Open Acquisition Review.lnk",
            "Check Sales Navigator Pilot.lnk", "Configure Prospect Desk Sync.lnk", "Codistan Sales Automation.lnk",
            "Start Acquisition V5.lnk", "Check Acquisition V5.lnk",
            "127.0.0.1:8765", "127.0.0.1:8775", "127.0.0.1:8785",
            '$enabledSources = @("linkedin", "upwork", "sales_navigator")',
            "$migratedConfig", "Sync sources: LinkedIn warm, Upwork warm and Sales Navigator cold campaigns",
            "release-manifest.json", "Get-OptionalPropertyValue", "Get-NestedOptionalPropertyValue",
            "The previous application folder was restored",
            "cleanup-sales-automation-autostart.ps1", "stop-sales-automation.ps1",
            "[switch]$EnableAutoStart", "Manual start is the default",
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
            "Get-OptionalPropertyValue",
        ]:
            self.assertIn(marker, starter)

        for marker in [
            "watchdog.pid", "runtime.pid", "watchdog.lock", "8765, 8775, 8785",
            "acquisition_v4\\.supervisor", "Operational state preserved at",
            "Get-OptionalPropertyValue",
        ]:
            self.assertIn(marker, stopper)

        for marker in [
            'GetFolderPath("Startup")', 'GetFolderPath("CommonStartup")',
            "CurrentVersion\\Run", "CurrentVersion\\RunOnce",
            "Get-ScheduledTask", "Unregister-ScheduledTask",
            "StartupApproved\\Run", "StartupApproved\\Run32", "StartupApproved\\StartupFolder",
            "Operational state preserved at", "Convert-ScheduledTaskActionToText",
        ]:
            self.assertIn(marker, autostart_cleanup)
        self.assertNotIn("$_.Execute", autostart_cleanup)
        self.assertNotIn("$_.Arguments", autostart_cleanup)

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
            "acquisition_v4.sales_automation_acceptance",
            "commercial-review.json",
            "sales-automation-pilot-acceptance.json",
            "Automatic external actions remain disabled",
            "http://127.0.0.1:$($entry.Value)/health",
        ]:
            self.assertIn(marker, combined_pilot)

        for marker in [
            "codistan-sales-automation-readiness.v1",
            "ready_for_local_capture",
            "ready_for_commercial_pilot",
            "sales-automation-release-readiness.json",
            "external_actions_enabled = $false",
        ]:
            self.assertIn(marker, readiness)

        self.assertIn('"product": "Codistan Sales Automation"', release_manifest)
        self.assertIn('"application": "Prospect Desk"', release_manifest)
        self.assertIn('"release_version": "1.0.0-rc.2"', release_manifest)
        self.assertIn('"commercial_readiness": "commercial-readiness.v1"', release_manifest)
        self.assertIn("install-acquisition-v4.ps1", canonical_install)
        self.assertIn("START-ACQUISITION-V4.cmd", canonical_start)
        self.assertIn("stop-sales-automation.ps1", canonical_stop)
        self.assertIn("cleanup-sales-automation-autostart.ps1", canonical_cleanup)
        self.assertIn("check-sales-automation-release.ps1", canonical_check)
        self.assertIn("check-sales-automation-pilot.ps1", canonical_pilot)
        for legacy in [legacy_install, legacy_check, legacy_pilot]:
            self.assertIn("Legacy compatibility alias", legacy)
        self.assertIn('"sales_navigator": 8785', supervisor)
        self.assertIn("runtime.pid", supervisor)
        self.assertIn("watchdog_pid_present", diagnostics)
        self.assertIn("runtime log tails only", diagnostics.lower())
        self.assertIn("no opportunity bodies, cookies or credentials", diagnostics.lower())
        self.assertIn("Captured records and deduplication state were preserved", rollback)
        self.assertIn("The runtime remains stopped", rollback)
        self.assertNotIn("Start-Process", rollback)

        for content in [installer, stopper, autostart_cleanup, rollback]:
            self.assertNotIn("Remove-Item $StateRoot", content)
            self.assertNotIn("Remove-Item -Path $StateRoot", content)

        combined = "\n".join([
            installer, starter, stopper, autostart_cleanup, diagnostics, rollback, sales_nav_pilot,
            combined_pilot, readiness, canonical_install, canonical_start, canonical_stop,
            canonical_cleanup, canonical_check, canonical_pilot,
        ]).lower()
        for prohibited in ["database_url", "password=", "linkedin message", "upwork proposal"]:
            self.assertNotIn(prohibited, combined)

    def test_chromium_launchers_build_argument_arrays_before_start_process(self) -> None:
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
