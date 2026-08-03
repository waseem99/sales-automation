param([string]$StateRoot = (Join-Path $env:LOCALAPPDATA "Codistan\Acquisition"))

$ErrorActionPreference = "Stop"
$appCurrent = Join-Path $StateRoot "app-current"
$appPrevious = Join-Path $StateRoot "app-previous"
if (-not (Test-Path $appPrevious)) { throw "No previous Sales Automation application version is available." }

$stopScript = Join-Path $appCurrent "workers\acquisition\scripts\windows\stop-sales-automation.ps1"
if (Test-Path $stopScript) {
    & $stopScript -StateRoot $StateRoot
} else {
    foreach ($pidFileName in @("watchdog.pid", "runtime.pid")) {
        $pidFile = Join-Path $StateRoot $pidFileName
        if (-not (Test-Path $pidFile)) { continue }
        $recordedPid = 0
        [void][int]::TryParse((Get-Content $pidFile -Raw).Trim(), [ref]$recordedPid)
        if ($recordedPid -gt 0) { Stop-Process -Id $recordedPid -Force -ErrorAction SilentlyContinue }
        Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
    }
    Get-NetTCPConnection -State Listen -LocalPort 8765,8775,8785 -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty OwningProcess -Unique |
        ForEach-Object {
            $process = Get-CimInstance Win32_Process -Filter "ProcessId=$_" -ErrorAction SilentlyContinue
            if ([string]$process.CommandLine -match '(?i)acquisition_v4\.supervisor') {
                Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue
            }
        }
}

$temp = Join-Path $StateRoot "app-rollback-temp"
if (Test-Path $temp) { Remove-Item $temp -Recurse -Force }
Move-Item $appCurrent $temp
Move-Item $appPrevious $appCurrent
Move-Item $temp $appPrevious

foreach ($source in @("upwork", "linkedin")) {
    $target = Join-Path $StateRoot "extensions\$source"
    if (Test-Path $target) { Remove-Item $target -Recurse -Force }
    New-Item -ItemType Directory -Force -Path $target | Out-Null
    Copy-Item -Path (Join-Path $appCurrent "workers\acquisition\extensions\$source\*") -Destination $target -Recurse -Force
}

Write-Host "Rolled back the application files. Captured records and deduplication state were preserved."
Write-Host "The runtime remains stopped. Use Run Sales Automation when work begins."
Write-Host "Reload both unpacked Chrome extensions from their stable local folders."
