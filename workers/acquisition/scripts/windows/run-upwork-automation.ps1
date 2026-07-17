[CmdletBinding()]
param(
    [switch]$Force,
    [switch]$AcceptanceTest
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Resolve-ChromeExecutable {
    foreach ($Candidate in @(
        (Join-Path $env:ProgramFiles "Google\Chrome\Application\chrome.exe"),
        (Join-Path ${env:ProgramFiles(x86)} "Google\Chrome\Application\chrome.exe"),
        (Join-Path $env:LOCALAPPDATA "Google\Chrome\Application\chrome.exe")
    )) {
        if ($Candidate -and (Test-Path $Candidate)) { return $Candidate }
    }
    return $null
}

$WorkerRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$VenvPython = Join-Path $WorkerRoot ".venv\Scripts\python.exe"
$StateRoot = Join-Path $env:LOCALAPPDATA "Codistan\Acquisition"
$ProfilePath = Join-Path $StateRoot "profiles\upwork-browser-v2"
$OutputRoot = Join-Path $StateRoot "output\upwork-automation"
$LogRoot = Join-Path $StateRoot "logs\upwork-automation"
$CheckpointPath = Join-Path $StateRoot "checkpoints\upwork-scheduled-seen.json"
$ConfigPath = Join-Path $WorkerRoot "config\upwork-automation.toml"
$QualificationPath = Join-Path $WorkerRoot "config\qualification.example.toml"
$SecretsPath = Join-Path $StateRoot "secrets\prospect-desk.json"
$StatusPath = Join-Path $StateRoot "upwork-automation-status.json"
$SchedulerLogPath = Join-Path $LogRoot "scheduler.log"
$AcceptancePath = Join-Path $StateRoot "upwork-automation-accepted.json"

if (-not (Test-Path $VenvPython)) {
    throw "The acquisition worker is not installed. Run INSTALL-UPWORK-AUTOMATION.cmd once."
}
if (-not (Test-Path $ProfilePath)) {
    throw "The saved Upwork browser profile is missing. Run CONNECT-ACCOUNTS.cmd and connect Upwork first."
}
if (-not (Test-Path $ConfigPath)) {
    throw "The scheduled Upwork configuration is missing."
}

New-Item -ItemType Directory -Force -Path $OutputRoot, $LogRoot, (Split-Path $CheckpointPath -Parent) | Out-Null
if ($AcceptanceTest) {
    Remove-Item -Path $AcceptancePath -Force -ErrorAction SilentlyContinue
}

if (-not $Force) {
    $ScheduleOutput = @(& $VenvPython -m acquisition upwork-schedule-check --config $ConfigPath --state-directory $StateRoot 2>&1)
    $ScheduleExit = $LASTEXITCODE
    Add-Content -Path $SchedulerLogPath -Value "[$(Get-Date -Format o)] schedule_exit=$ScheduleExit $($ScheduleOutput -join ' ')"
    if ($ScheduleExit -eq 10) { exit 0 }
    if ($ScheduleExit -ne 0) { throw "The target-market schedule could not be evaluated." }
}

$RunId = Get-Date -Format "yyyyMMdd-HHmmss"
$RunDirectory = Join-Path $OutputRoot $RunId
$LogPath = Join-Path $LogRoot "$RunId.log"
New-Item -ItemType Directory -Force -Path $RunDirectory | Out-Null

$EnableIngestion = $false
if ((-not $AcceptanceTest) -and (Test-Path $SecretsPath)) {
    try {
        $Secrets = Get-Content -Raw -Path $SecretsPath | ConvertFrom-Json
        $Endpoint = [string]$Secrets.endpoint
        $EncryptedToken = [string]$Secrets.encrypted_token
        if ($Endpoint -and $EncryptedToken) {
            $SecureToken = ConvertTo-SecureString $EncryptedToken
            $Pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureToken)
            try {
                $PlainToken = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($Pointer)
                if ($PlainToken) {
                    $env:ACQUISITION_INGEST_URL = $Endpoint
                    $env:ACQUISITION_INGEST_TOKEN = $PlainToken
                    $EnableIngestion = $true
                }
            } finally {
                if ($Pointer -ne [IntPtr]::Zero) {
                    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($Pointer)
                }
            }
        }
    } catch {
        Add-Content -Path $LogPath -Value "Prospect Desk credentials could not be loaded; this run will retain Priority A/B items locally."
    }
}

