param(
    [string]$InstallRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..\..")).Path,
    [string]$StateRoot = (Join-Path $env:LOCALAPPDATA "Codistan\Acquisition"),
    [switch]$EnableAutoStart
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

function Get-NestedOptionalPropertyValue {
    param(
        [AllowNull()][object]$InputObject,
        [Parameter(Mandatory = $true)][string[]]$Path,
        [AllowNull()][object]$DefaultValue = $null
    )
    $current = $InputObject
    foreach ($segment in $Path) {
        $current = Get-OptionalPropertyValue -InputObject $current -Name $segment -DefaultValue $null
        if ($null -eq $current) { return $DefaultValue }
    }
    return $current
}

$sourceRoot = Join-Path $InstallRoot "workers\acquisition"
if (-not (Test-Path -LiteralPath (Join-Path $sourceRoot "acquisition_v4\supervisor.py"))) {
    throw "The Sales Automation source package was not found."
}
if (-not (Test-Path -LiteralPath (Join-Path $sourceRoot "release-manifest.json"))) {
    throw "The Sales Automation release manifest was not found."
}
$release = Get-Content -LiteralPath (Join-Path $sourceRoot "release-manifest.json") -Raw | ConvertFrom-Json
$releaseProduct = [string](Get-OptionalPropertyValue -InputObject $release -Name "product" -DefaultValue "")
$releaseApplication = [string](Get-OptionalPropertyValue -InputObject $release -Name "application" -DefaultValue "")
$releaseVersion = [string](Get-OptionalPropertyValue -InputObject $release -Name "release_version" -DefaultValue "")
$runtimeVersion = [string](Get-NestedOptionalPropertyValue -InputObject $release -Path @("components", "local_runtime") -DefaultValue "")
$upworkExtensionVersion = [string](Get-NestedOptionalPropertyValue -InputObject $release -Path @("components", "upwork_extension") -DefaultValue "")
$linkedinExtensionVersion = [string](Get-NestedOptionalPropertyValue -InputObject $release -Path @("components", "linkedin_sales_navigator_extension") -DefaultValue "")
if ($releaseProduct -ne "Codistan Sales Automation" -or $releaseApplication -ne "Prospect Desk" -or [string]::IsNullOrWhiteSpace($runtimeVersion)) {
    throw "The release manifest does not identify a complete Codistan Sales Automation / Prospect Desk package."
}

$pythonBootstrap = Join-Path $sourceRoot "scripts\windows\python-bootstrap.ps1"
if (-not (Test-Path -LiteralPath $pythonBootstrap)) {
    throw "The Sales Automation Python bootstrap was not found."
}
. $pythonBootstrap
$pythonCommand = Ensure-CodistanPython
$pythonExecutable = [string](Get-OptionalPropertyValue -InputObject $pythonCommand -Name "Executable" -DefaultValue "")
$pythonArguments = @(Get-OptionalPropertyValue -InputObject $pythonCommand -Name "Arguments" -DefaultValue @())
$pythonVersion = [string](Get-OptionalPropertyValue -InputObject $pythonCommand -Name "Version" -DefaultValue "")
if ([string]::IsNullOrWhiteSpace($pythonExecutable)) {
    throw "Python 3.12 or later could not be resolved after bootstrap."
}

New-Item -ItemType Directory -Force -Path $StateRoot | Out-Null
$configDirectory = Join-Path $StateRoot "config"
$configPath = Join-Path $configDirectory "prospect-desk-sync.json"
New-Item -ItemType Directory -Force -Path $configDirectory | Out-Null
$enabledSources = @("linkedin", "upwork", "sales_navigator")
if (-not (Test-Path -LiteralPath $configPath)) {
    [ordered]@{
        version = 1
        enabled = $false
        endpoint = ""
        token = ""
        sources = $enabledSources
        interval_seconds = 60
    } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $configPath -Encoding UTF8
} else {
    try {
        $existingConfig = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
        $existingEnabled = Get-OptionalPropertyValue -InputObject $existingConfig -Name "enabled" -DefaultValue $false
        $existingEndpoint = [string](Get-OptionalPropertyValue -InputObject $existingConfig -Name "endpoint" -DefaultValue "")
        $existingToken = [string](Get-OptionalPropertyValue -InputObject $existingConfig -Name "token" -DefaultValue "")
        $existingInterval = Get-OptionalPropertyValue -InputObject $existingConfig -Name "interval_seconds" -DefaultValue 60
        $intervalSeconds = 60
        if (-not [int]::TryParse([string]$existingInterval, [ref]$intervalSeconds) -or $intervalSeconds -lt 15) {
            $intervalSeconds = 60
        }
        $migratedConfig = [ordered]@{
            version = 1
            enabled = ($existingEnabled -eq $true)
            endpoint = $existingEndpoint
            token = $existingToken
            sources = $enabledSources
            interval_seconds = $intervalSeconds
        }
        $migratedConfig | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $configPath -Encoding UTF8
    } catch {
        throw "The existing Prospect Desk sync configuration is invalid. Run Configure Prospect Desk Sync again or repair $configPath before reinstalling."
    }
}

$operationalConfigPath = Join-Path $configDirectory "operational-pilot.json"
if (-not (Test-Path -LiteralPath $operationalConfigPath)) {
    [ordered]@{
        schema_version = "codistan-sales-automation-operational-pilot.v1"
        open_lead_desk_on_start = $true
        open_upwork_searches_on_start = $true
        open_linkedin_searches_on_start = $true
        sales_navigator_requires_registered_campaign = $true
        external_actions_enabled = $false
        created_at = (Get-Date).ToUniversalTime().ToString("o")
    } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $operationalConfigPath -Encoding UTF8
}

$cleanupAutoStartScript = Join-Path $sourceRoot "scripts\windows\cleanup-sales-automation-autostart.ps1"
$stopScript = Join-Path $sourceRoot "scripts\windows\stop-sales-automation.ps1"
if (-not (Test-Path -LiteralPath $cleanupAutoStartScript)) { throw "The Sales Automation auto-start cleanup command was not found." }
if (-not (Test-Path -LiteralPath $stopScript)) { throw "The Sales Automation stop command was not found." }

# Upgrades remove legacy sign-in launch registrations before changing application files.
# The cleanup command is deliberately scoped to known Sales Automation/Acquisition entries.
& $cleanupAutoStartScript -StateRoot $StateRoot
& $stopScript -StateRoot $StateRoot
Start-Sleep -Seconds 1

$appCurrent = Join-Path $StateRoot "app-current"
$appPrevious = Join-Path $StateRoot "app-previous"
if (Test-Path -LiteralPath $appPrevious) { Remove-Item -LiteralPath $appPrevious -Recurse -Force }
if (Test-Path -LiteralPath $appCurrent) { Move-Item -LiteralPath $appCurrent -Destination $appPrevious }
New-Item -ItemType Directory -Force -Path (Join-Path $appCurrent "workers") | Out-Null
Copy-Item -Path $sourceRoot -Destination (Join-Path $appCurrent "workers\acquisition") -Recurse -Force
Get-ChildItem -LiteralPath (Join-Path $appCurrent "workers\acquisition") -Directory -Recurse -Filter __pycache__ -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force

$extensionRoot = Join-Path $StateRoot "extensions"
foreach ($source in @("upwork", "linkedin")) {
    $target = Join-Path $extensionRoot $source
    if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force }
    New-Item -ItemType Directory -Force -Path $target | Out-Null
    Copy-Item -Path (Join-Path $appCurrent "workers\acquisition\extensions\$source\*") -Destination $target -Recurse -Force
}

