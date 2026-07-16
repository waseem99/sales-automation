@echo off
setlocal
title Configure Prospect Desk Acquisition Ingestion

echo ============================================================
echo   CONFIGURE PROSPECT DESK ACQUISITION INGESTION
echo ============================================================
echo.
echo Use this after the /api/acquisition-ingest endpoint is deployed.
echo The token is encrypted locally for this Windows user.
echo No plaintext token is written to disk or GitHub.
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\configure-prospect-desk-ingestion.ps1"
if errorlevel 1 goto :failed

echo.
echo Prospect Desk ingestion configuration completed.
pause
exit /b 0

:failed
echo.
echo Configuration stopped because of an error.
echo Do not share the ingestion token in chat or screenshots.
pause
exit /b 1
