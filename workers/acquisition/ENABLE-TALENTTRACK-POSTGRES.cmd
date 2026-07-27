@echo off
setlocal
cd /d "%~dp0\..\.."
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\enable-talenttrack-postgres.ps1" -InstallRoot "%CD%"
set "EXIT_CODE=%ERRORLEVEL%"
if not "%EXIT_CODE%"=="0" (
  echo.
  echo TalentTrack local PostgreSQL was not enabled. Existing JSON capture files were not deleted.
)
echo.
pause
exit /b %EXIT_CODE%
