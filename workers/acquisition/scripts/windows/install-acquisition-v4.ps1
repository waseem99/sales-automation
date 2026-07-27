param(
    [string]$InstallRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..\..")).Path,
    [string]$StateRoot = (Join-Path $env:LOCALAPPDATA "Codistan\Acquisition")
)

$ErrorActionPreference = "Stop"
$sourceRoot = Join-Path $InstallRoot "workers\acquisition"
if (-not (Test-Path (Join-Path $sourceRoot "acquisition_v4\supervisor.py"))) {
    throw "The TalentTrack runtime source package was not found."
}
if (-not (Test-Path (Join-Path $sourceRoot "RELEASE.json"))) {
    throw "The TalentTrack release manifest was not found."
}
if (-not (Test-Path (Join-Path $sourceRoot "requirements.txt"))) {
    throw "The TalentTrack Python requirements file was not found."
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
    if (-not $pythonCommand) { throw "Python 3.12 was installed but is not available yet. Sign out and rerun START-HERE-TALENTTRACK." }
}

New-Item -ItemType Directory -Force -Path $StateRoot | Out-Null
$configDirectory = Join-Path $StateRoot "config"
$configPath = Join-Path $configDirectory "prospect-desk-sync.json"
$localPostgresEnvPath = Join-Path $configDirectory "local-postgres.env"
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

$watchdogPidFile = Join-Path $StateRoot "watchdog.pid"
if (Test-Path $watchdogPidFile) {
    $watchdogProcessId = 0
    [void][int]::TryParse((Get-Content $watchdogPidFile -Raw).Trim(), [ref]$watchdogProcessId)
    if ($watchdogProcessId -gt 0) { Stop-Process -Id $watchdogProcessId -Force -ErrorAction SilentlyContinue }
    Remove-Item $watchdogPidFile -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 1
}
$pidFile = Join-Path $StateRoot "runtime.pid"
if (Test-Path $pidFile) {
    $runtimeProcessId = 0
    [void][int]::TryParse((Get-Content $pidFile -Raw).Trim(), [ref]$runtimeProcessId)
    if ($runtimeProcessId -gt 0) { Stop-Process -Id $runtimeProcessId -Force -ErrorAction SilentlyContinue }
    Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
}
Get-NetTCPConnection -State Listen -LocalPort 8765,8775,8785 -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique |
    ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 1

$appCurrent = Join-Path $StateRoot "app-current"
$appPrevious = Join-Path $StateRoot "app-previous"
if (Test-Path $appPrevious) { Remove-Item $appPrevious -Recurse -Force }
if (Test-Path $appCurrent) { Move-Item $appCurrent $appPrevious }
New-Item -ItemType Directory -Force -Path (Join-Path $appCurrent "workers") | Out-Null
Copy-Item -Path $sourceRoot -Destination (Join-Path $appCurrent "workers\acquisition") -Recurse -Force
Get-ChildItem (Join-Path $appCurrent "workers\acquisition") -Directory -Recurse -Filter __pycache__ -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force

$commands = Join-Path $appCurrent "workers\acquisition"
$pythonExe = [string]$pythonCommand[0]
$pythonPrefixArgs = @()
if ($pythonCommand.Count -gt 1) { $pythonPrefixArgs = @($pythonCommand[1..($pythonCommand.Count - 1)]) }
Write-Host "Installing the pinned TalentTrack Python runtime dependency..."
& $pythonExe @pythonPrefixArgs -m pip install --disable-pip-version-check --user --requirement (Join-Path $commands "requirements.txt")
if ($LASTEXITCODE -ne 0) {
    if (Test-Path $appPrevious) {
        if (Test-Path $appCurrent) { Remove-Item $appCurrent -Recurse -Force }
        Move-Item $appPrevious $appCurrent
    }
    throw "TalentTrack Python dependency installation failed. The previous application package was restored."
}

$extensionRoot = Join-Path $StateRoot "extensions"
foreach ($source in @("upwork", "linkedin")) {
    $target = Join-Path $extensionRoot $source
    if (Test-Path $target) { Remove-Item $target -Recurse -Force }
    New-Item -ItemType Directory -Force -Path $target | Out-Null
    Copy-Item -Path (Join-Path $commands "extensions\$source\*") -Destination $target -Recurse -Force
}

function New-Shortcut([string]$Path, [string]$Target, [string]$WorkingDirectory, [int]$WindowStyle = 7) {
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($Path)
    $shortcut.TargetPath = $Target
    $shortcut.WorkingDirectory = $WorkingDirectory
    $shortcut.WindowStyle = $WindowStyle
    $shortcut.Save()
}

