param(
    [string]$InstallRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..\..")).Path,
    [string]$StateRoot = (Join-Path $env:LOCALAPPDATA "Codistan\Acquisition")
)

$ErrorActionPreference = "Stop"

function Find-Python {
    $py = Get-Command py.exe -ErrorAction SilentlyContinue
    if ($py) { return @($py.Source, "-3.12") }
    $python = Get-Command python.exe -ErrorAction SilentlyContinue
    if ($python) { return @($python.Source) }
    throw "Python 3.12 or later is required. Run START-HERE-ACQUISITION-V4.cmd first."
}

$health = $null
try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:8785/health" -TimeoutSec 3
} catch {
    Write-Host "SALES NAVIGATOR COLLECTOR: UNREACHABLE" -ForegroundColor Red
    Write-Host "Run Start Acquisition V4 or rerun START-HERE-ACQUISITION-V4.cmd from the V5 branch."
    exit 3
}

if (-not $health.ready) {
    Write-Host "SALES NAVIGATOR COLLECTOR: UNHEALTHY" -ForegroundColor Red
    Write-Host ($health | ConvertTo-Json -Depth 5)
    exit 3
}

$manifestPath = Join-Path $StateRoot "extensions\linkedin\manifest.json"
if (-not (Test-Path $manifestPath)) {
    Write-Host "LINKEDIN EXTENSION: NOT INSTALLED" -ForegroundColor Red
    Write-Host "Rerun START-HERE-ACQUISITION-V4.cmd, then load or reload the stable LinkedIn extension folder in chrome://extensions/."
    exit 3
}

$manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
Write-Host "Sales Navigator collector: HEALTHY (runtime $($health.runtime_version))"
Write-Host "LinkedIn extension files: version $($manifest.version)"
if ([version]$manifest.version -lt [version]"1.4.1") {
    Write-Host "The installed LinkedIn extension is older than 1.4.1. Rerun the installer and click Reload in chrome://extensions/." -ForegroundColor Red
    exit 3
}

$pythonCommand = Find-Python
$pythonExe = $pythonCommand[0]
$pythonArgs = @()
if ($pythonCommand.Count -gt 1) { $pythonArgs = $pythonCommand[1..($pythonCommand.Count - 1)] }
$packageRoot = Join-Path $InstallRoot "workers\acquisition"
$env:PYTHONPATH = $packageRoot

& $pythonExe @pythonArgs -m acquisition_v4.sales_navigator_acceptance --state-root $StateRoot
$exitCode = $LASTEXITCODE
Write-Host ""
Write-Host "Campaign settings: open the LinkedIn extension, then Open Sales Navigator campaigns."
Write-Host "Collector health: http://127.0.0.1:8785/health"
Write-Host "Local review: $(Join-Path $StateRoot 'review\index.html')"
exit $exitCode
