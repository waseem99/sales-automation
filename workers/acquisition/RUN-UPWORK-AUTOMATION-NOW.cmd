@echo off
setlocal
title Codistan Upwork Automation - Run Now

echo Starting one automatic Upwork acquisition run now.
echo This explicit run bypasses only the time-window gate.
echo Keep Chrome available. No proposal or message will be sent.
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\run-upwork-automation.ps1" -Force
set EXITCODE=%ERRORLEVEL%

echo.
if "%EXITCODE%"=="0" (
    echo The automatic run completed.
) else if "%EXITCODE%"=="4" (
    echo The run paused or stopped because Upwork requires human verification.
) else (
    echo The automatic run stopped with exit code %EXITCODE%.
)
pause
exit /b %EXITCODE%
