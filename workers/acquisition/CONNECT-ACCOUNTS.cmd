@echo off
setlocal
title Codistan Account Connection
cd /d "%~dp0"

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\connect-accounts.ps1" -Account Both
if errorlevel 1 goto :failed

echo.
echo Account profile step completed. No external action was sent.
pause
exit /b 0

:failed
echo.
echo Account setup stopped because an error occurred.
echo Share only the error text. Never share passwords, OTPs, or cookies.
pause
exit /b 1
