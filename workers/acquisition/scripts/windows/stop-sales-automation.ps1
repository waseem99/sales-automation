param(
    [string]$StateRoot = (Join-Path $env:LOCALAPPDATA "Codistan\Acquisition")
)

$ErrorActionPreference = "Stop"
$stopped = New-Object System.Collections.Generic.List[int]

function Stop-RecordedProcess([string]$PidFile) {
    if (-not (Test-Path $PidFile)) { return }
    $recordedPid = 0
    [void][int]::TryParse((Get-Content $PidFile -Raw).Trim(), [ref]$recordedPid)
    if ($recordedPid -gt 0) {
        $process = Get-Process -Id $recordedPid -ErrorAction SilentlyContinue
        if ($process) {
            Stop-Process -Id $recordedPid -Force -ErrorAction SilentlyContinue
            [void]$stopped.Add($recordedPid)
        }
    }
    Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
}

$watchdogPidFile = Join-Path $StateRoot "watchdog.pid"
$runtimePidFile = Join-Path $StateRoot "runtime.pid"
$watchdogLockFile = Join-Path $StateRoot "watchdog.lock"

Stop-RecordedProcess $watchdogPidFile
Stop-RecordedProcess $runtimePidFile
Start-Sleep -Milliseconds 500

$collectorPorts = @(8765, 8775, 8785)
$listeners = Get-NetTCPConnection -State Listen -LocalPort $collectorPorts -ErrorAction SilentlyContinue
foreach ($listener in $listeners) {
    $processId = [int]$listener.OwningProcess
    $process = Get-CimInstance Win32_Process -Filter "ProcessId=$processId" -ErrorAction SilentlyContinue
    $commandLine = [string]$process.CommandLine
    if ($commandLine -match '(?i)acquisition_v4\.supervisor') {
        Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
        if (-not $stopped.Contains($processId)) { [void]$stopped.Add($processId) }
    }
}

Remove-Item $watchdogLockFile -Force -ErrorAction SilentlyContinue

if ($stopped.Count -eq 0) {
    Write-Host "Sales Automation was already stopped."
} else {
    Write-Host "Stopped Sales Automation process IDs: $($stopped -join ', ')"
}
Write-Host "Operational state preserved at: $StateRoot"
