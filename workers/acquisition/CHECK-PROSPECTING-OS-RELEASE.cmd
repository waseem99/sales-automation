@echo off
rem Legacy compatibility alias for the historical Prospecting OS command name.
rem Use CHECK-SALES-AUTOMATION-RELEASE.cmd for all new release checks.
call "%~dp0CHECK-SALES-AUTOMATION-RELEASE.cmd"
exit /b %ERRORLEVEL%
