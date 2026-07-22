@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\open-acquisition-review.ps1"
if errorlevel 1 pause
exit /b %ERRORLEVEL%
