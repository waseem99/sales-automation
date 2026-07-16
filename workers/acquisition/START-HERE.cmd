@echo off
setlocal
title Codistan Acquisition Setup
cd /d "%~dp0"

echo ============================================================
echo   CODISTAN ACQUISITION WORKER - FIRST-TIME SETUP
echo ============================================================
echo.
echo This will install the required local tools, run safety tests,
echo and then open separate login windows for Upwork and LinkedIn.
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\setup-worker.ps1"
if errorlevel 1 goto :failed

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\connect-accounts.ps1" -Account Both
if errorlevel 1 goto :failed

echo.
echo ============================================================
echo Setup and account connection are complete.
echo No outreach or proposal was sent.
echo ============================================================
pause
exit /b 0

:failed
echo.
echo ============================================================
echo Setup stopped because an error occurred.
echo Copy the visible error text and share it in the project chat.
echo Do not share passwords, OTPs, cookies, or recovery codes.
echo ============================================================
pause
exit /b 1
