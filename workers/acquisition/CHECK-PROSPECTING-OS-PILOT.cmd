@echo off
setlocal
cd /d "%~dp0\..\.."
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\check-prospecting-os-pilot.ps1" -InstallRoot "%CD%"
set EXIT_CODE=%ERRORLEVEL%
echo.
if "%EXIT_CODE%"=="0" echo Prospecting OS technical and human commercial gates passed.
if "%EXIT_CODE%"=="2" echo Prospecting OS still needs pilot records or human commercial review.
if not "%EXIT_CODE%"=="0" if not "%EXIT_CODE%"=="2" echo Prospecting OS pilot is blocked by a safety or runtime failure.
echo.
pause
exit /b %EXIT_CODE%
