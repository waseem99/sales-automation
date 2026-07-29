param(
    [string]$StateRoot = (Join-Path $env:LOCALAPPDATA "Codistan\Acquisition")
)

$ErrorActionPreference = "Stop"
$reviewPath = Join-Path $StateRoot "review\index.html"
if (-not (Test-Path $reviewPath)) {
    throw "No acquisition review exists yet. Run an Upwork or LinkedIn capture first."
}
Start-Process -FilePath $reviewPath
Write-Host "Opened the local Codistan Acquisition Review."
