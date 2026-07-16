[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Write-Step([string]$Message) {
    Write-Host ""
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Resolve-UpworkProfile {
    param([string]$StateRoot, [string]$ProfileRoot)

    foreach ($markerName in @("upwork-browser-v2.connected.json", "upwork.connected.json")) {
        $markerPath = Join-Path $StateRoot $markerName
        if (-not (Test-Path $markerPath)) { continue }
        try {
            $marker = Get-Content -Raw -Path $markerPath | ConvertFrom-Json
            if ($marker.profile_folder) {
                $path = Join-Path $ProfileRoot ([string]$marker.profile_folder)
                if (Test-Path $path) { return $path }
            }
        } catch {
            Write-Host "Ignoring unreadable marker: $markerName" -ForegroundColor Yellow
        }
    }

    foreach ($folderName in @("upwork-browser-v2", "upwork")) {
        $path = Join-Path $ProfileRoot $folderName
        if (Test-Path $path) { return $path }
    }

    $fallback = Get-ChildItem -Path $ProfileRoot -Directory -Filter "upwork*" -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1
    if ($fallback) { return $fallback.FullName }

    throw "The validated Upwork browser profile was not found. Run START-HERE.cmd before the pilot."
}

$WorkerRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$RepositoryRoot = (Resolve-Path (Join-Path $WorkerRoot "..\..")).Path
$SetupScript = Join-Path $PSScriptRoot "setup-worker.ps1"
$VenvPython = Join-Path $WorkerRoot ".venv\Scripts\python.exe"
$StateRoot = Join-Path $env:LOCALAPPDATA "Codistan\Acquisition"
$ProfileRoot = Join-Path $StateRoot "profiles"
$CheckpointRoot = Join-Path $StateRoot "checkpoints"
$OutputRoot = Join-Path $StateRoot "output\upwork-assisted-pilot"
$ConfigPath = Join-Path $WorkerRoot "config\upwork-pilot.toml"
$QualificationPath = Join-Path $WorkerRoot "config\qualification.example.toml"
$CheckpointPath = Join-Path $CheckpointRoot "upwork-assisted-seen.json"

Write-Step "Updating and testing the acquisition worker"
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $SetupScript
if ($LASTEXITCODE -ne 0) { throw "Worker setup or tests failed." }

$ProfilePath = Resolve-UpworkProfile -StateRoot $StateRoot -ProfileRoot $ProfileRoot
New-Item -ItemType Directory -Force -Path $CheckpointRoot, $OutputRoot | Out-Null
$RunId = Get-Date -Format "yyyyMMdd-HHmmss"
$RunDirectory = Join-Path $OutputRoot $RunId

Write-Step "Preparing operator-assisted Upwork capture"
Write-Host "The browser will open one normal Upwork tab." -ForegroundColor Yellow
Write-Host "You will open each saved search yourself and press Enter when its job cards are visible." -ForegroundColor Yellow
Write-Host "The worker will read only the visible cards and build the local qualification report." -ForegroundColor Yellow
Write-Host "It will not open job details, submit proposals, send messages, imitate human behavior, or bypass Cloudflare." -ForegroundColor Yellow
Write-Host ""
Write-Host "Close any dedicated Upwork browser window before continuing."
Read-Host "Press Enter when the dedicated Upwork window is closed"

Push-Location $WorkerRoot
try {
    & $VenvPython -m acquisition upwork-assisted `
        --profile $ProfilePath `
        --repository-root $RepositoryRoot `
        --config $ConfigPath `
        --qualification-config $QualificationPath `
        --output-directory $RunDirectory `
        --checkpoint $CheckpointPath
    $PilotExit = $LASTEXITCODE
} finally {
    Pop-Location
}

if ($PilotExit -eq 4) {
    throw "Upwork did not return to a normal authenticated page after the guided human steps. No report was accepted."
}
if ($PilotExit -eq 5) {
    throw "No usable visible job cards were captured, so the worker refused to create a zero-result report. Rerun and open a saved-search result page before pressing Enter."
}
if ($PilotExit -ne 0) {
    throw "The operator-assisted Upwork pilot stopped with exit code $PilotExit. Share the visible non-sensitive error text in the project chat."
}

$ReportPath = Join-Path $RunDirectory "report.html"
if (-not (Test-Path $ReportPath)) {
    throw "The pilot finished but the HTML report was not created."
}

$Latest = [ordered]@{
    schema_version = "codistan-upwork-assisted-latest.v1"
    completed_at = (Get-Date).ToString("o")
    capture_mode = "operator_assisted_visible_cards"
    run_directory = $RunDirectory
    report_path = $ReportPath
    dashboard_ready_path = (Join-Path $RunDirectory "dashboard-ready.jsonl")
    dashboard_ingestion_enabled = $false
}
$Latest | ConvertTo-Json -Depth 3 | Set-Content -Path (Join-Path $StateRoot "latest-upwork-pilot.json") -Encoding UTF8

Write-Step "Opening the local opportunity report"
Start-Process $ReportPath | Out-Null
Write-Host "Report: $ReportPath" -ForegroundColor Green
Write-Host "Dashboard-ready file: $(Join-Path $RunDirectory 'dashboard-ready.jsonl')" -ForegroundColor Green
Write-Host ""
Write-Host "Dashboard ingestion remains disabled until the report quality is explicitly approved." -ForegroundColor Yellow
