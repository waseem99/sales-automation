param(
    [string]$InstallRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..\..")).Path,
    [string]$StateRoot = (Join-Path $env:LOCALAPPDATA "Codistan\Acquisition")
)

$ErrorActionPreference = "Stop"
$sourceRoot = Join-Path $InstallRoot "workers\acquisition"
if (-not (Test-Path (Join-Path $sourceRoot "acquisition_v4\supervisor.py"))) {
    throw "The Prospecting OS source package was not found."
}
if (-not (Test-Path (Join-Path $sourceRoot "release-manifest.json"))) {
    throw "The Prospecting OS release manifest was not found."
}
$release = Get-Content (Join-Path $sourceRoot "release-manifest.json") -Raw | ConvertFrom-Json

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
    if (-not $pythonCommand) { throw "Python 3.12 was installed but is not available yet. Sign out and rerun START-HERE-PROSPECTING-OS." }
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
$shortcutMap = @{
    "Start Prospecting OS.lnk" = "START-ACQUISITION-V4.cmd"
    "Check Prospecting OS Release.lnk" = "CHECK-PROSPECTING-OS-RELEASE.cmd"
    "Diagnose Prospecting OS.lnk" = "DIAGNOSE-ACQUISITION-V4.cmd"
    "Rollback Prospecting OS.lnk" = "ROLLBACK-ACQUISITION-V4.cmd"
    "Configure Prospect Desk Sync.lnk" = "CONFIGURE-PROSPECT-DESK-SYNC.cmd"
    "Open Upwork Searches.lnk" = "OPEN-UPWORK-SEARCHES.cmd"
    "Open LinkedIn Lead Searches.lnk" = "OPEN-LINKEDIN-LEAD-SEARCHES.cmd"
    "Open Acquisition Review.lnk" = "OPEN-ACQUISITION-REVIEW.cmd"
    "Check Sales Navigator Pilot.lnk" = "CHECK-SALES-NAVIGATOR-PILOT.cmd"
    "Start Acquisition V5.lnk" = "START-ACQUISITION-V4.cmd"
    "Check Acquisition V5.lnk" = "CHECK-ACQUISITION-V4.cmd"
    "Diagnose Acquisition V5.lnk" = "DIAGNOSE-ACQUISITION-V4.cmd"
    "Rollback Acquisition V5.lnk" = "ROLLBACK-ACQUISITION-V4.cmd"
}
foreach ($entry in $shortcutMap.GetEnumerator()) {
    New-Shortcut (Join-Path $desktop $entry.Key) (Join-Path $commands $entry.Value) $commands
}
New-Shortcut (Join-Path $startup "Codistan Prospecting OS.lnk") (Join-Path $commands "START-ACQUISITION-V4.cmd") $commands

Start-Process -FilePath (Join-Path $commands "START-ACQUISITION-V4.cmd") -WindowStyle Minimized
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
if (-not $healthy) {
    if (Test-Path $appPrevious) {
        if (Test-Path $appCurrent) { Remove-Item $appCurrent -Recurse -Force }
        Move-Item $appPrevious $appCurrent
    }
    throw "The installed collectors did not satisfy the Prospecting OS release contract. The previous application folder was restored where available."
}

Write-Host ""
Write-Host "$($release.product) $($release.release_version) installed and healthy."
Write-Host "Runtime: $($release.components.local_runtime)"
Write-Host "Upwork extension: $($release.components.upwork_extension)"
Write-Host "LinkedIn/Sales Navigator extension: $($release.components.linkedin_sales_navigator_extension)"
Write-Host "Extensions: $extensionRoot"
Write-Host "State preserved at: $StateRoot"
Write-Host "Prospect Desk sync config: $configPath"
Write-Host "Sync sources: LinkedIn warm, Upwork warm and Sales Navigator cold campaigns"
Write-Host "External actions remain disabled."
Write-Host "Load or reload both unpacked extensions in chrome://extensions/."
Write-Host "Run Check Prospecting OS Release before the commercial pilot."
