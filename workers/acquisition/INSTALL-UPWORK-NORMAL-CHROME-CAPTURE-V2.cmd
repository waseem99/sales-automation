@echo off
setlocal
title Codistan Normal Chrome Upwork Capture V2

echo ============================================================
echo   CODISTAN NORMAL-CHROME UPWORK CAPTURE V2
echo ============================================================
echo.
echo This removes the old automated-browser task and installs only
echo the localhost processor and updated unpacked Chrome extension.
echo.
echo It does not open or control Upwork.
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\install-upwork-normal-chrome-capture-v2.ps1"
set EXITCODE=%ERRORLEVEL%

echo.
if "%EXITCODE%"=="0" (
    echo Installation completed. Reload the Codistan extension once.
) else (
    echo Installation stopped because of an error.
    echo Share only the visible non-sensitive error text.
)
pause
exit /b %EXITCODE%
