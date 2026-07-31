@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\cleanup-sales-automation-autostart.ps1"
if errorlevel 1 (
  echo.
  echo Auto-start cleanup did not complete. Review the visible error; do not delete the state folder.
)
echo.
pause
exit /b %ERRORLEVEL%
