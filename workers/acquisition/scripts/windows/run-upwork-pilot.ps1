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
$CheckpointPath = Join-Path $CheckpointRoot "upwork-extension-seen.json"
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

New-Item -ItemType Directory -Force -Path $StateRoot, $CheckpointRoot, $OutputRoot | Out-Null
if (Test-Path $ExtensionTarget) {
    Remove-Item -Recurse -Force $ExtensionTarget
}
Copy-Item -Recurse -Force $ExtensionSource $ExtensionTarget

Write-Step "Preparing the normal-Chrome capture extension"
Write-Host "This method uses your ordinary Chrome browser with no Playwright, no remote debugging," -ForegroundColor Yellow
Write-Host "no special Upwork launch flags, and no automatic navigation." -ForegroundColor Yellow
Write-Host "You will browse Upwork normally and click the Codistan extension to capture visible job cards." -ForegroundColor Yellow
Write-Host ""

$InstallChoice = ""
if (-not (Test-Path $ExtensionMarker)) {
    $InstallChoice = "i"
} else {
    $InstallChoice = (Read-Host "Press Enter if the Codistan Capture extension is installed, or type I to install/reload it").Trim().ToLowerInvariant()
}

if ($InstallChoice -eq "i") {
    Start-Process explorer.exe -ArgumentList "`"$ExtensionTarget`"" | Out-Null
    Start-Process -FilePath $ChromeExecutable -ArgumentList "chrome://extensions/" | Out-Null

    Write-Host ""
    Write-Host "ONE-TIME EXTENSION INSTALLATION" -ForegroundColor Green
    Write-Host "1. On the Chrome Extensions page, turn ON Developer mode (top-right)."
    Write-Host "2. Click Load unpacked."
    Write-Host "3. Select this folder:" -ForegroundColor Yellow
    Write-Host "   $ExtensionTarget" -ForegroundColor Yellow
    Write-Host "4. Click Chrome's puzzle-piece icon and pin 'Codistan Upwork Opportunity Capture'."
    Write-Host "5. Install it in the same ordinary Chrome profile you use for Upwork."
    Write-Host ""
    Read-Host "Press Enter only after the extension icon is visible in Chrome"
    "Installed or confirmed: $(Get-Date -Format o)" | Set-Content -Path $ExtensionMarker -Encoding UTF8
}

if (Test-LocalPort -Port $CollectorPort) {
    throw "Port $CollectorPort is already in use. Close any earlier Codistan capture command window and retry."
}

$RunId = Get-Date -Format "yyyyMMdd-HHmmss"
$RunDirectory = Join-Path $OutputRoot $RunId
New-Item -ItemType Directory -Force -Path $RunDirectory | Out-Null

Write-Step "Starting the local opportunity collector"
Write-Host "A normal Upwork page will open explicitly in Google Chrome." -ForegroundColor Yellow
Write-Host "For each saved search:" -ForegroundColor Yellow
Write-Host "  1. Open the search normally."
Write-Host "  2. Wait until the job cards are visible."
Write-Host "  3. Click the pinned Codistan extension icon."
Write-Host "  4. Choose the service category and click Capture visible jobs."
Write-Host "When finished, click Finish and create report in the extension." -ForegroundColor Yellow
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
    schema_version = "codistan-upwork-extension-latest.v1"
    completed_at = (Get-Date).ToString("o")
    capture_mode = "manual_chrome_extension_visible_cards"
    run_directory = $RunDirectory
    report_path = $ReportPath
    dashboard_ready_path = [string]$Result.dashboard_ready_path
    dashboard_ingestion_enabled = $false
}
$Latest | ConvertTo-Json -Depth 3 | Set-Content -Path (Join-Path $StateRoot "latest-upwork-pilot.json") -Encoding UTF8

Write-Step "Opening the local opportunity report"
Start-Process -FilePath $ChromeExecutable -ArgumentList "`"$ReportPath`"" | Out-Null
Write-Host "Report: $ReportPath" -ForegroundColor Green
Write-Host "Dashboard-ready file: $($Result.dashboard_ready_path)" -ForegroundColor Green
Write-Host "Captured opportunities: $($Result.total_extracted)" -ForegroundColor Green
Write-Host ""
Write-Host "Dashboard ingestion remains disabled until the report quality is explicitly approved." -ForegroundColor Yellow
