@echo off
setlocal
cd /d "%~dp0\..\.."
echo.
echo Installing or updating Codistan Sales Automation...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\install-acquisition-v4.ps1" -InstallRoot "%CD%"
if errorlevel 1 (
  echo.
  echo Setup did not complete. Existing acquisition state was preserved.
  pause
  exit /b 1
)
echo.
echo Starting the operational lead pilot...
call "%LOCALAPPDATA%\Codistan\Acquisition\app-current\workers\acquisition\RUN-SALES-AUTOMATION.cmd"
exit /b %ERRORLEVEL%
