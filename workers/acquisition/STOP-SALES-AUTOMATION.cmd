@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\stop-sales-automation.ps1"
if errorlevel 1 (
  echo.
  echo Sales Automation could not be stopped cleanly. Existing state was preserved.
  pause
  exit /b 1
)
echo Sales Automation stopped. Acquisition state was preserved.
exit /b 0
