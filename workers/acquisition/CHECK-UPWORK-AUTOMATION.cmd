@echo off
setlocal
title Codistan Upwork Automation Status

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\check-upwork-automation.ps1"

echo.
pause