$desktop = [Environment]::GetFolderPath("Desktop")
$startup = [Environment]::GetFolderPath("Startup")
$legacyShortcutNames = @(
    "Start Acquisition V5.lnk",
    "Check Acquisition V5.lnk",
    "Diagnose Acquisition V5.lnk",
    "Rollback Acquisition V5.lnk",
    "Codistan Acquisition V5.lnk"
)
foreach ($legacyName in $legacyShortcutNames) {
    Remove-Item (Join-Path $desktop $legacyName) -Force -ErrorAction SilentlyContinue
    Remove-Item (Join-Path $startup $legacyName) -Force -ErrorAction SilentlyContinue
}
$shortcutMap = @{
    "Start TalentTrack Pilot.lnk" = "START-TALENTTRACK.cmd"
    "Check TalentTrack Pilot.lnk" = "CHECK-TALENTTRACK.cmd"
    "Check Sales Navigator Pilot.lnk" = "CHECK-SALES-NAVIGATOR-PILOT.cmd"
    "Configure Prospect Desk Sync.lnk" = "CONFIGURE-PROSPECT-DESK-SYNC.cmd"
    "Open Upwork Searches.lnk" = "OPEN-UPWORK-SEARCHES.cmd"
    "Open LinkedIn Lead Searches.lnk" = "OPEN-LINKEDIN-LEAD-SEARCHES.cmd"
    "Open TalentTrack Review.lnk" = "OPEN-TALENTTRACK-REVIEW.cmd"
    "TalentTrack Pilot Diagnostics.lnk" = "DIAGNOSE-TALENTTRACK.cmd"
    "Rollback TalentTrack Pilot.lnk" = "ROLLBACK-TALENTTRACK.cmd"
    "Enable TalentTrack Local PostgreSQL.lnk" = "ENABLE-TALENTTRACK-POSTGRES.cmd"
    "Check TalentTrack Local PostgreSQL.lnk" = "CHECK-TALENTTRACK-POSTGRES.cmd"
    "Backup TalentTrack Local PostgreSQL.lnk" = "BACKUP-TALENTTRACK-POSTGRES.cmd"
    "Restore TalentTrack Local PostgreSQL.lnk" = "RESTORE-TALENTTRACK-POSTGRES.cmd"
}
foreach ($entry in $shortcutMap.GetEnumerator()) {
    New-Shortcut (Join-Path $desktop $entry.Key) (Join-Path $commands $entry.Value) $commands
}
New-Shortcut (Join-Path $startup "Codistan TalentTrack Pilot.lnk") (Join-Path $commands "START-TALENTTRACK.cmd") $commands

$expectedBackend = if (Test-Path $localPostgresEnvPath) { "postgresql" } else { "jsonl" }
Start-Process -FilePath (Join-Path $commands "START-TALENTTRACK.cmd") -WindowStyle Minimized
$healthy = $false
for ($attempt = 0; $attempt -lt 60; $attempt++) {
    Start-Sleep -Seconds 1
    try {
        $upwork = Invoke-RestMethod -Uri "http://127.0.0.1:8765/health" -TimeoutSec 2
        $linkedin = Invoke-RestMethod -Uri "http://127.0.0.1:8775/health" -TimeoutSec 2
        $salesNavigator = Invoke-RestMethod -Uri "http://127.0.0.1:8785/health" -TimeoutSec 2
        if ($upwork.ready -and $linkedin.ready -and $salesNavigator.ready -and
            $upwork.storage_backend -eq $expectedBackend -and
            $linkedin.storage_backend -eq $expectedBackend -and
            $salesNavigator.storage_backend -eq $expectedBackend) {
            $healthy = $true
            break
        }
    } catch {}
}
if (-not $healthy) {
    foreach ($pidName in @("watchdog.pid", "runtime.pid")) {
        $failedPidPath = Join-Path $StateRoot $pidName
        if (Test-Path $failedPidPath) {
            $failedProcessId = 0
            [void][int]::TryParse((Get-Content $failedPidPath -Raw).Trim(), [ref]$failedProcessId)
            if ($failedProcessId -gt 0) { Stop-Process -Id $failedProcessId -Force -ErrorAction SilentlyContinue }
            Remove-Item $failedPidPath -Force -ErrorAction SilentlyContinue
        }
    }
    Get-NetTCPConnection -State Listen -LocalPort 8765,8775,8785 -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty OwningProcess -Unique |
        ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }
    if (Test-Path $appPrevious) {
        if (Test-Path $appCurrent) { Remove-Item $appCurrent -Recurse -Force }
        Move-Item $appPrevious $appCurrent
    }
    throw "The TalentTrack collectors did not become healthy on $expectedBackend storage. The previous application folder was restored where available."
}

$release = Get-Content (Join-Path $commands "RELEASE.json") -Raw | ConvertFrom-Json
Write-Host ""
Write-Host "TalentTrack Pilot $($release.product_version) installed and healthy."
Write-Host "Runtime version: $($release.runtime_version)"
Write-Host "Storage backend: $expectedBackend"
Write-Host "Extensions: $extensionRoot"
Write-Host "State and captured records preserved at: $StateRoot"
Write-Host "Prospect Desk sync config: $configPath"
Write-Host "Sync sources: LinkedIn warm, Upwork and Sales Navigator cold campaigns"
Write-Host "Load or reload both unpacked extensions in chrome://extensions/."
Write-Host "Open the LinkedIn extension popup, then open Sales Navigator campaigns to register an approved lead search."
Write-Host "Use Check Sales Navigator Pilot after each live run to measure the acceptance gate."
Write-Host "Use Configure Prospect Desk Sync once the production endpoint and token are ready."
if ($expectedBackend -eq "jsonl") {
    Write-Host "Optional: use Enable TalentTrack Local PostgreSQL after Docker Desktop is installed."
} else {
    Write-Host "Local PostgreSQL remains enabled; use its Check, Backup and Restore shortcuts for operations."
}
