param(
    [string]$InstallRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..\..")).Path,
    [string]$StateRoot = (Join-Path $env:LOCALAPPDATA "Codistan\Acquisition"),
    [switch]$EnableAutoStart
)

$ErrorActionPreference = "Stop"
$sourceRoot = Join-Path $InstallRoot "workers\acquisition"
if (-not (Test-Path (Join-Path $sourceRoot "acquisition_v4\supervisor.py"))) {
    throw "The Sales Automation source package was not found."
}
if (-not (Test-Path (Join-Path $sourceRoot "release-manifest.json"))) {
    throw "The Sales Automation release manifest was not found."
}
$release = Get-Content (Join-Path $sourceRoot "release-manifest.json") -Raw | ConvertFrom-Json
if ([string]$release.product -ne "Codistan Sales Automation" -or [string]$release.application -ne "Prospect Desk") {
    throw "The release manifest does not identify Codistan Sales Automation and Prospect Desk."
}

function Find-Python312 {
    $py = Get-Command py.exe -ErrorAction SilentlyContinue
    if ($py) {
        & $py.Source -3.12 -c "import sys; assert sys.version_info >= (3, 12)" 2>$null
        if ($LASTEXITCODE -eq 0) { return @($py.Source, "-3.12") }
    }
    $python = Get-Command python.exe -ErrorAction SilentlyContinue
    if ($python) {
        & $python.Source -c "import sys; assert sys.version_info >= (3, 12)" 2>$null
        if ($LASTEXITCODE -eq 0) { return @($python.Source) }
    }
    return $null
}

$pythonCommand = Find-Python312
if (-not $pythonCommand) {
    $winget = Get-Command winget.exe -ErrorAction SilentlyContinue
    if (-not $winget) { throw "Python 3.12 is required and winget is unavailable." }
    Write-Host "Installing Python 3.12 for the current user..."
    & $winget.Source install --exact --id Python.Python.3.12 --scope user --accept-package-agreements --accept-source-agreements
    if ($LASTEXITCODE -ne 0) { throw "Python 3.12 installation failed." }
    $env:Path = [Environment]::GetEnvironmentVariable("Path", "User") + ";" + [Environment]::GetEnvironmentVariable("Path", "Machine")
    $pythonCommand = Find-Python312
    if (-not $pythonCommand) { throw "Python 3.12 was installed but is not available yet. Sign out and rerun START-HERE-SALES-AUTOMATION.cmd." }
}

New-Item -ItemType Directory -Force -Path $StateRoot | Out-Null
$configDirectory = Join-Path $StateRoot "config"
$configPath = Join-Path $configDirectory "prospect-desk-sync.json"
New-Item -ItemType Directory -Force -Path $configDirectory | Out-Null
$enabledSources = @("linkedin", "upwork", "sales_navigator")
if (-not (Test-Path $configPath)) {
    [ordered]@{
        version = 1
        enabled = $false
        endpoint = ""
        token = ""
        sources = $enabledSources
        interval_seconds = 60
    } | ConvertTo-Json -Depth 5 | Set-Content -Path $configPath -Encoding UTF8
} else {
    try {
        $existingConfig = Get-Content $configPath -Raw | ConvertFrom-Json
        $migratedConfig = [ordered]@{
            version = 1
            enabled = ($existingConfig.enabled -eq $true)
            endpoint = if ($existingConfig.endpoint) { [string]$existingConfig.endpoint } else { "" }
            token = if ($existingConfig.token) { [string]$existingConfig.token } else { "" }
            sources = $enabledSources
            interval_seconds = if ($existingConfig.interval_seconds) { [int]$existingConfig.interval_seconds } else { 60 }
        }
        $migratedConfig | ConvertTo-Json -Depth 5 | Set-Content -Path $configPath -Encoding UTF8
    } catch {
        throw "The existing Prospect Desk sync configuration is invalid. Run Configure Prospect Desk Sync again or remove $configPath before reinstalling."
    }
}

$cleanupAutoStartScript = Join-Path $sourceRoot "scripts\windows\cleanup-sales-automation-autostart.ps1"
$stopScript = Join-Path $sourceRoot "scripts\windows\stop-sales-automation.ps1"
if (-not (Test-Path $cleanupAutoStartScript)) { throw "The Sales Automation auto-start cleanup command was not found." }
if (-not (Test-Path $stopScript)) { throw "The Sales Automation stop command was not found." }

# Upgrades remove legacy sign-in launch registrations before changing application files.
# The cleanup command is deliberately scoped to known Sales Automation/Acquisition entries.
& $cleanupAutoStartScript -StateRoot $StateRoot
& $stopScript -StateRoot $StateRoot
Start-Sleep -Seconds 1

