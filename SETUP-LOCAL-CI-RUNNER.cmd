@echo off
setlocal
title Codistan Local CI Runner Setup

net session >nul 2>&1
if not "%errorlevel%"=="0" (
  echo Requesting Administrator access...
  powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

cd /d "%~dp0"

echo ============================================================
echo   CODISTAN LOCAL GITHUB CI + POSTGRESQL SETUP
echo ============================================================
echo.
echo This will:
echo   1. Create a local PostgreSQL CI database.
echo   2. Store its connection in LOCAL_DATABASE_URL on this PC.
echo   3. Install a GitHub Actions runner as a Windows service.
echo.
echo You will need:
echo   - PostgreSQL already installed on this PC.
echo   - The local PostgreSQL 'postgres' password.
echo   - A temporary GitHub runner registration token.
echo.
pause

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\setup-local-postgres-ci.ps1"
if not "%errorlevel%"=="0" (
  echo.
  echo PostgreSQL setup did not complete.
  pause
  exit /b 1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\install-github-actions-runner.ps1"
if not "%errorlevel%"=="0" (
  echo.
  echo GitHub runner setup did not complete.
  pause
  exit /b 1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\check-local-ci.ps1"
set CHECK_EXIT=%errorlevel%

echo.
if "%CHECK_EXIT%"=="0" (
  echo ============================================================
  echo Local CI setup completed successfully.
  echo Return to GitHub Settings ^> Actions ^> Runners.
  echo Codistan-PC should show Idle.
  echo ============================================================
) else (
  echo ============================================================
  echo Setup completed with one or more failed health checks.
  echo Review the messages above.
  echo ============================================================
)
pause
exit /b %CHECK_EXIT%
