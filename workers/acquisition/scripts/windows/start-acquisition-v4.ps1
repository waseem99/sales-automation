param(
    [string]$InstallRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..\..")).Path,
    [string]$StateRoot = (Join-Path $env:LOCALAPPDATA "Codistan\Acquisition")
)

$ErrorActionPreference = "Stop"
$pyLauncher = Get-Command py.exe -ErrorAction SilentlyContinue
if ($pyLauncher) {
    $pythonExe = $pyLauncher.Source
    $pythonArgs = @("-3.12")
} else {
    $python = Get-Command python.exe -ErrorAction SilentlyContinue
    if (-not $python) { throw "Python 3.12 or later is required." }
    $pythonExe = $python.Source
    $pythonArgs = @()
}

$packageRoot = Join-Path $InstallRoot "workers\acquisition"
$env:PYTHONPATH = $packageRoot
New-Item -ItemType Directory -Force -Path $StateRoot | Out-Null
$logRoot = Join-Path $StateRoot "logs"
New-Item -ItemType Directory -Force -Path $logRoot | Out-Null

. (Join-Path $PSScriptRoot "talenttrack-postgres-common.ps1")
$postgresContext = Get-TalentTrackPostgresContext -InstallRoot $InstallRoot -StateRoot $StateRoot
$storageBackend = "jsonl"
$postgresValues = $null
if (Test-Path $postgresContext.EnvPath) {
    $postgresValues = Read-TalentTrackPostgresEnv -Path $postgresContext.EnvPath
    Require-TalentTrackDocker $postgresContext
    $env:TALENTTRACK_LOCAL_DATABASE_URL = Get-TalentTrackLocalDatabaseUrl -Values $postgresValues
    $storageBackend = "postgresql"
} else {
    Remove-Item Env:TALENTTRACK_LOCAL_DATABASE_URL -ErrorAction SilentlyContinue
}

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
            $upwork.storage_backend -eq $storageBackend -and
            $linkedin.storage_backend -eq $storageBackend -and
            $salesNavigator.storage_backend -eq $storageBackend)
    } catch {
        return $false
    }
}

function Test-LocalPostgresReady {
    if ($storageBackend -ne "postgresql") { return $true }
    try {
        $null = Invoke-TalentTrackCompose -Context $postgresContext -Arguments @("up", "-d")
        $code = Invoke-TalentTrackCompose -Context $postgresContext -Arguments @(
            "exec", "-T", "postgres", "pg_isready",
            "-U", [string]$postgresValues["TALENTTRACK_POSTGRES_USER"],
            "-d", [string]$postgresValues["TALENTTRACK_POSTGRES_DB"]
        ) -AllowFailure
        return ($code -eq 0)
    } catch {
        Write-WatchdogLog "TalentTrack local PostgreSQL is unavailable. Collectors remain stopped and retry in 30 seconds."
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
        Write-Host "Another TalentTrack watchdog is already running."
        exit 0
    }

    Set-Content -Path $watchdogPidFile -Value $PID -Encoding ASCII
    Write-WatchdogLog "TalentTrack watchdog started with PID $PID."
    Write-Host "State: $StateRoot"
    Write-Host "Storage backend: $storageBackend"
    Write-Host "Upwork collector:         http://127.0.0.1:8765/health"
    Write-Host "LinkedIn collector:       http://127.0.0.1:8775/health"
    Write-Host "Sales Navigator collector:http://127.0.0.1:8785/health"

    while ($true) {
        if (Test-CollectorHealth) {
            Start-Sleep -Seconds 10
            continue
        }

        if (-not (Test-LocalPostgresReady)) {
            Start-Sleep -Seconds 30
            continue
        }

        $foreignListeners = @()
        $managedListeners = @()
        $listeners = Get-NetTCPConnection -State Listen -LocalPort $collectorPorts -ErrorAction SilentlyContinue
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

        if ($foreignListeners.Count -gt 0) {
            $summary = ($foreignListeners | ForEach-Object { "port $($_.Port), PID $($_.ProcessId)" }) -join "; "
            Write-WatchdogLog "Cannot start TalentTrack because another process owns a collector port: $summary. Retrying in 30 seconds."
            Start-Sleep -Seconds 30
            continue
        }

        foreach ($listenerProcessId in ($managedListeners | Select-Object -ExpandProperty ProcessId -Unique)) {
            Stop-Process -Id $listenerProcessId -Force -ErrorAction SilentlyContinue
        }
        if (Test-Path $runtimePidFile) {
            $runtimeProcessId = 0
            [void][int]::TryParse((Get-Content $runtimePidFile -Raw).Trim(), [ref]$runtimeProcessId)
            if ($runtimeProcessId -gt 0) { Stop-Process -Id $runtimeProcessId -Force -ErrorAction SilentlyContinue }
            Remove-Item $runtimePidFile -Force -ErrorAction SilentlyContinue
        }
        Start-Sleep -Seconds 2

        Write-WatchdogLog "Starting TalentTrack supervisor with $storageBackend storage."
        Add-Content -Path $runtimeLog -Value ("`r`n===== {0} supervisor start ({1}) =====" -f (Get-Date).ToString("o"), $storageBackend) -Encoding UTF8
        & $pythonExe @pythonArgs -u -m acquisition_v4.supervisor `
            --state-root $StateRoot `
            --pid-file $runtimePidFile >> $runtimeLog 2>&1
        $exitCode = $LASTEXITCODE
        Write-WatchdogLog "TalentTrack supervisor exited with code $exitCode. Restarting in 5 seconds."
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
