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
$AcceptancePath = Join-Path $StateRoot "upwork-automation-accepted.json"
$OutputRoot = Join-Path $StateRoot "output\upwork-automation"

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

if (Test-Path $AcceptancePath) {
    try {
        $Acceptance = Get-Content -Raw -Path $AcceptancePath | ConvertFrom-Json
        Write-Host "Acceptance gate: Passed" -ForegroundColor Green
        Write-Host "Accepted run: $($Acceptance.run_id)"
        Write-Host "Accepted at: $($Acceptance.accepted_at)"
    } catch {
        Write-Host "Acceptance gate: Record unreadable" -ForegroundColor Yellow
    }
} else {
    Write-Host "Acceptance gate: Not passed" -ForegroundColor Yellow
    Write-Host "The recurring task should remain disabled until all three searches complete in one controlled run."
}

Write-Host ""
if ((Test-Path $VenvPython) -and (Test-Path $ConfigPath)) {
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

$LatestRun = $null
if (Test-Path $OutputRoot) {
    $LatestRun = Get-ChildItem -Path $OutputRoot -Directory | Sort-Object LastWriteTime -Descending | Select-Object -First 1
}
if ($LatestRun) {
    $LatestReport = Join-Path $LatestRun.FullName "report.html"
    $LatestSearchResults = Join-Path $LatestRun.FullName "search-results.json"
    Write-Host ""
    Write-Host "Latest output: $($LatestRun.FullName)"
    Write-Host "Report present: $(Test-Path $LatestReport)"
    if (Test-Path $LatestSearchResults) {
        try {
            $SearchResults = Get-Content -Raw -Path $LatestSearchResults | ConvertFrom-Json
            Write-Host "Successful searches in latest run: $($SearchResults.successful_searches) of $($SearchResults.expected_searches)"
            foreach ($Search in @($SearchResults.searches)) {
                Write-Host "  $($Search.search_id): $($Search.status) | cards=$($Search.cards_found) | attempts=$($Search.attempts)"
            }
        } catch {
            Write-Host "Latest search diagnostics could not be read." -ForegroundColor Yellow
        }
    }
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
