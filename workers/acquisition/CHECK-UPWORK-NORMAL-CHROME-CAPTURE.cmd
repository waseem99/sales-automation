@echo off
setlocal
title Codistan Normal Chrome Upwork Capture Status
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\check-upwork-normal-chrome-capture.ps1"
echo.
pause
