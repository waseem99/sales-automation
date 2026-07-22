param(
    [string]$InstallRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..\..")).Path,
    [string]$StateRoot = (Join-Path $env:LOCALAPPDATA "Codistan\Acquisition")
)

$ErrorActionPreference = "Stop"
$pyLauncher = Get-Command py.exe -ErrorAction SilentlyContinue
if ($pyLauncher) {
    $pythonExe = $pyLauncher.Source
    $pythonArgs = @("-3.12")
} else {
    $python = Get-Command python.exe -ErrorAction SilentlyContinue
    if (-not $python) { throw "Python 3.12 or later is required." }
    $pythonExe = $python.Source
    $pythonArgs = @()
}

$packageRoot = Join-Path $InstallRoot "workers\acquisition"
$env:PYTHONPATH = $packageRoot
New-Item -ItemType Directory -Force -Path $StateRoot | Out-Null

Write-Host "Starting Codistan Acquisition V4..."
Write-Host "State: $StateRoot"
& $pythonExe @pythonArgs -m acquisition_v4.supervisor --state-root $StateRoot --pid-file (Join-Path $StateRoot "runtime.pid")
exit $LASTEXITCODE
