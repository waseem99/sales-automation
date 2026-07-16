@echo off
setlocal
title Codistan Acquisition Account Validation
cd /d "%~dp0"

echo ============================================================
echo   CODISTAN ACQUISITION - ACCOUNT SESSION VALIDATION
echo ============================================================
echo.
echo This checks whether the saved Upwork and LinkedIn sessions are
 echo still authorized. It does not read messages, submit proposals,
 echo send outreach, or store private page content.
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\validate-accounts.ps1"
if errorlevel 1 goto :failed

echo.
echo ============================================================
echo Both account sessions are confirmed.
echo The workstation is ready for the Upwork dry-run pilot.
echo ============================================================
pause
exit /b 0

:failed
echo.
echo ============================================================
echo Validation needs attention.
echo Share only the visible result or sanitized JSON file.
echo Do not share passwords, OTPs, cookies, or browser profiles.
echo ============================================================
pause
exit /b 1
