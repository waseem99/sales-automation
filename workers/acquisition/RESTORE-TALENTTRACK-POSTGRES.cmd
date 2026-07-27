@echo off
setlocal
cd /d "%~dp0\..\.."
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\restore-talenttrack-postgres.ps1" -InstallRoot "%CD%"
set "EXIT_CODE=%ERRORLEVEL%"
if not "%EXIT_CODE%"=="0" (
  echo.
  echo Restore did not complete. Review the visible error before restarting TalentTrack.
)
echo.
pause
exit /b %EXIT_CODE%
