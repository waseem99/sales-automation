@echo off
setlocal
cd /d "%~dp0\..\.."
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\check-acquisition-v4.ps1" -InstallRoot "%CD%"
echo.
pause
exit /b %ERRORLEVEL%
