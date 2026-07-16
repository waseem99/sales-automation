@echo off
setlocal
title Codistan Upwork Operator-Assisted Capture
cd /d "%~dp0"

echo ============================================================
echo   CODISTAN - UPWORK OPERATOR-ASSISTED CAPTURE
echo ============================================================
echo.
echo You will browse Upwork normally and open each saved search yourself.
echo The worker reads visible job cards only after you press Enter.
echo.
echo It does not submit proposals, send messages, imitate human behavior,
echo bypass security checks, or write to the dashboard.
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
