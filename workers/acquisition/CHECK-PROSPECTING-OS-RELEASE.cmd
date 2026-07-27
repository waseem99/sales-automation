@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\check-prospecting-os-release.ps1"
set EXITCODE=%ERRORLEVEL%
echo.
if "%EXITCODE%"=="0" echo Prospecting OS is ready for the full commercial pilot.
if "%EXITCODE%"=="2" echo Local capture is ready, but Prospect Desk sync still needs configuration.
if not "%EXITCODE%"=="0" if not "%EXITCODE%"=="2" echo Prospecting OS has blocking readiness failures.
echo.
pause
exit /b %EXITCODE%
