[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

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
$RunId = Get-Date -Format "yyyyMMdd-HHmmss"
$RunDirectory = Join-Path $OutputRoot $RunId
$LogPath = Join-Path $LogRoot "$RunId.log"
New-Item -ItemType Directory -Force -Path $RunDirectory | Out-Null

$EnableIngestion = $false
if (Test-Path $SecretsPath) {
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
        Add-Content -Path $LogPath -Value "Prospect Desk credentials could not be loaded; this run will retain Priority A/B items in the local pending queue."
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
if ($EnableIngestion) {
    $Arguments += "--enable-ingestion"
}

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

if (Test-Path $StatusPath) {
    try {
        $Status = Get-Content -Raw -Path $StatusPath | ConvertFrom-Json
        if ([bool]$Status.human_action_required) {
            & msg.exe * "Codistan Upwork automation paused. Complete the visible Upwork verification in Chrome; the next scheduled run will retry if the waiting window has ended." 2>$null
        } elseif ([int]$Status.priority_a_count -gt 0) {
            & msg.exe * "Codistan Prospect Desk: $($Status.priority_a_count) Priority A Upwork opportunity/opportunities captured for urgent review." 2>$null
        }
    } catch {
        Add-Content -Path $LogPath -Value "The local status notification could not be displayed."
    }
}

exit $WorkerExit
