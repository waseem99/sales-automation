[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$TaskName = "Codistan Upwork Acquisition"
$WorkerRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$VenvPython = Join-Path $WorkerRoot ".venv\Scripts\python.exe"
$ConfigPath = Join-Path $WorkerRoot "config\upwork-automation.toml"
$StateRoot = Join-Path $env:LOCALAPPDATA "Codistan\Acquisition"
$StatusPath = Join-Path $StateRoot "upwork-automation-status.json"
$AttentionPath = Join-Path $StateRoot "upwork-attention-required.json"
$PendingPath = Join-Path $StateRoot "prospect-desk-ingestion-pending.jsonl"

Write-Host "CODISTAN UPWORK AUTOMATION STATUS" -ForegroundColor Cyan
Write-Host ""

$Task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($Task) {
    $Info = Get-ScheduledTaskInfo -TaskName $TaskName
    Write-Host "Scheduled task: Installed" -ForegroundColor Green
    Write-Host "Task state: $($Task.State)"
    Write-Host "Last trigger: $($Info.LastRunTime)"
    Write-Host "Last result: $($Info.LastTaskResult)"
    Write-Host "Next 30-minute trigger: $($Info.NextRunTime)"
} else {
    Write-Host "Scheduled task: Not installed" -ForegroundColor Red
}

Write-Host ""
if (Test-Path $VenvPython -and Test-Path $ConfigPath) {
    try {
        $ScheduleText = (& $VenvPython -m acquisition upwork-schedule-info --config $ConfigPath 2>&1 | Out-String).Trim()
        $Schedule = $ScheduleText | ConvertFrom-Json
        Write-Host "Market window active now: $($Schedule.active)" -ForegroundColor Yellow
        Write-Host "Cadence: every $($Schedule.cadence_minutes) minutes"
        Write-Host "Matched windows: $(@($Schedule.matched_windows) -join ', ')"
        foreach ($Window in @($Schedule.windows)) {
            Write-Host "  $($Window.id): $($Window.local_time) | active=$($Window.active)"
        }
    } catch {
        Write-Host "Target-market schedule status could not be read." -ForegroundColor Yellow
    }
}

Write-Host ""
if (Test-Path $StatusPath) {
    $Status = Get-Content -Raw -Path $StatusPath | ConvertFrom-Json
    Write-Host "Worker status: $($Status.status)" -ForegroundColor Yellow
    Write-Host "Started: $($Status.started_at)"
    Write-Host "Completed: $($Status.completed_at)"
    Write-Host "Searches completed: $($Status.searches_completed) of 3 expected"
    Write-Host "New opportunities: $($Status.extracted)"
    Write-Host "Priority A: $($Status.priority_a_count)"
    Write-Host "Priority B: $($Status.priority_b_count)"
    Write-Host "Priority C: $($Status.priority_c_count)"
    Write-Host "Prospect Desk ingested: $($Status.ingested)"
    Write-Host "Message: $($Status.message)"
} else {
    Write-Host "No worker run status exists yet." -ForegroundColor Yellow
}

Write-Host ""
if (Test-Path $AttentionPath) {
    $Attention = Get-Content -Raw -Path $AttentionPath | ConvertFrom-Json
    Write-Host "ACTION REQUIRED" -ForegroundColor Red
    Write-Host $Attention.instruction
    Write-Host "Reason: $($Attention.reason)"
} else {
    Write-Host "No Upwork verification action is currently recorded." -ForegroundColor Green
}

$PendingCount = 0
if (Test-Path $PendingPath) {
    $PendingCount = @(Get-Content -Path $PendingPath | Where-Object { $_.Trim() }).Count
}
Write-Host "Pending Prospect Desk records: $PendingCount"
