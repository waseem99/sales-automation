@echo off
setlocal
set "SCRIPT_ROOT=%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_ROOT%scripts\windows\check-talenttrack-pilot.ps1" %*
exit /b %ERRORLEVEL%
