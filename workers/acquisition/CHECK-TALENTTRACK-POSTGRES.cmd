@echo off
setlocal
cd /d "%~dp0\..\.."
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\check-talenttrack-postgres.ps1" -InstallRoot "%CD%"
set "EXIT_CODE=%ERRORLEVEL%"
echo.
pause
exit /b %EXIT_CODE%
