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

function Resolve-BrowserExecutable {
    $candidates = @(
        (Join-Path $env:ProgramFiles "Google\Chrome\Application\chrome.exe"),
        (Join-Path ${env:ProgramFiles(x86)} "Google\Chrome\Application\chrome.exe"),
        (Join-Path $env:LOCALAPPDATA "Google\Chrome\Application\chrome.exe"),
        (Join-Path $env:ProgramFiles "Microsoft\Edge\Application\msedge.exe"),
        (Join-Path ${env:ProgramFiles(x86)} "Microsoft\Edge\Application\msedge.exe")
    )
    foreach ($candidate in $candidates) {
        if ($candidate -and (Test-Path $candidate)) { return $candidate }
    }
    throw "Google Chrome or Microsoft Edge was not found on this computer."
}

function Get-FreeTcpPort {
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
    try {
        $listener.Start()
        return ([System.Net.IPEndPoint]$listener.LocalEndpoint).Port
    } finally {
        $listener.Stop()
    }
}

function Wait-CdpEndpoint {
    param([string]$Endpoint, [int]$TimeoutSeconds = 45)

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        try {
            $result = Invoke-RestMethod -Uri "$Endpoint/json/version" -TimeoutSec 2
            if ($result.webSocketDebuggerUrl) { return }
        } catch {
            Start-Sleep -Milliseconds 750
        }
    }
    throw "Chrome opened but its local capture connection did not become available. Close the dedicated browser completely and run the launcher again."
}

$WorkerRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
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
$BrowserExecutable = Resolve-BrowserExecutable
New-Item -ItemType Directory -Force -Path $CheckpointRoot, $OutputRoot | Out-Null
$RunId = Get-Date -Format "yyyyMMdd-HHmmss"
$RunDirectory = Join-Path $OutputRoot $RunId

Write-Step "Preparing normal-Chrome Upwork capture"
Write-Host "This run will launch your installed Chrome or Edge directly." -ForegroundColor Yellow
Write-Host "It will not use Playwright browser-launch flags such as --no-sandbox." -ForegroundColor Yellow
Write-Host "You will navigate Upwork and open each saved search yourself." -ForegroundColor Yellow
Write-Host "The worker attaches locally only to read visible job cards after you press Enter." -ForegroundColor Yellow
Write-Host "No job detail, proposal, message, application, or dashboard write is automated." -ForegroundColor Yellow
Write-Host ""
Write-Host "Close the stuck/dedicated Upwork browser window completely before continuing."
Read-Host "Press Enter when the dedicated Upwork browser is fully closed"

$CdpPort = Get-FreeTcpPort
$CdpEndpoint = "http://127.0.0.1:$CdpPort"
$BrowserArguments = @(
    "--remote-debugging-address=127.0.0.1",
    "--remote-debugging-port=$CdpPort",
    "--user-data-dir=`"$ProfilePath`"",
    "--new-window",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-mode",
    "https://www.upwork.com/"
)

Write-Step "Opening normal installed browser"
$BrowserProcess = Start-Process -FilePath $BrowserExecutable -ArgumentList $BrowserArguments -PassThru
Wait-CdpEndpoint -Endpoint $CdpEndpoint
Write-Host "Normal browser opened successfully. The Chrome sandbox remains enabled." -ForegroundColor Green
Write-Host "If Upwork asks you to log in or verify, complete it normally in that browser." -ForegroundColor Yellow

Push-Location $WorkerRoot
try {
    & $VenvPython -m acquisition.upwork_cdp_assisted `
        --cdp-endpoint $CdpEndpoint `
        --config $ConfigPath `
        --qualification-config $QualificationPath `
        --output-directory $RunDirectory `
        --checkpoint $CheckpointPath
    $PilotExit = $LASTEXITCODE
} finally {
    Pop-Location
}

if ($PilotExit -eq 4) {
    throw "The normal Chrome window could not be attached or Upwork did not return to an authenticated page. Keep the browser open only to inspect the issue, then close it before retrying."
}
if ($PilotExit -eq 5) {
    throw "No usable visible job cards were captured, so no zero-result report was accepted. Open a saved-search results page before pressing Enter."
}
if ($PilotExit -ne 0) {
    throw "The normal-Chrome Upwork capture stopped with exit code $PilotExit. Share the visible non-sensitive error text in the project chat."
}

$ReportPath = Join-Path $RunDirectory "report.html"
if (-not (Test-Path $ReportPath)) {
    throw "The capture finished but the HTML report was not created."
}

$Latest = [ordered]@{
    schema_version = "codistan-upwork-assisted-latest.v2"
    completed_at = (Get-Date).ToString("o")
    capture_mode = "normal_chrome_operator_assisted_cdp"
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
Write-Host "You may now close the dedicated Upwork browser window." -ForegroundColor Yellow
Write-Host "Dashboard ingestion remains disabled until the report quality is explicitly approved." -ForegroundColor Yellow
