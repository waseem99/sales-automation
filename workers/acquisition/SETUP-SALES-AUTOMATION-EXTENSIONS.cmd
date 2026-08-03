@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\setup-sales-automation-extensions.ps1"
if errorlevel 1 (
  echo.
  echo Browser extension setup was not completed. Existing state was preserved.
  pause
)
exit /b %ERRORLEVEL%