$appCurrent = Join-Path $StateRoot "app-current"
$appPrevious = Join-Path $StateRoot "app-previous"
if (Test-Path $appPrevious) { Remove-Item $appPrevious -Recurse -Force }
if (Test-Path $appCurrent) { Move-Item $appCurrent $appPrevious }
New-Item -ItemType Directory -Force -Path (Join-Path $appCurrent "workers") | Out-Null
Copy-Item -Path $sourceRoot -Destination (Join-Path $appCurrent "workers\acquisition") -Recurse -Force
Get-ChildItem (Join-Path $appCurrent "workers\acquisition") -Directory -Recurse -Filter __pycache__ -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force

$extensionRoot = Join-Path $StateRoot "extensions"
foreach ($source in @("upwork", "linkedin")) {
    $target = Join-Path $extensionRoot $source
    if (Test-Path $target) { Remove-Item $target -Recurse -Force }
    New-Item -ItemType Directory -Force -Path $target | Out-Null
    Copy-Item -Path (Join-Path $appCurrent "workers\acquisition\extensions\$source\*") -Destination $target -Recurse -Force
}

function New-Shortcut([string]$Path, [string]$Target, [string]$WorkingDirectory, [int]$WindowStyle = 7) {
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
    Remove-Item (Join-Path $desktop $shortcutName) -Force -ErrorAction SilentlyContinue
}
New-Shortcut (Join-Path $desktop "Run Sales Automation.lnk") (Join-Path $commands "START-SALES-AUTOMATION.cmd") $commands

if ($EnableAutoStart) {
    New-Shortcut (Join-Path $startup "Codistan Sales Automation.lnk") (Join-Path $commands "START-SALES-AUTOMATION.cmd") $commands
}

# Start only for the bounded installation health check. The runtime is stopped again
# before a successful install returns, so normal operation always begins manually.
Start-Process -FilePath (Join-Path $commands "START-SALES-AUTOMATION.cmd") -WindowStyle Minimized
$healthy = $false
for ($attempt = 0; $attempt -lt 25; $attempt++) {
    Start-Sleep -Seconds 1
    try {
        $upwork = Invoke-RestMethod -Uri "http://127.0.0.1:8765/health" -TimeoutSec 2
        $linkedin = Invoke-RestMethod -Uri "http://127.0.0.1:8775/health" -TimeoutSec 2
        $salesNavigator = Invoke-RestMethod -Uri "http://127.0.0.1:8785/health" -TimeoutSec 2
        $versionMatches = ([string]$upwork.runtime_version -eq [string]$release.components.local_runtime) -and ([string]$linkedin.runtime_version -eq [string]$release.components.local_runtime) -and ([string]$salesNavigator.runtime_version -eq [string]$release.components.local_runtime)
        $safe = ($upwork.external_actions_enabled -eq $false) -and ($linkedin.external_actions_enabled -eq $false) -and ($salesNavigator.external_actions_enabled -eq $false)
        if ($upwork.ready -and $linkedin.ready -and $salesNavigator.ready -and $versionMatches -and $safe) { $healthy = $true; break }
    } catch {}
}

$installedStopScript = Join-Path $commands "scripts\windows\stop-sales-automation.ps1"
& $installedStopScript -StateRoot $StateRoot

if (-not $healthy) {
    if (Test-Path $appPrevious) {
        if (Test-Path $appCurrent) { Remove-Item $appCurrent -Recurse -Force }
        Move-Item $appPrevious $appCurrent
    }
    throw "The installed collectors did not satisfy the Sales Automation release contract. The previous application folder was restored where available."
}

Write-Host ""
Write-Host "$($release.product) / $($release.application) $($release.release_version) installed and healthy."
Write-Host "Runtime: $($release.components.local_runtime)"
Write-Host "Upwork extension: $($release.components.upwork_extension)"
Write-Host "LinkedIn/Sales Navigator extension: $($release.components.linkedin_sales_navigator_extension)"
Write-Host "Commercial readiness: $($release.components.commercial_readiness)"
Write-Host "Extensions: $extensionRoot"
Write-Host "State preserved at: $StateRoot"
Write-Host "Prospect Desk sync config: $configPath"
Write-Host "Sync sources: LinkedIn warm, Upwork warm and Sales Navigator cold campaigns"
Write-Host "External actions remain disabled."
if ($EnableAutoStart) {
    Write-Warning "Automatic Windows startup was explicitly enabled with -EnableAutoStart."
} else {
    Write-Host "Manual start is the default. Use the Run Sales Automation desktop shortcut when work begins."
}
Write-Host "The installation health check is complete and the runtime is stopped."
Write-Host "Stop command: STOP-SALES-AUTOMATION.cmd"
Write-Host "Auto-start cleanup command: CLEANUP-SALES-AUTOMATION-AUTOSTART.cmd"
Write-Host "Load or reload both unpacked extensions in chrome://extensions/."
Write-Host "Run Check Sales Automation Release before capture and Check Sales Automation Pilot before any release merge."
