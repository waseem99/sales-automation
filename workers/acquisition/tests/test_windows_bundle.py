from __future__ import annotations

from pathlib import Path
import unittest


class WindowsBundleTests(unittest.TestCase):
    def setUp(self) -> None:
        self.root = Path(__file__).resolve().parents[1]

    def read(self, relative: str) -> str:
        return (self.root / relative).read_text(encoding="utf-8")

    def test_installer_is_local_first_and_supportable(self) -> None:
        installer = self.read("scripts/windows/install-acquisition-v4.ps1")
        starter = self.read("scripts/windows/start-acquisition-v4.ps1")
        stopper = self.read("scripts/windows/stop-sales-automation.ps1")
        cleanup = self.read("scripts/windows/cleanup-sales-automation-autostart.ps1")
        rollback = self.read("scripts/windows/rollback-acquisition-v4.ps1")
        manifest = self.read("release-manifest.json")

        for marker in [
            "app-current",
            "app-previous",
            "Start Sales Automation.lnk",
            "Stop Sales Automation.lnk",
            "Open Lead Desk.lnk",
            "Setup Browser Extensions.lnk",
            "127.0.0.1:8765",
            "127.0.0.1:8775",
            "127.0.0.1:8785",
            "cleanup-sales-automation-autostart.ps1",
            "stop-sales-automation.ps1",
            "Manual start is the default",
            "The previous application folder was restored",
        ]:
            self.assertIn(marker, installer)

        for marker in [
            "watchdog.pid",
            "watchdog.lock",
            "runtime.log",
            "acquisition_v4.supervisor",
            "Test-CodistanCollectorCommandLine",
        ]:
            self.assertIn(marker, starter)

        for marker in [
            "watchdog.pid",
            "runtime.pid",
            "8765, 8775, 8785",
            "acquisition_v4\\.(?:supervisor|runtime|runtime_v5)",
            "Operational state preserved at",
        ]:
            self.assertIn(marker, stopper)

        for marker in [
            "Get-ScheduledTask",
            "Unregister-ScheduledTask",
            "StartupApproved\\Run",
            "Convert-ScheduledTaskActionToText",
            "Operational state preserved at",
        ]:
            self.assertIn(marker, cleanup)
        self.assertNotIn("$_.Execute", cleanup)
        self.assertNotIn("$_.Arguments", cleanup)

        self.assertIn('"product": "Codistan Sales Automation"', manifest)
        self.assertIn('"release_version": "1.0.0-rc.2"', manifest)
        self.assertIn("Captured records and deduplication state were preserved", rollback)
        self.assertNotIn("Start-Process", rollback)

        for content in [installer, stopper, cleanup, rollback]:
            self.assertNotIn("Remove-Item $StateRoot", content)
            self.assertNotIn("Remove-Item -Path $StateRoot", content)

    def test_browser_launchers_use_profile_aware_start_helper(self) -> None:
        launchers = [
            self.read("scripts/windows/open-approved-upwork-searches.ps1"),
            self.read("scripts/windows/open-linkedin-lead-searches.ps1"),
            self.read("scripts/windows/open-sales-navigator-campaigns.ps1"),
        ]
        for content in launchers:
            self.assertIn("Get-CodistanChromiumBrowser -StateRoot $StateRoot", content)
            self.assertIn("Start-CodistanBrowser -Browser $browser", content)
            self.assertNotIn("Start-Process -FilePath ([string]$browser.Executable)", content)

    def test_browser_setup_persists_browser_and_profile(self) -> None:
        browser = self.read("scripts/windows/chromium-browser.ps1")
        setup = self.read("scripts/windows/setup-sales-automation-extensions.ps1")
        for marker in [
            "PreferredBrowserId",
            "PreferredProfileName",
            "Set-CodistanBrowserProfile",
            "BrowserArgument",
            "--profile-directory=$directoryName",
        ]:
            self.assertIn(marker, browser)
        for marker in [
            "PreferredBrowserId",
            "PreferredProfileName",
            "ReuseExistingExtensions",
            "browser_profile",
            "browser_profile_argument",
            "external_actions_enabled = $false",
        ]:
            self.assertIn(marker, setup)


if __name__ == "__main__":
    unittest.main()
