param(
    [string]$InstallRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..\..")).Path,
    [string]$StateRoot = (Join-Path $env:LOCALAPPDATA "Codistan\Acquisition")
)

# Legacy compatibility alias for the historical Prospecting OS script name.
& (Join-Path $PSScriptRoot "check-sales-automation-pilot.ps1") -InstallRoot $InstallRoot -StateRoot $StateRoot
exit $LASTEXITCODE
