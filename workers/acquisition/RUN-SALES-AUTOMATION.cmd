@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\run-sales-automation-governed.ps1"
if errorlevel 1 (
  echo.
  echo Sales Automation did not start completely. Review the error above; existing state was preserved.
  pause
)
exit /b %ERRORLEVEL%
