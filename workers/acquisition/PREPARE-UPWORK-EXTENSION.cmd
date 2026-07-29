@echo off
setlocal
cd /d "%~dp0\..\.."
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\prepare-upwork-extension.ps1" -InstallRoot "%CD%"
pause
exit /b %ERRORLEVEL%
