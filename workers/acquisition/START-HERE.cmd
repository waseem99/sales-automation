@echo off
setlocal
title Codistan Acquisition Setup
cd /d "%~dp0"

set "STATE_ROOT=%LOCALAPPDATA%\Codistan\Acquisition"
set "UPWORK_MARKER=%STATE_ROOT%\upwork.connected.json"
set "LINKEDIN_MARKER=%STATE_ROOT%\linkedin-sales-navigator.connected.json"

echo ============================================================
echo   CODISTAN ACQUISITION WORKER - GUIDED SETUP
 echo ============================================================
echo.
echo This installs or updates the required local tools, runs safety
 echo tests, and then connects or validates Upwork and LinkedIn.
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\setup-worker.ps1"
if errorlevel 1 goto :failed

if exist "%UPWORK_MARKER%" if exist "%LINKEDIN_MARKER%" goto :validate

echo.
echo Saved account confirmations were not found. Starting account connection.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\connect-accounts.ps1" -Account Both
if errorlevel 1 goto :failed

:validate
echo.
echo Running a sanitized session check for both saved profiles.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\validate-accounts.ps1"
if errorlevel 1 goto :failed

echo.
echo ============================================================
echo Setup is complete and both account sessions are confirmed.
echo The workstation is ready for the Upwork dry-run pilot.
echo No outreach or proposal was sent.
echo ============================================================
pause
exit /b 0

:failed
echo.
echo ============================================================
echo Setup or validation stopped because an error occurred.
echo Copy the visible error text and share it in the project chat.
echo Do not share passwords, OTPs, cookies, or recovery codes.
echo ============================================================
pause
exit /b 1
