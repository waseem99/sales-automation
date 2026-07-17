[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$WorkerRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$VenvPython = Join-Path $WorkerRoot ".venv\Scripts\python.exe"
$StateRoot = Join-Path $env:LOCALAPPDATA "Codistan\Acquisition"
$OutputRoot = Join-Path $StateRoot "output\upwork-normal-chrome"
$LogRoot = Join-Path $StateRoot "logs\upwork-normal-chrome"
$CheckpointPath = Join-Path $StateRoot "checkpoints\upwork-normal-chrome-seen.json"
$ConfigPath = Join-Path $WorkerRoot "config\upwork-automation.toml"
$QualificationPath = Join-Path $WorkerRoot "config\qualification.example.toml"
$LatestPathFile = Join-Path $StateRoot "upwork-normal-chrome-latest.txt"
$Port = 8765

if (-not (Test-Path $VenvPython)) {
    throw "The acquisition worker is not installed. Run the normal-Chrome capture installer once."
}

New-Item -ItemType Directory -Force -Path $OutputRoot, $LogRoot, (Split-Path $CheckpointPath -Parent) | Out-Null

$ExistingListener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($ExistingListener) {
    exit 0
}

$RunId = Get-Date -Format "yyyyMMdd-HHmmss"
$RunDirectory = Join-Path $OutputRoot $RunId
$LogPath = Join-Path $LogRoot "$RunId.log"
New-Item -ItemType Directory -Force -Path $RunDirectory | Out-Null
Set-Content -Path $LatestPathFile -Value $RunDirectory -Encoding UTF8

$Arguments = @(
    "-m", "acquisition.upwork_extension_service",
    "--config", $ConfigPath,
    "--qualification-config", $QualificationPath,
    "--output-directory", $RunDirectory,
    "--checkpoint", $CheckpointPath,
    "--state-directory", $StateRoot,
    "--port", "$Port"
)

Push-Location $WorkerRoot
try {
    & $VenvPython @Arguments *>&1 | Tee-Object -FilePath $LogPath
    exit $LASTEXITCODE
} finally {
    Pop-Location
}
