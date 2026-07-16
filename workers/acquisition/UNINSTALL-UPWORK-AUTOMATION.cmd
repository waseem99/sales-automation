@echo off
setlocal
title Codistan Upwork Automation Uninstaller

echo This removes the Windows schedule only.
echo Browser profiles, reports and opportunity history stay preserved.
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\uninstall-upwork-automation.ps1"
if errorlevel 1 goto :failed

echo.
echo Automatic Upwork scheduling has been removed.
pause
exit /b 0

:failed
echo.
echo The uninstaller stopped because of an error.
pause
exit /b 1
