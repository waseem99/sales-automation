param(
    [string]$StateRoot = (Join-Path $env:LOCALAPPDATA "Codistan\Acquisition")
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
$stopped = New-Object System.Collections.Generic.List[int]

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

function Stop-RecordedProcess([string]$PidFile) {
    if (-not (Test-Path -LiteralPath $PidFile)) { return }
    $recordedPid = 0
    try {
        [void][int]::TryParse((Get-Content -LiteralPath $PidFile -Raw).Trim(), [ref]$recordedPid)
    } catch {
        $recordedPid = 0
    }
    if ($recordedPid -gt 0) {
        $process = Get-Process -Id $recordedPid -ErrorAction SilentlyContinue
        if ($process) {
            Stop-Process -Id $recordedPid -Force -ErrorAction SilentlyContinue
            [void]$stopped.Add($recordedPid)
        }
    }
    Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
}

$watchdogPidFile = Join-Path $StateRoot "watchdog.pid"
$runtimePidFile = Join-Path $StateRoot "runtime.pid"
$watchdogLockFile = Join-Path $StateRoot "watchdog.lock"

Stop-RecordedProcess $watchdogPidFile
Stop-RecordedProcess $runtimePidFile
Start-Sleep -Milliseconds 500

$collectorPorts = @(8765, 8775, 8785)
$listeners = @(Get-NetTCPConnection -State Listen -LocalPort $collectorPorts -ErrorAction SilentlyContinue)
foreach ($listener in $listeners) {
    $owningProcess = Get-OptionalPropertyValue -InputObject $listener -Name "OwningProcess"
    $processId = 0
    if ($null -eq $owningProcess -or -not [int]::TryParse([string]$owningProcess, [ref]$processId) -or $processId -le 0) {
        continue
    }
    $process = Get-CimInstance Win32_Process -Filter "ProcessId=$processId" -ErrorAction SilentlyContinue
    $commandLine = [string](Get-OptionalPropertyValue -InputObject $process -Name "CommandLine" -DefaultValue "")
    if ($commandLine -match '(?i)acquisition_v4\.supervisor') {
        Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
        if (-not $stopped.Contains($processId)) { [void]$stopped.Add($processId) }
    }
}

Remove-Item -LiteralPath $watchdogLockFile -Force -ErrorAction SilentlyContinue

if ($stopped.Count -eq 0) {
    Write-Host "Sales Automation was already stopped."
} else {
    Write-Host "Stopped Sales Automation process IDs: $($stopped -join ', ')"
}
Write-Host "Operational state preserved at: $StateRoot"