$Arguments = @(
    "-m", "acquisition", "upwork-scheduled",
    "--profile", $ProfilePath,
    "--repository-root", $WorkerRoot,
    "--config", $ConfigPath,
    "--qualification-config", $QualificationPath,
    "--output-directory", $RunDirectory,
    "--checkpoint", $CheckpointPath,
    "--state-directory", $StateRoot
)
if ($EnableIngestion) { $Arguments += "--enable-ingestion" }

Push-Location $WorkerRoot
try {
    & $VenvPython @Arguments *>&1 | Tee-Object -FilePath $LogPath
    $WorkerExit = $LASTEXITCODE
} finally {
    Pop-Location
    Remove-Item Env:ACQUISITION_INGEST_URL -ErrorAction SilentlyContinue
    Remove-Item Env:ACQUISITION_INGEST_TOKEN -ErrorAction SilentlyContinue
    $PlainToken = $null
    $SecureToken = $null
}

$ResultPath = Join-Path $RunDirectory "automation-result.json"
$SearchResultsPath = Join-Path $RunDirectory "search-results.json"
$ReportPath = Join-Path $RunDirectory "report.html"
$Result = $null
$SearchResults = $null
if (Test-Path $ResultPath) {
    try { $Result = Get-Content -Raw -Path $ResultPath | ConvertFrom-Json } catch { }
}
if (Test-Path $SearchResultsPath) {
    try { $SearchResults = Get-Content -Raw -Path $SearchResultsPath | ConvertFrom-Json } catch { }
}

if (Test-Path $ReportPath) {
    $Chrome = Resolve-ChromeExecutable
    if ($Chrome) {
        Start-Process -FilePath $Chrome -ArgumentList $ReportPath | Out-Null
    }
}

if ($AcceptanceTest) {
    $Passed = (
        $Result -and
        $SearchResults -and
        ([string]$Result.status -eq "completed") -and
        (-not [bool]$Result.human_action_required) -and
        ([int]$SearchResults.successful_searches -eq 3) -and
        (Test-Path $ReportPath)
    )
    if ($Passed) {
        $Acceptance = [ordered]@{
            schema_version = "codistan-upwork-acceptance.v1"
            accepted_at = (Get-Date).ToString("o")
            run_id = $RunId
            report = $ReportPath
            searches_completed = [int]$SearchResults.successful_searches
            extracted = [int]$Result.extracted
            status = [string]$Result.status
        }
        $Acceptance | ConvertTo-Json -Depth 4 | Set-Content -Path $AcceptancePath -Encoding UTF8
        & msg.exe * "Codistan Upwork stability test passed. All three searches completed and the report is open in Chrome." 2>$null
        exit 0
    }

    & msg.exe * "Codistan Upwork stability test did not pass. The scheduled task remains disabled; review the report or status before retrying." 2>$null
    exit 20
}

if ($Result) {
    try {
        if ([bool]$Result.human_action_required) {
            & msg.exe * "Codistan Upwork automation paused. Complete the visible Upwork verification in Chrome." 2>$null
        } elseif ([int]$Result.priority_a_count -gt 0) {
            & msg.exe * "Codistan Prospect Desk: $($Result.priority_a_count) Priority A Upwork opportunity/opportunities captured for review." 2>$null
        }
    } catch {
        Add-Content -Path $LogPath -Value "The local status notification could not be displayed."
    }
}

exit $WorkerExit
