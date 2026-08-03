param(
    [string]$InstallRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..\..")).Path,
    [string]$StateRoot = (Join-Path $env:LOCALAPPDATA "Codistan\Acquisition")
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

function Test-CodistanCollectorCommandLine {
    param([string]$CommandLine)
    if ([string]::IsNullOrWhiteSpace($CommandLine)) { return $false }
    return $CommandLine -match '(?i)(?:-m\s+acquisition_v4\.(?:supervisor|runtime|runtime_v5)\b|acquisition_v4[\\/](?:supervisor|runtime|runtime_v5)\.py\b|Codistan[\\/]Acquisition.*(?:8765|8775|8785))'
}

$pythonBootstrap = Join-Path $PSScriptRoot "python-bootstrap.ps1"
if (-not (Test-Path -LiteralPath $pythonBootstrap)) {
    throw "The Sales Automation Python bootstrap was not found. Reinstall Sales Automation."
}
. $pythonBootstrap
$pythonCommand = Get-CodistanPythonCommand
if (-not $pythonCommand) {
    throw "Python 3.12 or later is required. Run SETUP-AND-RUN-SALES-AUTOMATION.cmd once."
}
$pythonExe = [string](Get-OptionalPropertyValue -InputObject $pythonCommand -Name "Executable" -DefaultValue "")
$pythonArgs = @(Get-OptionalPropertyValue -InputObject $pythonCommand -Name "Arguments" -DefaultValue @())
$pythonVersion = [string](Get-OptionalPropertyValue -InputObject $pythonCommand -Name "Version" -DefaultValue "")
if ([string]::IsNullOrWhiteSpace($pythonExe)) {
    throw "The Python bootstrap returned no executable. Re-run setup."
}

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
    Add-Content -LiteralPath $watchdogLog -Value $line -Encoding UTF8
    Write-Host $Message
}

function Test-CollectorHealth {
    try {
        $upwork = Invoke-RestMethod -Uri "http://127.0.0.1:8765/health" -TimeoutSec 2
        $linkedin = Invoke-RestMethod -Uri "http://127.0.0.1:8775/health" -TimeoutSec 2
        $salesNavigator = Invoke-RestMethod -Uri "http://127.0.0.1:8785/health" -TimeoutSec 2
        return (
            (Get-OptionalPropertyValue -InputObject $upwork -Name "ready" -DefaultValue $false) -eq $true -and
            (Get-OptionalPropertyValue -InputObject $linkedin -Name "ready" -DefaultValue $false) -eq $true -and
            (Get-OptionalPropertyValue -InputObject $salesNavigator -Name "ready" -DefaultValue $false) -eq $true -and
            [string](Get-OptionalPropertyValue -InputObject $upwork -Name "schema_version" -DefaultValue "") -eq "codistan-acquisition-health.v1" -and
            [string](Get-OptionalPropertyValue -InputObject $linkedin -Name "schema_version" -DefaultValue "") -eq "codistan-acquisition-health.v1" -and
            [string](Get-OptionalPropertyValue -InputObject $salesNavigator -Name "schema_version" -DefaultValue "") -eq "codistan-acquisition-health.v1" -and
            (Get-OptionalPropertyValue -InputObject $upwork -Name "external_actions_enabled" -DefaultValue $null) -eq $false -and
            (Get-OptionalPropertyValue -InputObject $linkedin -Name "external_actions_enabled" -DefaultValue $null) -eq $false -and
            (Get-OptionalPropertyValue -InputObject $salesNavigator -Name "external_actions_enabled" -DefaultValue $null) -eq $false
        )
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

    Set-Content -LiteralPath $watchdogPidFile -Value $PID -Encoding ASCII
    Write-WatchdogLog "Sales Automation watchdog started with PID $PID using Python $pythonVersion."
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
            $owningProcess = Get-OptionalPropertyValue -InputObject $listener -Name "OwningProcess"
            $listenerProcessId = 0
            if ($null -eq $owningProcess -or -not [int]::TryParse([string]$owningProcess, [ref]$listenerProcessId) -or $listenerProcessId -le 0) {
                continue
            }
            $localPort = 0
            [void][int]::TryParse([string](Get-OptionalPropertyValue -InputObject $listener -Name "LocalPort" -DefaultValue 0), [ref]$localPort)
            $process = Get-CimInstance Win32_Process -Filter "ProcessId=$listenerProcessId" -ErrorAction SilentlyContinue
            $commandLine = [string](Get-OptionalPropertyValue -InputObject $process -Name "CommandLine" -DefaultValue "")
            $processName = [string](Get-OptionalPropertyValue -InputObject $process -Name "Name" -DefaultValue "unknown")
            $entry = [pscustomobject]@{
                Port = $localPort
                ProcessId = $listenerProcessId
                ProcessName = $processName
                CommandLine = $commandLine
            }
            if (Test-CodistanCollectorCommandLine -CommandLine $commandLine) { $managedListeners += $entry }
            else { $foreignListeners += $entry }
        }

        if (@($foreignListeners).Count -gt 0) {
            $summary = ($foreignListeners | ForEach-Object { "port $($_.Port), PID $($_.ProcessId), process $($_.ProcessName)" }) -join "; "
            Write-WatchdogLog "Cannot start Sales Automation because an unrelated process owns a collector port: $summary. Retrying in 30 seconds."
            Start-Sleep -Seconds 30
            continue
        }

        foreach ($managed in @($managedListeners)) {
            Write-WatchdogLog "Stopping stale managed collector on port $($managed.Port), PID $($managed.ProcessId)."
            Stop-Process -Id $managed.ProcessId -Force -ErrorAction SilentlyContinue
        }
        if (Test-Path -LiteralPath $runtimePidFile) {
            $runtimeProcessId = 0
            try {
                [void][int]::TryParse((Get-Content -LiteralPath $runtimePidFile -Raw).Trim(), [ref]$runtimeProcessId)
            } catch {
                $runtimeProcessId = 0
            }
            if ($runtimeProcessId -gt 0) { Stop-Process -Id $runtimeProcessId -Force -ErrorAction SilentlyContinue }
            Remove-Item -LiteralPath $runtimePidFile -Force -ErrorAction SilentlyContinue
        }
        Start-Sleep -Seconds 2

        Write-WatchdogLog "Starting Sales Automation supervisor."
        Add-Content -LiteralPath $runtimeLog -Value ("`r`n===== {0} supervisor start =====" -f (Get-Date).ToString("o")) -Encoding UTF8
        & $pythonExe @pythonArgs -u -m acquisition_v4.supervisor `
            --state-root $StateRoot `
            --pid-file $runtimePidFile >> $runtimeLog 2>&1
        $exitCode = $LASTEXITCODE
        Write-WatchdogLog "Sales Automation supervisor exited with code $exitCode. Restarting in 5 seconds."
        Start-Sleep -Seconds 5
    }
} finally {
    try {
        if (Test-Path -LiteralPath $watchdogPidFile -and (Get-Content -LiteralPath $watchdogPidFile -Raw).Trim() -eq [string]$PID) {
            Remove-Item -LiteralPath $watchdogPidFile -Force -ErrorAction SilentlyContinue
        }
    } catch {}
    if ($lockStream) { $lockStream.Dispose() }
}
