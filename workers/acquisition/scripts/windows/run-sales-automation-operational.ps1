param(
    [string]$StateRoot = (Join-Path $env:LOCALAPPDATA "Codistan\Acquisition"),
    [switch]$RuntimeOnly,
    [switch]$SkipBrowserSetup,
    [switch]$SkipSourceLaunch,
    [switch]$SkipLeadDesk
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$commands = Join-Path $StateRoot "app-current\workers\acquisition"
if (-not (Test-Path -LiteralPath (Join-Path $commands "START-ACQUISITION-V4.cmd"))) {
    throw "Sales Automation is not installed. Run SETUP-AND-RUN-SALES-AUTOMATION.cmd once."
}

$healthEndpoints = [ordered]@{
    upwork = "http://127.0.0.1:8765/health"
    linkedin = "http://127.0.0.1:8775/health"
    sales_navigator = "http://127.0.0.1:8785/health"
}

function Get-OperationalHealth {
    $results = [ordered]@{}
    foreach ($entry in $healthEndpoints.GetEnumerator()) {
        try {
            $health = Invoke-RestMethod -Uri $entry.Value -TimeoutSec 3
            $results[$entry.Key] = [ordered]@{
                reachable = $true
                ready = ($health.ready -eq $true)
                schema_version = [string]$health.schema_version
                source = [string]$health.source
                runtime_version = [string]$health.runtime_version
                accepted = [int]($health.accepted -as [int])
                enriched = [int]($health.enriched -as [int])
                external_actions_enabled = $health.external_actions_enabled
            }
        } catch {
            $results[$entry.Key] = [ordered]@{
                reachable = $false
                ready = $false
                schema_version = ""
                source = $entry.Key
                runtime_version = ""
                accepted = 0
                enriched = 0
                external_actions_enabled = $null
                error = $_.Exception.Message
            }
        }
    }
    return $results
}

function Test-OperationalHealth {
    param([object]$Health)
    foreach ($source in $healthEndpoints.Keys) {
        $entry = $Health[$source]
        if (-not $entry.reachable -or -not $entry.ready) { return $false }
        if ($entry.schema_version -ne "codistan-acquisition-health.v1") { return $false }
        if ($entry.source -ne $source) { return $false }
        if ($entry.external_actions_enabled -ne $false) { return $false }
    }
    return $true
}

function Wait-OperationalHealth {
    param([int]$TimeoutSeconds = 120)
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        $health = Get-OperationalHealth
        if (Test-OperationalHealth -Health $health) { return $health }
        Start-Sleep -Seconds 3
    } while ((Get-Date) -lt $deadline)
    return $health
}

function Write-OperationalStatus {
    param(
        [object]$Health,
        [string]$Status
    )
    $statusRoot = Join-Path $StateRoot "status"
    New-Item -ItemType Directory -Force -Path $statusRoot | Out-Null
    $statusPath = Join-Path $statusRoot "operational-status.json"
    [ordered]@{
        schema_version = "codistan-sales-automation-operational-status.v1"
        status = $Status
        recorded_at = (Get-Date).ToUniversalTime().ToString("o")
        state_root = $StateRoot
        browser_setup_confirmed = Test-Path -LiteralPath (Join-Path $StateRoot "config\browser-extensions-confirmed.json")
        collectors = $Health
        external_actions_enabled = $false
    } | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $statusPath -Encoding UTF8
    return $statusPath
}

function Test-BrowserSetupCurrent {
    $markerPath = Join-Path $StateRoot "config\browser-extensions-confirmed.json"
    $upworkManifestPath = Join-Path $StateRoot "extensions\upwork\manifest.json"
    $linkedinManifestPath = Join-Path $StateRoot "extensions\linkedin\manifest.json"
    if (-not (Test-Path -LiteralPath $markerPath)) { return $false }
    if (-not (Test-Path -LiteralPath $upworkManifestPath) -or -not (Test-Path -LiteralPath $linkedinManifestPath)) { return $false }
    try {
        $marker = Get-Content -LiteralPath $markerPath -Raw | ConvertFrom-Json
        $upworkManifest = Get-Content -LiteralPath $upworkManifestPath -Raw | ConvertFrom-Json
        $linkedinManifest = Get-Content -LiteralPath $linkedinManifestPath -Raw | ConvertFrom-Json
        return (
            $marker.confirmed -eq $true -and
            [string]$marker.upwork_extension_version -eq [string]$upworkManifest.version -and
            [string]$marker.linkedin_sales_navigator_extension_version -eq [string]$linkedinManifest.version -and
            $marker.external_actions_enabled -eq $false
        )
    } catch {
        return $false
    }
}

