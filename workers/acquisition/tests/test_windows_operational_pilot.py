from __future__ import annotations

from pathlib import Path
import unittest


class WindowsOperationalPilotTests(unittest.TestCase):
    def setUp(self) -> None:
        self.root = Path(__file__).resolve().parents[1]

    def read(self, relative: str) -> str:
        return (self.root / relative).read_text(encoding="utf-8")

    def test_python_bootstrap_has_verified_non_winget_fallback(self) -> None:
        content = self.read("scripts/windows/python-bootstrap.ps1")
        for marker in [
            "Get-CodistanPythonCommand",
            "Ensure-CodistanPython",
            "Python.Python.3.12",
            "python-3.12.10-amd64.exe",
            "Get-AuthenticodeSignature",
            "Python Software Foundation",
            "InstallAllUsers=0",
            "PrependPath=1",
            "Include_launcher=1",
        ]:
            self.assertIn(marker, content)
        self.assertNotIn("Invoke-Expression", content)
        self.assertNotIn("Start-BitsTransfer", content)

    def test_browser_discovery_supports_operator_chromium_options(self) -> None:
        content = self.read("scripts/windows/chromium-browser.ps1")
        for marker in [
            "Get-CodistanDefaultBrowserHint",
            "Get-CodistanChromiumBrowser",
            "Find-CodistanBrowserExtension",
            "Get-OptionalPropertyValue",
            "Get-NestedOptionalPropertyValue",
            "Opera Software\\Opera Stable",
            "Opera GX Stable",
            "Google\\Chrome",
            "Microsoft\\Edge",
            "BraveSoftware\\Brave-Browser",
            "opera://extensions/",
            "chrome://extensions/",
            "edge://extensions/",
            "brave://extensions/",
            "Secure Preferences",
        ]:
            self.assertIn(marker, content)

    def test_installer_creates_operator_shortcuts_and_uses_runtime_only_health_check(self) -> None:
        content = self.read("scripts/windows/install-acquisition-v4.ps1")
        for marker in [
            ". $pythonBootstrap",
            "Ensure-CodistanPython",
            "Get-OptionalPropertyValue",
            "Get-NestedOptionalPropertyValue",
            "$pythonExecutable",
            "$pythonArguments",
            "Start Sales Automation.lnk",
            "Stop Sales Automation.lnk",
            "Open Lead Desk.lnk",
            "Setup Browser Extensions.lnk",
            "RUN-SALES-AUTOMATION.cmd",
            "STOP-SALES-AUTOMATION.cmd",
            "OPEN-ACQUISITION-REVIEW.cmd",
            "SETUP-SALES-AUTOMATION-EXTENSIONS.cmd",
            "START-ACQUISITION-V4.cmd",
            "external_actions_enabled",
            "Manual start is the default",
        ]:
            self.assertIn(marker, content)
        self.assertNotIn("Remove-Item $StateRoot", content)
        self.assertNotIn("Remove-Item -Path $StateRoot", content)

    def test_operational_start_is_one_click_safe_and_opens_capture(self) -> None:
        content = self.read("scripts/windows/run-sales-automation-operational.ps1")
        for marker in [
            "http://127.0.0.1:8765/health",
            "http://127.0.0.1:8775/health",
            "http://127.0.0.1:8785/health",
            "Get-OptionalPropertyValue",
            "Test-BrowserSetupCurrent",
            "setup-sales-automation-extensions.ps1",
            "open-approved-upwork-searches.ps1",
            "open-linkedin-lead-searches.ps1",
            "review_v5 import write_review_outputs",
            "operational-status.json",
            "Sales Automation is running and lead capture is open",
        ]:
            self.assertIn(marker, content)
        self.assertNotIn("Remove-Item $StateRoot", content)
        self.assertNotIn("submit proposal", content.lower())
        self.assertNotIn("send message", content.lower())

    def test_strict_mode_external_object_access_is_defensive(self) -> None:
        cleanup = self.read("scripts/windows/cleanup-sales-automation-autostart.ps1")
        stop = self.read("scripts/windows/stop-sales-automation.ps1")
        starter = self.read("scripts/windows/start-acquisition-v4.ps1")
        installer = self.read("scripts/windows/install-acquisition-v4.ps1")
        operational = self.read("scripts/windows/run-sales-automation-operational.ps1")
        browser = self.read("scripts/windows/chromium-browser.ps1")

        for content in [cleanup, stop, starter, installer, operational, browser]:
            self.assertIn("Get-OptionalPropertyValue", content)
            self.assertIn("Set-StrictMode -Version Latest", content)

        self.assertIn("Convert-ScheduledTaskActionToText", cleanup)
        self.assertIn('foreach ($propertyName in @("Execute", "Arguments", "WorkingDirectory", "ClassId", "Data"))', cleanup)
        self.assertNotIn("$_.Execute", cleanup)
        self.assertNotIn("$_.Arguments", cleanup)
        self.assertIn('Get-OptionalPropertyValue -InputObject $process -Name "CommandLine"', stop)
        self.assertIn('Get-OptionalPropertyValue -InputObject $process -Name "CommandLine"', starter)

    def test_browser_setup_requires_human_confirmation_and_preserves_safety(self) -> None:
        content = self.read("scripts/windows/setup-sales-automation-extensions.ps1")
        for marker in [
            "Get-CodistanChromiumBrowser",
            "$browser.ExtensionsUrl",
            "Type LOADED",
            "browser-extensions-confirmed.json",
            "browser_executable",
            "external_actions_enabled = $false",
            "Sales Navigator Campaigns.lnk",
            "open-sales-navigator-campaigns.ps1",
        ]:
            self.assertIn(marker, content)
        self.assertIn("never submit proposals", content.lower())
        self.assertIn("never bypass login", content.lower())

    def test_sales_navigator_campaign_launcher_resolves_unpacked_extension(self) -> None:
        launcher = self.read("scripts/windows/open-sales-navigator-campaigns.ps1")
        browser = self.read("scripts/windows/chromium-browser.ps1")
        for marker in [
            "Find-CodistanBrowserExtension",
            "Codistan LinkedIn & Sales Navigator Capture",
            "chrome-extension://$extensionId/sales-nav-options.html",
            "no-confirmed-intent warning",
        ]:
            self.assertIn(marker, launcher)
        self.assertIn("Secure Preferences", browser)

    def test_operator_commands_are_present(self) -> None:
        setup = self.read("SETUP-AND-RUN-SALES-AUTOMATION.cmd")
        run = self.read("RUN-SALES-AUTOMATION.cmd")
        stop = self.read("STOP-SALES-AUTOMATION.cmd")
        extensions = self.read("SETUP-SALES-AUTOMATION-EXTENSIONS.cmd")
        campaigns = self.read("OPEN-SALES-NAVIGATOR-CAMPAIGNS.cmd")
        self.assertIn("install-acquisition-v4.ps1", setup)
        self.assertIn("RUN-SALES-AUTOMATION.cmd", setup)
        self.assertIn("run-sales-automation-operational.ps1", run)
        self.assertIn("stop-sales-automation.ps1", stop)
        self.assertIn("setup-sales-automation-extensions.ps1", extensions)
        self.assertIn("open-sales-navigator-campaigns.ps1", campaigns)

    def test_lead_desk_defaults_to_actionable_and_auto_refreshes(self) -> None:
        content = self.read("acquisition_v4/review.py")
        for marker in [
            'http-equiv="refresh" content="30"',
            'data-filter="actionable"',
            "applyFilter('actionable')",
            "Actionable A/B",
            "Sales Navigator cold",
            "no confirmed buyer intent",
        ]:
            self.assertIn(marker, content)

    def test_operational_linkedin_queries_are_buyer_request_focused(self) -> None:
        content = self.read("scripts/windows/open-linkedin-lead-searches.ps1")
        for marker in [
            "Get-CodistanChromiumBrowser",
            "need recommendations for",
            "request for proposal",
            "software development partner",
            "AI implementation partner",
            "performance marketing agency",
            "3D visualization studio",
            "ISO 27001 consultant",
            "NOT recruiter",
        ]:
            self.assertIn(marker, content)

    def test_upwork_launcher_uses_the_configured_browser(self) -> None:
        content = self.read("scripts/windows/open-approved-upwork-searches.ps1")
        self.assertIn("Get-CodistanChromiumBrowser", content)
        self.assertIn("$browser.Executable", content)
        self.assertIn("external_actions_enabled -ne $false", content)


if __name__ == "__main__":
    unittest.main()
