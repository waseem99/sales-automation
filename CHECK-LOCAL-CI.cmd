@echo off
setlocal
title Codistan Local CI Health Check
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\check-local-ci.ps1"
set EXIT_CODE=%errorlevel%
echo.
pause
exit /b %EXIT_CODE%
