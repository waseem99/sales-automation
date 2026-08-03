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

function Test-CodistanCollectorCommandLine {
    param([string]$CommandLine)
    if ([string]::IsNullOrWhiteSpace($CommandLine)) { return $false }
    return $CommandLine -match '(?i)(?:-m\s+acquisition_v4\.(?:supervisor|runtime|runtime_v5)\b|acquisition_v4[\\/](?:supervisor|runtime|runtime_v5)\.py\b|Codistan[\\/]Acquisition.*(?:8765|8775|8785))'
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

# Close only Codistan-managed browser workspace tabs. Unrelated Chrome tabs,
# windows and sessions are never touched. This is best-effort so runtime stop
# and state preservation cannot be blocked by browser availability.
$workspaceGovernance = Join-Path $StateRoot "app-current\workers\acquisition\scripts\windows\govern-sales-automation-workspace.ps1"
if ((Get-Process chrome -ErrorAction SilentlyContinue) -and (Test-Path -LiteralPath $workspaceGovernance)) {
    try {
        & $workspaceGovernance -StateRoot $StateRoot -Mode Close -Quiet
    } catch {
        Write-Warning "Codistan-managed browser tabs could not be closed automatically: $($_.Exception.Message)"
    }
}

$watchdogPidFile = Join-Path $StateRoot "watchdog.pid"
$runtimePidFile = Join-Path $StateRoot "runtime.pid"
$watchdogLockFile = Join-Path $StateRoot "watchdog.lock"

Stop-RecordedProcess $watchdogPidFile
Stop-RecordedProcess $runtimePidFile
Start-Sleep -Milliseconds 750

# Upgrades can encounter older V4 collectors that ran one process per source
# (`acquisition_v4.runtime`) rather than the combined V5 supervisor. Stop only
# listeners on the three reserved collector ports whose command line proves they
# are Codistan Acquisition processes. Never terminate an unrelated port owner.
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
    if (Test-CodistanCollectorCommandLine -CommandLine $commandLine) {
        Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
        if (-not $stopped.Contains($processId)) { [void]$stopped.Add($processId) }
    }
}

Start-Sleep -Milliseconds 750
Remove-Item -LiteralPath $watchdogLockFile -Force -ErrorAction SilentlyContinue

if ($stopped.Count -eq 0) {
    Write-Host "Sales Automation was already stopped."
} else {
    Write-Host "Stopped Sales Automation process IDs: $($stopped -join ', ')"
}
Write-Host "Codistan-managed browser tabs were closed where Chrome was running; unrelated Chrome tabs were untouched."
Write-Host "Operational state preserved at: $StateRoot"
