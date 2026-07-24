@echo off
setlocal
cd /d "%~dp0\..\.."
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\install-acquisition-v4.ps1" -InstallRoot "%CD%"
if errorlevel 1 (
  echo.
  echo Installation did not complete. Use the visible error above; do not share passwords or browser data.
)
echo.
pause
exit /b %ERRORLEVEL%