function New-Shortcut {
    param(
        [string]$Path,
        [string]$Target,
        [string]$WorkingDirectory,
        [int]$WindowStyle = 1
    )
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($Path)
    $shortcut.TargetPath = $Target
    $shortcut.WorkingDirectory = $WorkingDirectory
    $shortcut.WindowStyle = $WindowStyle
    $shortcut.Save()
}

$commands = Join-Path $appCurrent "workers\acquisition"
$desktop = [Environment]::GetFolderPath("Desktop")
$startup = [Environment]::GetFolderPath("Startup")
$legacyDesktopShortcutNames = @(
    "Run Sales Automation.lnk",
    "Start Sales Automation.lnk",
    "Stop Sales Automation.lnk",
    "Open Lead Desk.lnk",
    "Setup Browser Extensions.lnk",
    "Sales Navigator Campaigns.lnk",
    "Check Sales Automation Release.lnk",
    "Check Sales Automation Pilot.lnk",
    "Diagnose Sales Automation.lnk",
    "Rollback Sales Automation.lnk",
    "Configure Prospect Desk Sync.lnk",
    "Open Upwork Searches.lnk",
    "Open LinkedIn Lead Searches.lnk",
    "Open Acquisition Review.lnk",
    "Check Sales Navigator Pilot.lnk",
    "Start Acquisition V5.lnk",
    "Check Acquisition V5.lnk",
    "Diagnose Acquisition V5.lnk",
    "Rollback Acquisition V5.lnk"
)
foreach ($shortcutName in $legacyDesktopShortcutNames) {
    Remove-Item -LiteralPath (Join-Path $desktop $shortcutName) -Force -ErrorAction SilentlyContinue
}

New-Shortcut (Join-Path $desktop "Start Sales Automation.lnk") (Join-Path $commands "RUN-SALES-AUTOMATION.cmd") $commands 1
New-Shortcut (Join-Path $desktop "Stop Sales Automation.lnk") (Join-Path $commands "STOP-SALES-AUTOMATION.cmd") $commands 1
New-Shortcut (Join-Path $desktop "Open Lead Desk.lnk") (Join-Path $commands "OPEN-ACQUISITION-REVIEW.cmd") $commands 1
New-Shortcut (Join-Path $desktop "Setup Browser Extensions.lnk") (Join-Path $commands "SETUP-SALES-AUTOMATION-EXTENSIONS.cmd") $commands 1

