@echo off
setlocal
title Codistan Upwork Dry-Run Pilot
cd /d "%~dp0"

echo ============================================================
echo   CODISTAN - ONE-CLICK UPWORK DRY-RUN PILOT
echo ============================================================
echo.
echo This reviews a small recent sample and creates a local report.
echo It does not submit proposals, send messages, or write to the dashboard.
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\run-upwork-pilot.ps1"
if errorlevel 1 goto :failed

echo.
echo ============================================================
echo Pilot completed. The local HTML report has been opened.
echo Review it and share your approval or feedback in the project chat.
echo ============================================================
pause
exit /b 0

:failed
echo.
echo ============================================================
echo The pilot stopped before completion.
echo Share only the visible non-sensitive error text in the project chat.
echo Do not share passwords, OTPs, cookies, or recovery codes.
echo ============================================================
pause
exit /b 1
