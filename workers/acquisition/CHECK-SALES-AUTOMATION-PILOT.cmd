@echo off
setlocal
cd /d "%~dp0\..\.."
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\check-sales-automation-pilot.ps1" -InstallRoot "%CD%"
set EXIT_CODE=%ERRORLEVEL%
echo.
if "%EXIT_CODE%"=="0" echo Sales Automation technical and human commercial gates passed.
if "%EXIT_CODE%"=="2" echo Sales Automation still needs pilot records or human commercial review.
if not "%EXIT_CODE%"=="0" if not "%EXIT_CODE%"=="2" echo Sales Automation pilot is blocked by a safety or runtime failure.
echo.
pause
exit /b %EXIT_CODE%
