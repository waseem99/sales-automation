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
    throw "Python 3.12 or later is required. Run START-HERE-PROSPECTING-OS.cmd first."
}

$collectorPorts = @{
    upwork = 8765
    linkedin = 8775
    sales_navigator = 8785
}
foreach ($entry in $collectorPorts.GetEnumerator()) {
    try {
        $health = Invoke-RestMethod -Uri "http://127.0.0.1:$($entry.Value)/health" -TimeoutSec 3
        if (-not $health.ready -or $health.external_actions_enabled -ne $false) {
            throw "Collector is not ready or reports external actions enabled."
        }
        Write-Host "$($entry.Key): HEALTHY (runtime $($health.runtime_version))"
    } catch {
        Write-Host "$($entry.Key): UNAVAILABLE OR UNSAFE" -ForegroundColor Red
        Write-Host "Run Start Prospecting OS, then rerun this checker."
        exit 3
    }
}

$packageRoot = Join-Path $InstallRoot "workers\acquisition"
if (-not (Test-Path (Join-Path $packageRoot "acquisition_v4\prospecting_os_acceptance.py"))) {
    throw "The Prospecting OS acceptance module is missing from the installed package."
}

$reviewDirectory = Join-Path $StateRoot "review"
New-Item -ItemType Directory -Force -Path $reviewDirectory | Out-Null
$reviewPath = Join-Path $reviewDirectory "commercial-review.json"
$templatePath = Join-Path $packageRoot "commercial-review.template.json"
if (-not (Test-Path $reviewPath) -and (Test-Path $templatePath)) {
    Copy-Item $templatePath $reviewPath
    Write-Host "Created the human review template: $reviewPath" -ForegroundColor Yellow
    Write-Host "Replace the example row with real Priority A/B review records before expecting the commercial gate to pass."
}

$pythonCommand = Find-Python
$pythonExe = $pythonCommand[0]
$pythonArgs = @()
if ($pythonCommand.Count -gt 1) { $pythonArgs = $pythonCommand[1..($pythonCommand.Count - 1)] }
$env:PYTHONPATH = $packageRoot

& $pythonExe @pythonArgs -m acquisition_v4.prospecting_os_acceptance --state-root $StateRoot
$exitCode = $LASTEXITCODE
Write-Host ""
Write-Host "Combined report: $(Join-Path $reviewDirectory 'prospecting-os-pilot-acceptance.json')"
Write-Host "Human review input: $reviewPath"
Write-Host "Automatic external actions remain disabled regardless of the result."
exit $exitCode