$health = Get-OperationalHealth
if (-not (Test-OperationalHealth -Health $health)) {
    Write-Host "Starting Sales Automation collectors..." -ForegroundColor Cyan
    Start-Process -FilePath (Join-Path $commands "START-ACQUISITION-V4.cmd") -WindowStyle Minimized | Out-Null
    $health = Wait-OperationalHealth -TimeoutSeconds 120
}

if (-not (Test-OperationalHealth -Health $health)) {
    $statusPath = Write-OperationalStatus -Health $health -Status "collector_start_failed"
    throw "The three collectors did not become healthy. Review $statusPath and $StateRoot\logs\runtime.log."
}

Write-Host "All three collectors are ready." -ForegroundColor Green
Write-Host "  Upwork:          http://127.0.0.1:8765/health"
Write-Host "  LinkedIn:        http://127.0.0.1:8775/health"
Write-Host "  Sales Navigator: http://127.0.0.1:8785/health"
Write-Host "  External actions: disabled" -ForegroundColor Green

$statusPath = Write-OperationalStatus -Health $health -Status "running"
if ($RuntimeOnly) {
    Write-Host "Operational status: $statusPath"
    exit 0
}

if (-not $SkipBrowserSetup -and -not (Test-BrowserSetupCurrent)) {
    & (Join-Path $commands "scripts\windows\setup-sales-automation-extensions.ps1") -StateRoot $StateRoot
}

$pythonBootstrap = Join-Path $commands "scripts\windows\python-bootstrap.ps1"
. $pythonBootstrap
$pythonCommand = Get-CodistanPythonCommand
if (-not $pythonCommand) {
    throw "Python is unavailable after installation. Run setup again."
}
$pythonExecutable = [string]$pythonCommand.Executable
$pythonArguments = @($pythonCommand.Arguments)
$previousPythonPath = $env:PYTHONPATH
$env:PYTHONPATH = $commands
try {
    $reviewCode = "from pathlib import Path; from acquisition_v4.review_v5 import write_review_outputs; write_review_outputs(Path(__import__('sys').argv[1]))"
    & $pythonExecutable @pythonArguments -c $reviewCode $StateRoot | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "The local lead desk could not be generated." }
} finally {
    $env:PYTHONPATH = $previousPythonPath
}

if (-not $SkipSourceLaunch) {
    Write-Host "Opening approved Upwork and buyer-intent LinkedIn searches..." -ForegroundColor Cyan
    & (Join-Path $commands "scripts\windows\open-approved-upwork-searches.ps1") -InstallRoot (Join-Path $StateRoot "app-current")
    & (Join-Path $commands "scripts\windows\open-linkedin-lead-searches.ps1") -InstallRoot (Join-Path $StateRoot "app-current")
}

if (-not $SkipLeadDesk) {
    $reviewPath = Join-Path $StateRoot "review\index.html"
    if (Test-Path -LiteralPath $reviewPath) {
        Start-Process -FilePath $reviewPath | Out-Null
    }
}

$health = Get-OperationalHealth
$statusPath = Write-OperationalStatus -Health $health -Status "running_and_capture_opened"
$prioritySummary = @()
foreach ($source in $healthEndpoints.Keys) {
    $entry = $health[$source]
    $prioritySummary += "${source}: $($entry.accepted) accepted, $($entry.enriched) enriched"
}

Write-Host ""
Write-Host "Sales Automation is running and lead capture is open." -ForegroundColor Green
Write-Host ($prioritySummary -join " | ")
Write-Host "Lead desk: $StateRoot\review\index.html"
Write-Host "Status: $statusPath"
Write-Host "Use the Stop Sales Automation desktop shortcut when finished."
