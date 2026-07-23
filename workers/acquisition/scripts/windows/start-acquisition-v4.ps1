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

$runtimePidFile = Join-Path $StateRoot "runtime.pid"
$watchdogPidFile = Join-Path $StateRoot "watchdog.pid"
$watchdogLockPath = Join-Path $StateRoot "watchdog.lock"
$watchdogLog = Join-Path $logRoot "watchdog.log"
$runtimeLog = Join-Path $logRoot "runtime.log"

function Write-WatchdogLog([string]$Message) {
    $line = "{0} {1}" -f (Get-Date).ToString("o"), $Message
    Add-Content -Path $watchdogLog -Value $line -Encoding UTF8
    Write-Host $Message
}

function Test-CollectorHealth {
    try {
        $upwork = Invoke-RestMethod -Uri "http://127.0.0.1:8765/health" -TimeoutSec 2
        $linkedin = Invoke-RestMethod -Uri "http://127.0.0.1:8775/health" -TimeoutSec 2
        return ($upwork.ready -and $linkedin.ready -and
            $upwork.schema_version -eq "codistan-acquisition-health.v1" -and
            $linkedin.schema_version -eq "codistan-acquisition-health.v1")
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
        Write-Host "Another Acquisition V4 watchdog is already running."
        exit 0
    }

    Set-Content -Path $watchdogPidFile -Value $PID -Encoding ASCII
    Write-WatchdogLog "Acquisition V4 watchdog started with PID $PID."
    Write-Host "State: $StateRoot"
    Write-Host "Upwork collector:  http://127.0.0.1:8765/health"
    Write-Host "LinkedIn collector: http://127.0.0.1:8775/health"

    while ($true) {
        if (Test-CollectorHealth) {
            Start-Sleep -Seconds 10
            continue
        }

        $foreignListeners = @()
        $v4Listeners = @()
        $listeners = Get-NetTCPConnection -State Listen -LocalPort 8765,8775 -ErrorAction SilentlyContinue
        foreach ($listener in $listeners) {
            $process = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)" -ErrorAction SilentlyContinue
            $entry = [pscustomobject]@{
                Port = $listener.LocalPort
                PID = $listener.OwningProcess
                CommandLine = [string]$process.CommandLine
            }
            if ($entry.CommandLine -match "acquisition_v4\.supervisor") { $v4Listeners += $entry }
            else { $foreignListeners += $entry }
        }

        if ($foreignListeners.Count -gt 0) {
            $summary = ($foreignListeners | ForEach-Object { "port $($_.Port), PID $($_.PID)" }) -join "; "
            Write-WatchdogLog "Cannot start V4 because another process owns an acquisition port: $summary. Retrying in 30 seconds."
            Start-Sleep -Seconds 30
            continue
        }

        foreach ($pid in ($v4Listeners | Select-Object -ExpandProperty PID -Unique)) {
            Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
        }
        if (Test-Path $runtimePidFile) {
            $runtimePid = 0
            [void][int]::TryParse((Get-Content $runtimePidFile -Raw).Trim(), [ref]$runtimePid)
            if ($runtimePid -gt 0) { Stop-Process -Id $runtimePid -Force -ErrorAction SilentlyContinue }
            Remove-Item $runtimePidFile -Force -ErrorAction SilentlyContinue
        }
        Start-Sleep -Seconds 2

        Write-WatchdogLog "Starting Acquisition V4 supervisor."
        Add-Content -Path $runtimeLog -Value ("`r`n===== {0} supervisor start =====" -f (Get-Date).ToString("o")) -Encoding UTF8
        & $pythonExe @pythonArgs -u -m acquisition_v4.supervisor `
            --state-root $StateRoot `
            --pid-file $runtimePidFile >> $runtimeLog 2>&1
        $exitCode = $LASTEXITCODE
        Write-WatchdogLog "Acquisition V4 supervisor exited with code $exitCode. Restarting in 5 seconds."
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
