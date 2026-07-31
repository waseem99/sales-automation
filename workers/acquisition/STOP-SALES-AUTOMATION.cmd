@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\stop-sales-automation.ps1"
if errorlevel 1 (
  echo.
  echo Sales Automation could not be stopped cleanly. Review the visible error; do not delete the state folder.
)
echo.
pause
exit /b %ERRORLEVEL%
