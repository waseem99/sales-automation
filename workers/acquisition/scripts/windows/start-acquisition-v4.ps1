param(
    [string]$InstallRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..\..")).Path,
    [string]$StateRoot = (Join-Path $env:LOCALAPPDATA "Codistan\Acquisition")
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$pythonBootstrap = Join-Path $PSScriptRoot "python-bootstrap.ps1"
if (-not (Test-Path -LiteralPath $pythonBootstrap)) {
    throw "The Sales Automation Python bootstrap was not found. Reinstall Sales Automation."
}
. $pythonBootstrap
$pythonCommand = Get-CodistanPythonCommand
if (-not $pythonCommand) {
    throw "Python 3.12 or later is required. Run SETUP-AND-RUN-SALES-AUTOMATION.cmd once."
}
$pythonExe = [string]$pythonCommand.Executable
$pythonArgs = @($pythonCommand.Arguments)

$packageRoot = Join-Path $InstallRoot "workers\acquisition"
$env:PYTHONPATH = $packageRoot
New-Item -ItemType Directory -Force -Path $StateRoot | Out-Null
$logRoot = Join-Path $StateRoot "logs"
New-Item -ItemType Directory -Force -Path $logRoot | Out-Null

$runtimePidFile = Join-Path $StateRoot "runtime.pid"
$watchdogPidFile = Join-Path $StateRoot "watchdog.pid"
$watchdogLockPath = Join-Path $StateRoot "watchdog.lock"
$watchdogLog = Join-Path $logRoot "watchdog.log"
$runtimeLog = Join-Path $logRoot "runtime.log"
$collectorPorts = @(8765, 8775, 8785)

function Write-WatchdogLog([string]$Message) {
    $line = "{0} {1}" -f (Get-Date).ToString("o"), $Message
    Add-Content -Path $watchdogLog -Value $line -Encoding UTF8
    Write-Host $Message
}

function Test-CollectorHealth {
    try {
        $upwork = Invoke-RestMethod -Uri "http://127.0.0.1:8765/health" -TimeoutSec 2
        $linkedin = Invoke-RestMethod -Uri "http://127.0.0.1:8775/health" -TimeoutSec 2
        $salesNavigator = Invoke-RestMethod -Uri "http://127.0.0.1:8785/health" -TimeoutSec 2
        return ($upwork.ready -and $linkedin.ready -and $salesNavigator.ready -and
            $upwork.schema_version -eq "codistan-acquisition-health.v1" -and
            $linkedin.schema_version -eq "codistan-acquisition-health.v1" -and
            $salesNavigator.schema_version -eq "codistan-acquisition-health.v1" -and
            $upwork.external_actions_enabled -eq $false -and
            $linkedin.external_actions_enabled -eq $false -and
            $salesNavigator.external_actions_enabled -eq $false)
    } catch {
        return $false
    }
}

$lockStream = $null
try {
    try {
        $lockStream = [System.IO.File]::Open(
            $watchdogLockPath,
            [System.IO.FileMode]::OpenOrCreate,
            [System.IO.FileAccess]::ReadWrite,
            [System.IO.FileShare]::None
        )
    } catch [System.IO.IOException] {
        Write-Host "Another Sales Automation watchdog is already running."
        exit 0
    }

    Set-Content -Path $watchdogPidFile -Value $PID -Encoding ASCII
    Write-WatchdogLog "Sales Automation watchdog started with PID $PID using Python $($pythonCommand.Version)."
    Write-Host "State: $StateRoot"
    Write-Host "Upwork collector:          http://127.0.0.1:8765/health"
    Write-Host "LinkedIn collector:        http://127.0.0.1:8775/health"
    Write-Host "Sales Navigator collector: http://127.0.0.1:8785/health"
    Write-Host "External actions: disabled"

    while ($true) {
        if (Test-CollectorHealth) {
            Start-Sleep -Seconds 10
            continue
        }

        $foreignListeners = @()
        $managedListeners = @()
        $listeners = @(Get-NetTCPConnection -State Listen -LocalPort $collectorPorts -ErrorAction SilentlyContinue)
        foreach ($listener in $listeners) {
            $process = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)" -ErrorAction SilentlyContinue
            $entry = [pscustomobject]@{
                Port = $listener.LocalPort
                ProcessId = $listener.OwningProcess
                CommandLine = [string]$process.CommandLine
            }
            if ($entry.CommandLine -match "acquisition_v4\.supervisor") { $managedListeners += $entry }
            else { $foreignListeners += $entry }
        }

        if (@($foreignListeners).Count -gt 0) {
            $summary = ($foreignListeners | ForEach-Object { "port $($_.Port), PID $($_.ProcessId)" }) -join "; "
            Write-WatchdogLog "Cannot start Sales Automation because another process owns a collector port: $summary. Retrying in 30 seconds."
            Start-Sleep -Seconds 30
            continue
        }

        foreach ($listenerProcessId in @($managedListeners | Select-Object -ExpandProperty ProcessId -Unique)) {
            Stop-Process -Id $listenerProcessId -Force -ErrorAction SilentlyContinue
        }
        if (Test-Path $runtimePidFile) {
            $runtimeProcessId = 0
            [void][int]::TryParse((Get-Content $runtimePidFile -Raw).Trim(), [ref]$runtimeProcessId)
            if ($runtimeProcessId -gt 0) { Stop-Process -Id $runtimeProcessId -Force -ErrorAction SilentlyContinue }
            Remove-Item $runtimePidFile -Force -ErrorAction SilentlyContinue
        }
        Start-Sleep -Seconds 2

        Write-WatchdogLog "Starting Sales Automation supervisor."
        Add-Content -Path $runtimeLog -Value ("`r`n===== {0} supervisor start =====" -f (Get-Date).ToString("o")) -Encoding UTF8
        & $pythonExe @pythonArgs -u -m acquisition_v4.supervisor `
            --state-root $StateRoot `
            --pid-file $runtimePidFile >> $runtimeLog 2>&1
        $exitCode = $LASTEXITCODE
        Write-WatchdogLog "Sales Automation supervisor exited with code $exitCode. Restarting in 5 seconds."
        Start-Sleep -Seconds 5
    }
} finally {
    try {
        if (Test-Path $watchdogPidFile -and (Get-Content $watchdogPidFile -Raw).Trim() -eq [string]$PID) {
            Remove-Item $watchdogPidFile -Force -ErrorAction SilentlyContinue
        }
    } catch {}
    if ($lockStream) { $lockStream.Dispose() }
}
