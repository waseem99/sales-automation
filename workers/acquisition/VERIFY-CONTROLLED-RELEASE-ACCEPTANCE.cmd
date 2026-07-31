@echo off
setlocal
set "EVIDENCE_ROOT=%~1"
if "%EVIDENCE_ROOT%"=="" (
  echo Usage: VERIFY-CONTROLLED-RELEASE-ACCEPTANCE.cmd ^<evidence-directory^>
  echo Example: VERIFY-CONTROLLED-RELEASE-ACCEPTANCE.cmd "%USERPROFILE%\Desktop\Sales-Automation-RC2-Evidence"
  exit /b 64
)
set "STATE_ROOT=%LOCALAPPDATA%\Codistan\Acquisition"
set "PYTHONPATH=%~dp0"
where py.exe >nul 2>nul
if %ERRORLEVEL%==0 (
  py -3.12 -m acquisition_v4.release_acceptance --evidence-root "%EVIDENCE_ROOT%" --state-root "%STATE_ROOT%"
) else (
  python -m acquisition_v4.release_acceptance --evidence-root "%EVIDENCE_ROOT%" --state-root "%STATE_ROOT%"
)
set EXITCODE=%ERRORLEVEL%
echo.
if "%EXITCODE%"=="0" echo Release evidence includes explicit approval for the exact tested head. Reconfirm exact-head CI before any authorized merge.
if "%EXITCODE%"=="2" echo Technical, Windows and pilot evidence pass. Explicit human release approval is still required.
if not "%EXITCODE%"=="0" if not "%EXITCODE%"=="2" echo Release evidence is incomplete or blocked. Do not merge.
echo Automatic external actions remain disabled. This checker never merges, tags or deploys.
exit /b %EXITCODE%
