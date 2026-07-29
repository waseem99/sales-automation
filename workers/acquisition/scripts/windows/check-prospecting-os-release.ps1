param(
    [string]$StateRoot = (Join-Path $env:LOCALAPPDATA "Codistan\Acquisition"),
    [string]$ManifestPath = ""
)

# Legacy compatibility alias for the historical Prospecting OS script name.
& (Join-Path $PSScriptRoot "check-sales-automation-release.ps1") -StateRoot $StateRoot -ManifestPath $ManifestPath
exit $LASTEXITCODE
