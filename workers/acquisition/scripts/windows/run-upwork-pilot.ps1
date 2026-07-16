[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Write-Step([string]$Message) {
    Write-Host ""
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Resolve-ChromeExecutable {
    $candidates = @(
        (Join-Path $env:ProgramFiles "Google\Chrome\Application\chrome.exe"),
        (Join-Path ${env:ProgramFiles(x86)} "Google\Chrome\Application\chrome.exe"),
        (Join-Path $env:LOCALAPPDATA "Google\Chrome\Application\chrome.exe")
    )
    foreach ($candidate in $candidates) {
        if ($candidate -and (Test-Path $candidate)) { return $candidate }
    }
    return $null
}

function Test-LocalPort([int]$Port) {
    try {
        $client = [System.Net.Sockets.TcpClient]::new()
        $task = $client.ConnectAsync("127.0.0.1", $Port)
        if ($task.Wait(350) -and $client.Connected) {
            $client.Dispose()
            return $true
        }
        $client.Dispose()
        return $false
    } catch {
        return $false
    }
}

$WorkerRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$SetupScript = Join-Path $PSScriptRoot "setup-worker.ps1"
$VenvPython = Join-Path $WorkerRoot ".venv\Scripts\python.exe"
$StateRoot = Join-Path $env:LOCALAPPDATA "Codistan\Acquisition"
$CheckpointRoot = Join-Path $StateRoot "checkpoints"
$OutputRoot = Join-Path $StateRoot "output\upwork-extension-pilot"
$ConfigPath = Join-Path $WorkerRoot "config\upwork-pilot.toml"
$QualificationPath = Join-Path $WorkerRoot "config\qualification.example.toml"
$CheckpointPath = Join-Path $CheckpointRoot "upwork-extension-seen-v3.json"
$ExtensionSource = Join-Path $WorkerRoot "browser-extension"
$ExtensionTarget = Join-Path $StateRoot "upwork-capture-extension"
$ExtensionMarker = Join-Path $StateRoot "upwork-extension-installed.txt"
$CollectorPort = 8765
$ChromeExecutable = Resolve-ChromeExecutable

Write-Step "Updating and testing the acquisition worker"
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $SetupScript
if ($LASTEXITCODE -ne 0) { throw "Worker setup or tests failed." }

if (-not $ChromeExecutable) {
    throw "Google Chrome was not found. The capture extension must run in Chrome, not the Windows default browser."
}
if (-not (Test-Path $ExtensionSource)) {
    throw "The Upwork capture extension files were not found after the update."
}

$ManifestPath = Join-Path $ExtensionSource "manifest.json"
$ExtensionVersion = [string]((Get-Content -Raw -Path $ManifestPath | ConvertFrom-Json).version)
$InstalledMarker = if (Test-Path $ExtensionMarker) { Get-Content -Raw -Path $ExtensionMarker } else { "" }
$NeedsExtensionReload = -not $InstalledMarker.Contains("version=$ExtensionVersion")

New-Item -ItemType Directory -Force -Path $StateRoot, $CheckpointRoot, $OutputRoot | Out-Null
if (Test-Path $ExtensionTarget) {
    Remove-Item -Recurse -Force $ExtensionTarget
}
Copy-Item -Recurse -Force $ExtensionSource $ExtensionTarget

Write-Step "Preparing the normal-Chrome capture extension"
Write-Host "Pilot V2 uses ordinary Chrome with no Playwright, no remote debugging," -ForegroundColor Yellow
Write-Host "no special Upwork launch flags, and no automatic navigation." -ForegroundColor Yellow
Write-Host "Capture up to five visible opportunities from each of the five service searches." -ForegroundColor Yellow
Write-Host "The 25-opportunity report grades records A, B or C." -ForegroundColor Yellow
Write-Host ""

if ($NeedsExtensionReload) {
    Start-Process explorer.exe -ArgumentList "`"$ExtensionTarget`"" | Out-Null
    Start-Process -FilePath $ChromeExecutable -ArgumentList "chrome://extensions/" | Out-Null

    Write-Host "EXTENSION UPDATE REQUIRED - VERSION $ExtensionVersion" -ForegroundColor Green
    Write-Host "1. On chrome://extensions, find 'Codistan Upwork Opportunity Capture'."
    Write-Host "2. If it is already installed, click its circular Reload icon."
    Write-Host "3. If it is not installed, turn on Developer mode, click Load unpacked, and select:" -ForegroundColor Yellow
    Write-Host "   $ExtensionTarget" -ForegroundColor Yellow
    Write-Host "4. Keep the extension pinned in the Chrome toolbar."
    Write-Host ""
    Read-Host "Press Enter only after extension version $ExtensionVersion is loaded"
    "version=$ExtensionVersion confirmed=$(Get-Date -Format o)" | Set-Content -Path $ExtensionMarker -Encoding UTF8
} else {
    $InstallChoice = (Read-Host "Extension $ExtensionVersion is current. Press Enter to continue, or type R to reload it").Trim().ToLowerInvariant()
    if ($InstallChoice -eq "r") {
        Start-Process explorer.exe -ArgumentList "`"$ExtensionTarget`"" | Out-Null
        Start-Process -FilePath $ChromeExecutable -ArgumentList "chrome://extensions/" | Out-Null
        Read-Host "Click the extension Reload icon, then press Enter"
    }
}

if (Test-LocalPort -Port $CollectorPort) {
    throw "Port $CollectorPort is already in use. Close any earlier Codistan capture command window and retry."
}

$RunId = Get-Date -Format "yyyyMMdd-HHmmss"
$RunDirectory = Join-Path $OutputRoot $RunId
New-Item -ItemType Directory -Force -Path $RunDirectory | Out-Null

Write-Step "Starting the Pilot V2 opportunity collector"
Write-Host "A normal Upwork page will open explicitly in Google Chrome." -ForegroundColor Yellow
Write-Host "For each saved search:" -ForegroundColor Yellow
Write-Host "  1. Open the search normally."
Write-Host "  2. Wait until the job cards are visible."
Write-Host "  3. Click the pinned Codistan extension icon."
Write-Host "  4. Choose the service category and click Capture visible jobs."
Write-Host "The report auto-generates at 25 reviewed jobs, or you may finish earlier." -ForegroundColor Yellow
Write-Host ""
Write-Host "No proposal, message, application, job-detail navigation, or dashboard write is automated." -ForegroundColor Green

Start-Process -FilePath $ChromeExecutable -ArgumentList "https://www.upwork.com/nx/find-work/" | Out-Null
Start-Sleep -Seconds 2

Push-Location $WorkerRoot
try {
    & $VenvPython -m acquisition.upwork_extension_collector `
        --config $ConfigPath `
        --qualification-config $QualificationPath `
        --output-directory $RunDirectory `
        --checkpoint $CheckpointPath `
        --port $CollectorPort
    $CollectorExit = $LASTEXITCODE
} finally {
    Pop-Location
}

if ($CollectorExit -eq 5) {
    throw "The collector was closed before a report was created. Start it again and use Finish and create report in the Chrome extension."
}
if ($CollectorExit -ne 0) {
    throw "The manual Chrome-extension collector stopped with exit code $CollectorExit. Share the visible non-sensitive error text in the project chat."
}

$ResultPath = Join-Path $RunDirectory "collector-result.json"
if (-not (Test-Path $ResultPath)) {
    throw "The collector finished but its result file was not created."
}
$Result = Get-Content -Raw -Path $ResultPath | ConvertFrom-Json
$ReportPath = [string]$Result.report_path
if (-not $ReportPath -or -not (Test-Path $ReportPath)) {
    throw "The collector finished but the HTML report was not found."
}

$Latest = [ordered]@{
    schema_version = "codistan-upwork-extension-latest.v3"
    completed_at = (Get-Date).ToString("o")
    capture_mode = "manual_chrome_extension_visible_cards_v3"
    run_directory = $RunDirectory
    report_path = $ReportPath
    dashboard_ready_path = [string]$Result.dashboard_ready_path
    dashboard_eligible = [int]$Result.dashboard_eligible
    priority_counts = $Result.priority_counts
    dashboard_ingestion_enabled = $false
}
$Latest | ConvertTo-Json -Depth 4 | Set-Content -Path (Join-Path $StateRoot "latest-upwork-pilot.json") -Encoding UTF8

Write-Step "Opening the Pilot V2 opportunity report"
Start-Process -FilePath $ChromeExecutable -ArgumentList "`"$ReportPath`"" | Out-Null
Write-Host "Report: $ReportPath" -ForegroundColor Green
Write-Host "Dashboard-ready file: $($Result.dashboard_ready_path)" -ForegroundColor Green
Write-Host "Captured opportunities: $($Result.total_extracted)" -ForegroundColor Green
Write-Host "Priority A: $($Result.priority_counts.A) | Priority B: $($Result.priority_counts.B) | Priority C: $($Result.priority_counts.C)" -ForegroundColor Green
Write-Host "Dashboard-eligible A+B records: $($Result.dashboard_eligible)" -ForegroundColor Green
Write-Host ""
Write-Host "Dashboard ingestion remains disabled until this 25-opportunity calibration report is explicitly approved." -ForegroundColor Yellow
