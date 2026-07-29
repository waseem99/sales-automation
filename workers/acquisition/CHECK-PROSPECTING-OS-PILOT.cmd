@echo off
rem Legacy compatibility alias for the historical Prospecting OS command name.
rem Use CHECK-SALES-AUTOMATION-PILOT.cmd for all new pilot checks.
call "%~dp0CHECK-SALES-AUTOMATION-PILOT.cmd"
exit /b %ERRORLEVEL%
