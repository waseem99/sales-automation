[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$TaskName = "Codistan Upwork Capture Service"
$StateRoot = Join-Path $env:LOCALAPPDATA "Codistan\Acquisition"
$LatestPathFile = Join-Path $StateRoot "upwork-normal-chrome-latest.txt"
$ExtensionPath = Join-Path $StateRoot "upwork-capture-extension"

Write-Host "CODISTAN NORMAL-CHROME UPWORK CAPTURE" -ForegroundColor Cyan
Write-Host ""

$Task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($Task) {
    $Info = Get-ScheduledTaskInfo -TaskName $TaskName
    Write-Host "Local processor task: Installed" -ForegroundColor Green
    Write-Host "Task state: $($Task.State)"
    Write-Host "Last result: $($Info.LastTaskResult)"
} else {
    Write-Host "Local processor task: Not installed" -ForegroundColor Red
}

Write-Host ""
try {
    $Status = Invoke-RestMethod -Uri "http://127.0.0.1:8765/status" -Method Get -TimeoutSec 5
    Write-Host "Processor: Ready" -ForegroundColor Green
    Write-Host "Mode: $($Status.mode)"
    Write-Host "Current report opportunities: $($Status.extracted)"
    Write-Host "Duplicates ignored: $($Status.duplicates)"
    Write-Host "Priority A: $($Status.priority_counts.A)"
    Write-Host "Priority B: $($Status.priority_counts.B)"
    Write-Host "Priority C: $($Status.priority_counts.C)"
    Write-Host "Report: $($Status.report_path)"
} catch {
    Write-Host "Processor: Not reachable" -ForegroundColor Red
    Write-Host "Restart the task from Task Scheduler or rerun the installer."
}

Write-Host ""
Write-Host "Extension folder: $ExtensionPath"
if (Test-Path $LatestPathFile) {
    $Latest = (Get-Content -Raw -Path $LatestPathFile).Trim()
    if ($Latest) {
        Write-Host "Latest output folder: $Latest"
        $Report = Join-Path $Latest "report.html"
        if (Test-Path $Report) {
            Write-Host "Latest report exists: Yes" -ForegroundColor Green
        } else {
            Write-Host "Latest report exists: No" -ForegroundColor Yellow
        }
    }
}

Write-Host ""
Write-Host "The system never opens or controls Upwork." -ForegroundColor Yellow
Write-Host "Open one of the three approved saved searches normally in Chrome; the extension captures visible cards after the page loads." -ForegroundColor Yellow
