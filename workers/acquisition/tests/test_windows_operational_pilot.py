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

    def test_browser_discovery_supports_explicit_browser_and_profile(self) -> None:
        content = self.read("scripts/windows/chromium-browser.ps1")
        for marker in [
            "Get-CodistanChromiumBrowser",
            "Set-CodistanBrowserProfile",
            "PreferredBrowserId",
            "PreferredProfileName",
            "ProfileName",
            "BrowserArgument",
            "--profile-directory=$directoryName",
            "Start-CodistanBrowser",
            "Google\\Chrome",
            "Opera Software\\Opera Stable",
            "Microsoft\\Edge",
            "BraveSoftware\\Brave-Browser",
        ]:
            self.assertIn(marker, content)
        self.assertNotRegex(content, r"(?<!\$)\(\s*if\s*\(")

    def test_extension_setup_persists_explicit_profile_and_can_reuse_it(self) -> None:
        content = self.read("scripts/windows/setup-sales-automation-extensions.ps1")
        for marker in [
            "PreferredBrowserId",
            "PreferredProfileName",
            "ReuseExistingExtensions",
            "Test-ExpectedExtensionInstallation",
            "browser_profile",
            "browser_profile_argument",
            "Type LOADED",
            "external_actions_enabled = $false",
        ]:
            self.assertIn(marker, content)
        self.assertIn("never submit proposals", content.lower())
        self.assertIn("never bypass login", content.lower())

    def test_all_browser_launchers_use_profile_aware_helper(self) -> None:
        launchers = [
            self.read("scripts/windows/open-approved-upwork-searches.ps1"),
            self.read("scripts/windows/open-linkedin-lead-searches.ps1"),
            self.read("scripts/windows/open-sales-navigator-campaigns.ps1"),
        ]
        for content in launchers:
            self.assertIn("Get-CodistanChromiumBrowser -StateRoot $StateRoot", content)
            self.assertIn("Start-CodistanBrowser -Browser $browser", content)
            self.assertNotIn("Start-Process -FilePath ([string]$browser.Executable)", content)

    def test_operational_start_remains_safe(self) -> None:
        content = self.read("scripts/windows/run-sales-automation-operational.ps1")
        for marker in [
            "http://127.0.0.1:8765/health",
            "http://127.0.0.1:8775/health",
            "http://127.0.0.1:8785/health",
            "setup-sales-automation-extensions.ps1",
            "open-approved-upwork-searches.ps1",
            "open-linkedin-lead-searches.ps1",
            "operational-status.json",
        ]:
            self.assertIn(marker, content)
        self.assertNotIn("Remove-Item $StateRoot", content)
        self.assertNotIn("submit proposal", content.lower())
        self.assertNotIn("send message", content.lower())

    def test_installer_creates_operator_shortcuts(self) -> None:
        content = self.read("scripts/windows/install-acquisition-v4.ps1")
        for marker in [
            "Start Sales Automation.lnk",
            "Stop Sales Automation.lnk",
            "Open Lead Desk.lnk",
            "Setup Browser Extensions.lnk",
            "Manual start is the default",
            "external_actions_enabled",
        ]:
            self.assertIn(marker, content)
        self.assertNotIn("Remove-Item $StateRoot", content)

    def test_strict_mode_external_object_access_is_defensive(self) -> None:
        for relative in [
            "scripts/windows/cleanup-sales-automation-autostart.ps1",
            "scripts/windows/stop-sales-automation.ps1",
            "scripts/windows/start-acquisition-v4.ps1",
            "scripts/windows/install-acquisition-v4.ps1",
            "scripts/windows/run-sales-automation-operational.ps1",
            "scripts/windows/chromium-browser.ps1",
        ]:
            content = self.read(relative)
            self.assertIn("Get-OptionalPropertyValue", content)
            self.assertIn("Set-StrictMode -Version Latest", content)

    def test_lead_desk_defaults_to_actionable_and_auto_refreshes(self) -> None:
        content = self.read("acquisition_v4/review.py")
        for marker in [
            'http-equiv="refresh" content="30"',
            'data-filter="actionable"',
            "applyFilter('actionable')",
            "Actionable A/B",
            "no confirmed buyer intent",
        ]:
            self.assertIn(marker, content)

    def test_linkedin_queries_are_buyer_request_focused(self) -> None:
        content = self.read("scripts/windows/open-linkedin-lead-searches.ps1")
        for marker in [
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


if __name__ == "__main__":
    unittest.main()
