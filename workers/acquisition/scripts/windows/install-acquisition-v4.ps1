param(
    [string]$InstallRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..\..")).Path,
    [string]$StateRoot = (Join-Path $env:LOCALAPPDATA "Codistan\Acquisition")
)

$ErrorActionPreference = "Stop"
$sourceRoot = Join-Path $InstallRoot "workers\acquisition"
if (-not (Test-Path (Join-Path $sourceRoot "acquisition_v4\supervisor.py"))) {
    throw "The Acquisition V4 source package was not found."
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
    if (-not $pythonCommand) { throw "Python 3.12 was installed but is not available yet. Sign out and rerun START-HERE." }
}

New-Item -ItemType Directory -Force -Path $StateRoot | Out-Null
$pidFile = Join-Path $StateRoot "runtime.pid"
if (Test-Path $pidFile) {
    $runtimePid = 0
    [void][int]::TryParse((Get-Content $pidFile -Raw).Trim(), [ref]$runtimePid)
    if ($runtimePid -gt 0) { Stop-Process -Id $runtimePid -Force -ErrorAction SilentlyContinue }
    Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
}
Get-NetTCPConnection -State Listen -LocalPort 8765,8775 -ErrorAction SilentlyContinue |
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
    "Start Acquisition V4.lnk" = "START-ACQUISITION-V4.cmd"
    "Check Acquisition V4.lnk" = "CHECK-ACQUISITION-V4.cmd"
    "Open Upwork Searches.lnk" = "OPEN-UPWORK-SEARCHES.cmd"
    "Open LinkedIn Lead Searches.lnk" = "OPEN-LINKEDIN-LEAD-SEARCHES.cmd"
    "Open Acquisition Review.lnk" = "OPEN-ACQUISITION-REVIEW.cmd"
    "Diagnose Acquisition V4.lnk" = "DIAGNOSE-ACQUISITION-V4.cmd"
    "Rollback Acquisition V4.lnk" = "ROLLBACK-ACQUISITION-V4.cmd"
}
foreach ($entry in $shortcutMap.GetEnumerator()) {
    New-Shortcut (Join-Path $desktop $entry.Key) (Join-Path $commands $entry.Value) $commands
}
New-Shortcut (Join-Path $startup "Codistan Acquisition V4.lnk") (Join-Path $commands "START-ACQUISITION-V4.cmd") $commands

Start-Process -FilePath (Join-Path $commands "START-ACQUISITION-V4.cmd") -WindowStyle Minimized
$healthy = $false
for ($attempt = 0; $attempt -lt 20; $attempt++) {
    Start-Sleep -Seconds 1
    try {
        $upwork = Invoke-RestMethod -Uri "http://127.0.0.1:8765/health" -TimeoutSec 2
        $linkedin = Invoke-RestMethod -Uri "http://127.0.0.1:8775/health" -TimeoutSec 2
        if ($upwork.ready -and $linkedin.ready) { $healthy = $true; break }
    } catch {}
}
if (-not $healthy) {
    if (Test-Path $appPrevious) {
        if (Test-Path $appCurrent) { Remove-Item $appCurrent -Recurse -Force }
        Move-Item $appPrevious $appCurrent
    }
    throw "The installed collectors did not become healthy. The previous application folder was restored where available."
}

Write-Host ""
Write-Host "Acquisition V4 installed and healthy."
Write-Host "Extensions: $extensionRoot"
Write-Host "Load or reload both unpacked extensions in chrome://extensions/."
Write-Host "Use the new desktop shortcuts for daily operation."
