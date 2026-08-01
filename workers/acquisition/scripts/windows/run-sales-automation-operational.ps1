param(
    [string]$StateRoot = (Join-Path $env:LOCALAPPDATA "Codistan\Acquisition"),
    [switch]$RuntimeOnly,
    [switch]$SkipBrowserSetup,
    [switch]$SkipSourceLaunch,
    [switch]$SkipLeadDesk
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Get-OptionalPropertyValue {
    param(
        [AllowNull()][object]$InputObject,
        [Parameter(Mandatory = $true)][string]$Name,
        [AllowNull()][object]$DefaultValue = $null
    )
    if ($null -eq $InputObject) { return $DefaultValue }
    $property = $InputObject.PSObject.Properties[$Name]
    if ($null -eq $property) { return $DefaultValue }
    return $property.Value
}

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
            $accepted = 0
            $enriched = 0
            [void][int]::TryParse([string](Get-OptionalPropertyValue -InputObject $health -Name "accepted" -DefaultValue 0), [ref]$accepted)
            [void][int]::TryParse([string](Get-OptionalPropertyValue -InputObject $health -Name "enriched" -DefaultValue 0), [ref]$enriched)
            $results[$entry.Key] = [ordered]@{
                reachable = $true
                ready = ((Get-OptionalPropertyValue -InputObject $health -Name "ready" -DefaultValue $false) -eq $true)
                schema_version = [string](Get-OptionalPropertyValue -InputObject $health -Name "schema_version" -DefaultValue "")
                source = [string](Get-OptionalPropertyValue -InputObject $health -Name "source" -DefaultValue $entry.Key)
                runtime_version = [string](Get-OptionalPropertyValue -InputObject $health -Name "runtime_version" -DefaultValue "")
                accepted = $accepted
                enriched = $enriched
                external_actions_enabled = Get-OptionalPropertyValue -InputObject $health -Name "external_actions_enabled" -DefaultValue $null
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
        if ($null -eq $Health -or -not $Health.Contains($source)) { return $false }
        $entry = $Health[$source]
        if ((Get-OptionalPropertyValue -InputObject $entry -Name "reachable" -DefaultValue $false) -ne $true) { return $false }
        if ((Get-OptionalPropertyValue -InputObject $entry -Name "ready" -DefaultValue $false) -ne $true) { return $false }
        if ([string](Get-OptionalPropertyValue -InputObject $entry -Name "schema_version" -DefaultValue "") -ne "codistan-acquisition-health.v1") { return $false }
        if ([string](Get-OptionalPropertyValue -InputObject $entry -Name "source" -DefaultValue "") -ne $source) { return $false }
        if ((Get-OptionalPropertyValue -InputObject $entry -Name "external_actions_enabled" -DefaultValue $null) -ne $false) { return $false }
    }
    return $true
}

function Wait-OperationalHealth {
    param([int]$TimeoutSeconds = 120)
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    $health = Get-OperationalHealth
    do {
        if (Test-OperationalHealth -Health $health) { return $health }
        Start-Sleep -Seconds 3
        $health = Get-OperationalHealth
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
            (Get-OptionalPropertyValue -InputObject $marker -Name "confirmed" -DefaultValue $false) -eq $true -and
            [string](Get-OptionalPropertyValue -InputObject $marker -Name "upwork_extension_version" -DefaultValue "") -eq [string](Get-OptionalPropertyValue -InputObject $upworkManifest -Name "version" -DefaultValue "") -and
            [string](Get-OptionalPropertyValue -InputObject $marker -Name "linkedin_sales_navigator_extension_version" -DefaultValue "") -eq [string](Get-OptionalPropertyValue -InputObject $linkedinManifest -Name "version" -DefaultValue "") -and
            (Get-OptionalPropertyValue -InputObject $marker -Name "external_actions_enabled" -DefaultValue $null) -eq $false
        )
    } catch {
        return $false
    }
}

$health = Get-OperationalHealth
if (-not (Test-OperationalHealth -Health $health)) {
    Write-Host "Starting Sales Automation collectors..." -ForegroundColor Cyan
    Start-Process -FilePath (Join-Path $commands "START-ACQUISITION-V4.cmd") -WindowStyle Minimized | Out-Null
    $health = Wait-OperationalHealth -TimeoutSeconds 150
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
$pythonExecutable = [string](Get-OptionalPropertyValue -InputObject $pythonCommand -Name "Executable" -DefaultValue "")
$pythonArguments = @(Get-OptionalPropertyValue -InputObject $pythonCommand -Name "Arguments" -DefaultValue @())
if ([string]::IsNullOrWhiteSpace($pythonExecutable)) {
    throw "Python is unavailable after installation. Run setup again."
}
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
    $accepted = [int](Get-OptionalPropertyValue -InputObject $entry -Name "accepted" -DefaultValue 0)
    $enriched = [int](Get-OptionalPropertyValue -InputObject $entry -Name "enriched" -DefaultValue 0)
    $prioritySummary += "${source}: $accepted accepted, $enriched enriched"
}

Write-Host ""
Write-Host "Sales Automation is running and lead capture is open." -ForegroundColor Green
Write-Host ($prioritySummary -join " | ")
Write-Host "Lead desk: $StateRoot\review\index.html"
Write-Host "Status: $statusPath"
Write-Host "Use the Stop Sales Automation desktop shortcut when finished."
