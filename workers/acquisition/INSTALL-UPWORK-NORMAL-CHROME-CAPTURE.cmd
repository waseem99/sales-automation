@echo off
setlocal
title Codistan Normal Chrome Upwork Capture Installer

echo ============================================================
echo   CODISTAN NORMAL-CHROME UPWORK CAPTURE
echo ============================================================
echo.
echo This removes the old browser-automation task and installs only
echo the localhost capture processor plus the updated Chrome extension.
echo.
echo It never opens, navigates, refreshes or scrolls Upwork.
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\install-upwork-normal-chrome-capture.ps1"
set EXITCODE=%ERRORLEVEL%

echo.
if "%EXITCODE%"=="0" (
    echo Installation completed. Reload the Codistan extension once in Chrome.
) else (
    echo Installation stopped because of an error.
    echo Share only the visible non-sensitive error text.
)
pausE
exit /b %EXITCODE%
