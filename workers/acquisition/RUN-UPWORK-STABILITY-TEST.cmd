@echo off
setlocal
title Codistan Upwork Stability Test

echo ============================================================
echo   CODISTAN UPWORK - CONTROLLED STABILITY TEST
echo ============================================================
echo.
echo This run uses one visible Chrome tab and checks all three
echo approved saved searches. Prospect Desk ingestion is disabled.
echo The recurring Windows task remains disabled unless this run
echo completes all three searches and creates a report.
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\run-upwork-automation.ps1" -Force -AcceptanceTest
set EXITCODE=%ERRORLEVEL%

echo.
if "%EXITCODE%"=="0" (
    echo Stability test passed.
    echo Re-run INSTALL-UPWORK-AUTOMATION.cmd to enable the schedule,
    echo or use the installer package that performs both steps.
) else if "%EXITCODE%"=="20" (
    echo Stability test did not pass. The recurring task must remain disabled.
    echo Review the report and search-results.json in the newest output folder.
) else (
    echo Stability test stopped with exit code %EXITCODE%.
)
pause
exit /b %EXITCODE%
