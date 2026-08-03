@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\open-sales-navigator-campaigns.ps1"
if errorlevel 1 (
  echo.
  echo Sales Navigator campaign settings could not be opened. Confirm the LinkedIn extension is loaded.
  pause
)
exit /b %ERRORLEVEL%
