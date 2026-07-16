@echo off
setlocal
title Codistan Upwork Automation Installer

echo ============================================================
echo   CODISTAN - INSTALL AUTOMATIC UPWORK ACQUISITION
echo ============================================================
echo.
echo This is a one-time installation. It creates a weekday Windows
echo schedule and uses the saved Upwork Chrome profile automatically.
echo.
echo The worker never submits proposals, sends messages, solves a

echo CAPTCHA, or bypasses Upwork security verification.
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\install-upwork-automation.ps1"
if errorlevel 1 goto :failed

echo.
echo ============================================================
echo Automatic Upwork acquisition has been installed.
echo ============================================================
pause
exit /b 0

:failed
echo.
echo ============================================================
echo Installation stopped because of an error.
echo Share only the visible non-sensitive error text.
echo Never share passwords, OTPs, cookies, recovery codes or tokens.
echo ============================================================
pause
exit /b 1