if ($EnableAutoStart) {
    # Autostart is runtime-only. Browser searches and the lead desk remain a deliberate operator action.
    New-Shortcut (Join-Path $startup "Codistan Sales Automation.lnk") (Join-Path $commands "START-SALES-AUTOMATION.cmd") $commands 7
}

# Start only for the bounded installation health check. The runtime is stopped again
# before a successful install returns, so normal operation always begins through the Start shortcut.
Start-Process -FilePath (Join-Path $commands "START-ACQUISITION-V4.cmd") -WindowStyle Minimized
$healthy = $false
for ($attempt = 0; $attempt -lt 60; $attempt++) {
    Start-Sleep -Seconds 1
    try {
        $upwork = Invoke-RestMethod -Uri "http://127.0.0.1:8765/health" -TimeoutSec 2
        $linkedin = Invoke-RestMethod -Uri "http://127.0.0.1:8775/health" -TimeoutSec 2
        $salesNavigator = Invoke-RestMethod -Uri "http://127.0.0.1:8785/health" -TimeoutSec 2
        $versionMatches = (
            [string](Get-OptionalPropertyValue -InputObject $upwork -Name "runtime_version" -DefaultValue "") -eq $runtimeVersion -and
            [string](Get-OptionalPropertyValue -InputObject $linkedin -Name "runtime_version" -DefaultValue "") -eq $runtimeVersion -and
            [string](Get-OptionalPropertyValue -InputObject $salesNavigator -Name "runtime_version" -DefaultValue "") -eq $runtimeVersion
        )
        $safe = (
            (Get-OptionalPropertyValue -InputObject $upwork -Name "external_actions_enabled" -DefaultValue $null) -eq $false -and
            (Get-OptionalPropertyValue -InputObject $linkedin -Name "external_actions_enabled" -DefaultValue $null) -eq $false -and
            (Get-OptionalPropertyValue -InputObject $salesNavigator -Name "external_actions_enabled" -DefaultValue $null) -eq $false
        )
        $ready = (
            (Get-OptionalPropertyValue -InputObject $upwork -Name "ready" -DefaultValue $false) -eq $true -and
            (Get-OptionalPropertyValue -InputObject $linkedin -Name "ready" -DefaultValue $false) -eq $true -and
            (Get-OptionalPropertyValue -InputObject $salesNavigator -Name "ready" -DefaultValue $false) -eq $true
        )
        if ($ready -and $versionMatches -and $safe) { $healthy = $true; break }
    } catch {}
}

$installedStopScript = Join-Path $commands "scripts\windows\stop-sales-automation.ps1"
& $installedStopScript -StateRoot $StateRoot

if (-not $healthy) {
    if (Test-Path -LiteralPath $appPrevious) {
        if (Test-Path -LiteralPath $appCurrent) { Remove-Item -LiteralPath $appCurrent -Recurse -Force }
        Move-Item -LiteralPath $appPrevious -Destination $appCurrent
    }
    throw "The installed collectors did not satisfy the Sales Automation runtime contract. The previous application folder was restored where available."
}

$previousPythonPath = $env:PYTHONPATH
$env:PYTHONPATH = $commands
try {
    $reviewCode = "from pathlib import Path; from acquisition_v4.review_v5 import write_review_outputs; write_review_outputs(Path(__import__('sys').argv[1]))"
    & $pythonExecutable @pythonArguments -c $reviewCode $StateRoot | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "The initial local lead desk could not be generated." }
} finally {
    $env:PYTHONPATH = $previousPythonPath
}

Write-Host ""
Write-Host "$releaseProduct / $releaseApplication $releaseVersion installed and healthy." -ForegroundColor Green
Write-Host "Python: $pythonVersion"
Write-Host "Runtime: $runtimeVersion"
Write-Host "Upwork extension: $upworkExtensionVersion"
Write-Host "LinkedIn/Sales Navigator extension: $linkedinExtensionVersion"
Write-Host "Extensions: $extensionRoot"
Write-Host "State preserved at: $StateRoot"
Write-Host "Lead desk: $StateRoot\review\index.html"
Write-Host "Sync sources: LinkedIn warm, Upwork warm and Sales Navigator cold campaigns"
Write-Host "External actions remain disabled."
if ($EnableAutoStart) {
    Write-Warning "Runtime-only Windows startup was explicitly enabled."
} else {
    Write-Host "Manual start is the default."
}
Write-Host ""
Write-Host "Desktop shortcuts created:" -ForegroundColor Cyan
Write-Host "  Start Sales Automation"
Write-Host "  Stop Sales Automation"
Write-Host "  Open Lead Desk"
Write-Host "  Setup Browser Extensions"
Write-Host ""
Write-Host "The installation health check is complete and the runtime is stopped."
Write-Host "Run the Start Sales Automation shortcut to start collectors, open approved searches and open the lead desk."
