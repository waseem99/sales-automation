@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\diagnose-acquisition-v4.ps1"
pause
exit /b %ERRORLEVEL%
