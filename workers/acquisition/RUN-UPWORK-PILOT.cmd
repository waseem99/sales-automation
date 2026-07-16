@echo off
setlocal
title Codistan Upwork Manual Chrome Capture
cd /d "%~dp0"

echo ============================================================
echo   CODISTAN - UPWORK MANUAL CHROME CAPTURE
echo ============================================================
echo.
echo This uses your ordinary Chrome browser and a manually clicked extension.
echo No Playwright browser, remote debugging, automatic navigation, proposal,
echo message, application, or dashboard write is performed.
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\run-upwork-pilot.ps1"
if errorlevel 1 goto :failed

echo.
echo ============================================================
echo Capture completed. The local HTML report has been opened.
echo Review it and share your approval or feedback in the project chat.
echo ============================================================
pause
exit /b 0

:failed
echo.
echo ============================================================
echo The capture stopped before completion.
echo Share only the visible non-sensitive error text in the project chat.
echo Do not share passwords, OTPs, cookies, or recovery codes.
echo ============================================================
pause
exit /b 1
