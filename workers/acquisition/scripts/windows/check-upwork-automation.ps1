[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$TaskName = "Codistan Upwork Acquisition"
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
    Write-Host "Last run: $($Info.LastRunTime)"
    Write-Host "Last result: $($Info.LastTaskResult)"
    Write-Host "Next run: $($Info.NextRunTime)"
} else {
    Write-Host "Scheduled task: Not installed" -ForegroundColor Red
}

Write-Host ""
if (Test-Path $StatusPath) {
    $Status = Get-Content -Raw -Path $StatusPath | ConvertFrom-Json
    Write-Host "Worker status: $($Status.status)" -ForegroundColor Yellow
    Write-Host "Started: $($Status.started_at)"
    Write-Host "Completed: $($Status.completed_at)"
    Write-Host "Searches completed: $($Status.searches_completed)"
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
