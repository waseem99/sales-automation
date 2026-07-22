param(
    [string]$InstallRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..\..")).Path
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

$env:PYTHONPATH = Join-Path $InstallRoot "workers\acquisition"
& $pythonExe @pythonArgs -m acquisition_v4.status
exit $LASTEXITCODE
