from __future__ import annotations

from pathlib import Path
import re
import unittest


class WindowsManualStartTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.root = Path(__file__).resolve().parents[1]
        cls.installer = (cls.root / "scripts/windows/install-acquisition-v4.ps1").read_text(encoding="utf-8")
        cls.cleanup = (cls.root / "scripts/windows/cleanup-sales-automation-autostart.ps1").read_text(encoding="utf-8")
        cls.stop = (cls.root / "scripts/windows/stop-sales-automation.ps1").read_text(encoding="utf-8")
        cls.stop_cmd = (cls.root / "STOP-SALES-AUTOMATION.cmd").read_text(encoding="utf-8")
        cls.cleanup_cmd = (cls.root / "CLEANUP-SALES-AUTOMATION-AUTOSTART.cmd").read_text(encoding="utf-8")

    def test_autostart_is_opt_in_runtime_only(self) -> None:
        self.assertIn("[switch]$EnableAutoStart", self.installer)
        self.assertIn("if ($EnableAutoStart) {", self.installer)

        before_opt_in, opt_in_and_after = self.installer.split("if ($EnableAutoStart) {", 1)
        opt_in_block = opt_in_and_after.split("}", 1)[0]
        self.assertNotIn("Codistan Sales Automation.lnk", before_opt_in)
        self.assertIn("Codistan Sales Automation.lnk", opt_in_block)
        self.assertIn("START-SALES-AUTOMATION.cmd", opt_in_block)
        self.assertNotIn("RUN-SALES-AUTOMATION.cmd", opt_in_block)
        self.assertIn("Manual start is the default", self.installer)
        self.assertIn("The installation health check is complete and the runtime is stopped", self.installer)

    def test_installer_creates_explicit_operator_shortcuts(self) -> None:
        desktop_shortcut_creations = re.findall(r"New-Shortcut \(Join-Path \$desktop", self.installer)
        self.assertEqual(4, len(desktop_shortcut_creations))
        expected = {
            '"Start Sales Automation.lnk"': '"RUN-SALES-AUTOMATION.cmd"',
            '"Stop Sales Automation.lnk"': '"STOP-SALES-AUTOMATION.cmd"',
            '"Open Lead Desk.lnk"': '"OPEN-ACQUISITION-REVIEW.cmd"',
            '"Setup Browser Extensions.lnk"': '"SETUP-SALES-AUTOMATION-EXTENSIONS.cmd"',
        }
        for shortcut, target in expected.items():
            self.assertIn(shortcut, self.installer)
            self.assertIn(target, self.installer)

    def test_upgrade_cleanup_covers_legacy_windows_startup_mechanisms(self) -> None:
        self.assertLess(
            self.installer.index("& $cleanupAutoStartScript -StateRoot $StateRoot"),
            self.installer.index('$appCurrent = Join-Path $StateRoot "app-current"'),
        )
        for marker in [
            'GetFolderPath("Startup")',
            'GetFolderPath("CommonStartup")',
            "CurrentVersion\\Run",
            "CurrentVersion\\RunOnce",
            "Get-ScheduledTask",
            "Unregister-ScheduledTask",
            "StartupApproved\\Run",
            "StartupApproved\\Run32",
            "StartupApproved\\StartupFolder",
        ]:
            self.assertIn(marker, self.cleanup)

    def test_stop_and_cleanup_preserve_operational_state(self) -> None:
        for content in [self.installer, self.cleanup, self.stop]:
            self.assertIn('Codistan\\Acquisition', content)
            self.assertNotIn("Remove-Item $StateRoot", content)
            self.assertNotIn("Remove-Item -Path $StateRoot", content)
        self.assertIn("Operational state preserved at", self.cleanup)
        self.assertIn("Operational state preserved at", self.stop)
        self.assertIn("stop-sales-automation.ps1", self.stop_cmd)
        self.assertIn("cleanup-sales-automation-autostart.ps1", self.cleanup_cmd)

    def test_install_health_check_stops_runtime_before_returning(self) -> None:
        start_index = self.installer.index("Start-Process -FilePath")
        stop_index = self.installer.index("& $installedStopScript -StateRoot $StateRoot")
        success_index = self.installer.index('Write-Host "$($release.product)')
        self.assertLess(start_index, stop_index)
        self.assertLess(stop_index, success_index)
        self.assertIn("external_actions_enabled -eq $false", self.installer)


if __name__ == "__main__":
    unittest.main()
