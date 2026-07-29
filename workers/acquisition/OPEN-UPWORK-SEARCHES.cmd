@echo off
setlocal
cd /d "%~dp0\..\.."
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\open-approved-upwork-searches.ps1" -InstallRoot "%CD%"
if errorlevel 1 pause
exit /b %ERRORLEVEL%
