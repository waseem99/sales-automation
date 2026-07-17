@echo off
setlocal
title Codistan Upwork Stability Installer

echo ============================================================
echo   CODISTAN - UPWORK STABILITY INSTALLATION
echo ============================================================
echo.
echo This installer updates the worker, keeps the recurring task
echo disabled, and runs one controlled three-search test in a
echo single visible Chrome tab.
echo.
echo The 30-minute schedule is enabled only when all three saved
echo searches complete and a valid report is created.
echo.
echo No proposal or message is sent.
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\install-upwork-automation.ps1"
set EXITCODE=%ERRORLEVEL%
if not "%EXITCODE%"=="0" goto :notaccepted

echo.
echo ============================================================
echo Stability test passed. Automatic acquisition is enabled.
echo ============================================================
pause
exit /b 0

:notaccepted
echo.
echo ============================================================
echo The controlled test did not pass or installation stopped.
echo The recurring task remains disabled.
echo Review the newest report and diagnostic files before retrying.
echo Share only non-sensitive error text or screenshots.
echo ============================================================
pause
exit /b %EXITCODE%
