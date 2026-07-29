param(
    [string]$StateRoot = (Join-Path $env:LOCALAPPDATA "Codistan\Acquisition"),
    [string]$ManifestPath = ""
)

$ErrorActionPreference = "Stop"
$checks = [System.Collections.Generic.List[object]]::new()

function Add-Check {
    param(
        [string]$Name,
        [bool]$Passed,
        [string]$Severity,
        [string]$Message,
        [hashtable]$Details = @{}
    )
    $checks.Add([ordered]@{
        name = $Name
        passed = $Passed
        severity = $Severity
        message = $Message
        details = $Details
    }) | Out-Null
}

function Read-JsonFile([string]$Path) {
    if (-not (Test-Path $Path)) { return $null }
    return Get-Content $Path -Raw | ConvertFrom-Json
}

if (-not $ManifestPath) {
    $installedManifest = Join-Path $StateRoot "app-current\workers\acquisition\release-manifest.json"
    $sourceManifest = Join-Path (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path "release-manifest.json"
    $ManifestPath = if (Test-Path $installedManifest) { $installedManifest } else { $sourceManifest }
}

$manifest = Read-JsonFile $ManifestPath
if (-not $manifest) {
    Add-Check "release_manifest" $false "blocker" "Release manifest was not found." @{ path = $ManifestPath }
    $manifest = [pscustomobject]@{
        product = "Codistan Sales Automation"
        application = "Prospect Desk"
        release_version = "unknown"
        components = [pscustomobject]@{
            local_runtime = "unknown"
            upwork_extension = "unknown"
            linkedin_sales_navigator_extension = "unknown"
        }
        collectors = @()
    }
} else {
    $identityValid = ([string]$manifest.product -eq "Codistan Sales Automation") -and ([string]$manifest.application -eq "Prospect Desk")
    Add-Check "release_identity" $identityValid "blocker" ($(if ($identityValid) { "Release identity matches Sales Automation and Prospect Desk." } else { "Release identity is incorrect." })) @{ product = [string]$manifest.product; application = [string]$manifest.application }
    Add-Check "release_manifest" $true "info" "Release manifest loaded." @{ path = $ManifestPath; release = $manifest.release_version }
}

$appCurrent = Join-Path $StateRoot "app-current"
$appPrevious = Join-Path $StateRoot "app-previous"
Add-Check "installed_package" (Test-Path $appCurrent) "blocker" ($(if (Test-Path $appCurrent) { "Current package is installed." } else { "Current package folder is missing." })) @{ path = $appCurrent }
Add-Check "rollback_package" (Test-Path $appPrevious) "warning" ($(if (Test-Path $appPrevious) { "Previous package is available for rollback." } else { "No previous package is available yet; this is expected on a first install." })) @{ path = $appPrevious }

$extensionRoot = Join-Path $StateRoot "extensions"
$extensionSpecs = @(
    @{ name = "upwork_extension"; folder = "upwork"; expected = [string]$manifest.components.upwork_extension },
    @{ name = "linkedin_sales_navigator_extension"; folder = "linkedin"; expected = [string]$manifest.components.linkedin_sales_navigator_extension }
)
foreach ($spec in $extensionSpecs) {
    $path = Join-Path (Join-Path $extensionRoot $spec.folder) "manifest.json"
    $extensionManifest = Read-JsonFile $path
    $passed = $null -ne $extensionManifest -and [string]$extensionManifest.version -eq $spec.expected
    $actual = if ($extensionManifest) { [string]$extensionManifest.version } else { "missing" }
    Add-Check $spec.name $passed "blocker" ($(if ($passed) { "Extension version matches the release manifest." } else { "Extension is missing or has the wrong version." })) @{ path = $path; expected = $spec.expected; actual = $actual }
}

foreach ($collector in @($manifest.collectors)) {
    $source = [string]$collector.source
    $port = [int]$collector.port
    $uri = "http://127.0.0.1:$port/health"
    try {
        $health = Invoke-RestMethod -Uri $uri -TimeoutSec 3
        $passed = ($health.ready -eq $true) -and ([string]$health.source -eq $source) -and ([string]$health.runtime_version -eq [string]$manifest.components.local_runtime) -and ($health.external_actions_enabled -eq $false) -and -not [string]$health.last_error
        Add-Check "collector_$source" $passed "blocker" ($(if ($passed) { "Collector is healthy and external actions are disabled." } else { "Collector health does not match the release contract." })) @{
            uri = $uri
            ready = [bool]$health.ready
            source = [string]$health.source
            runtime_version = [string]$health.runtime_version
            expected_runtime = [string]$manifest.components.local_runtime
            parser_version = [string]$health.parser_version
            last_error = [string]$health.last_error
            external_actions_enabled = [bool]$health.external_actions_enabled
            records_path = [string]$health.records_path
        }
    } catch {
        Add-Check "collector_$source" $false "blocker" "Collector health endpoint is unavailable." @{ uri = $uri; error = $_.Exception.Message }
    }
}

$configPath = Join-Path $StateRoot "config\prospect-desk-sync.json"
$config = Read-JsonFile $configPath
$requiredSources = @("upwork", "linkedin", "sales_navigator")
$configuredSources = if ($config -and $config.sources) { @($config.sources | ForEach-Object { [string]$_ }) } else { @() }
$sourceCoverage = ($requiredSources | Where-Object { $_ -notin $configuredSources }).Count -eq 0
$validEndpoint = $false
if ($config -and $config.endpoint) {
    try {
        $endpointUri = [uri][string]$config.endpoint
        $validEndpoint = $endpointUri.Scheme -eq "https" -and $endpointUri.AbsolutePath.TrimEnd('/') -eq "/api/acquisition-ingest"
    } catch { $validEndpoint = $false }
}
$syncConfigured = $config -and ($config.enabled -eq $true) -and $validEndpoint -and -not [string]::IsNullOrWhiteSpace([string]$config.token) -and $sourceCoverage
Add-Check "prospect_desk_sync" $syncConfigured "blocker" ($(if ($syncConfigured) { "Prospect Desk synchronization is configured for all three sources." } else { "Prospect Desk synchronization is not ready for the full commercial pilot." })) @{
    path = $configPath
    enabled = if ($config) { [bool]$config.enabled } else { $false }
    endpoint_host = if ($validEndpoint) { ([uri][string]$config.endpoint).Host } else { "" }
    token_present = if ($config) { -not [string]::IsNullOrWhiteSpace([string]$config.token) } else { $false }
    sources = $configuredSources
    required_sources = $requiredSources
}

$reviewPath = Join-Path $StateRoot "review\index.html"
Add-Check "local_review" (Test-Path $reviewPath) "warning" ($(if (Test-Path $reviewPath) { "Local review dashboard exists." } else { "Local review dashboard has not been generated yet; run a capture first." })) @{ path = $reviewPath }

$blockers = @($checks | Where-Object { -not $_.passed -and $_.severity -eq "blocker" })
$warnings = @($checks | Where-Object { -not $_.passed -and $_.severity -eq "warning" })
$collectorChecks = @($checks | Where-Object { $_.name -like "collector_*" })
$extensionChecks = @($checks | Where-Object { $_.name -like "*_extension" })
$localReady = (@($collectorChecks | Where-Object { -not $_.passed }).Count -eq 0) -and (@($extensionChecks | Where-Object { -not $_.passed }).Count -eq 0) -and (Test-Path $appCurrent)
$commercialReady = $localReady -and $syncConfigured -and ($blockers.Count -eq 0)

$report = [ordered]@{
    schema_version = "codistan-sales-automation-readiness.v1"
    product = [string]$manifest.product
    application = [string]$manifest.application
    release_version = [string]$manifest.release_version
    checked_at = (Get-Date).ToUniversalTime().ToString("o")
    state_root = $StateRoot
    ready_for_local_capture = $localReady
    ready_for_commercial_pilot = $commercialReady
    blocker_count = $blockers.Count
    warning_count = $warnings.Count
    checks = $checks
    external_actions_enabled = $false
}

$reviewDirectory = Join-Path $StateRoot "review"
New-Item -ItemType Directory -Force -Path $reviewDirectory | Out-Null
$reportPath = Join-Path $reviewDirectory "sales-automation-release-readiness.json"
$report | ConvertTo-Json -Depth 12 | Set-Content -Path $reportPath -Encoding UTF8

Write-Host ""
Write-Host "$($report.product) / $($report.application) $($report.release_version)"
Write-Host "Local capture ready:     $($report.ready_for_local_capture)"
Write-Host "Commercial pilot ready:  $($report.ready_for_commercial_pilot)"
Write-Host "Blockers:                $($report.blocker_count)"
Write-Host "Warnings:                $($report.warning_count)"
Write-Host "Report:                  $reportPath"
Write-Host "External actions:        disabled"

if ($commercialReady) { exit 0 }
if ($localReady) { exit 2 }
exit 1
