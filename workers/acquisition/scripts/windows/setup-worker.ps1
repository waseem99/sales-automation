[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Write-Step([string]$Message) {
    Write-Host ""
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Find-Python312 {
    $knownPaths = @(
        (Join-Path $env:LOCALAPPDATA "Programs\Python\Python312\python.exe"),
        (Join-Path $env:ProgramFiles "Python312\python.exe")
    )

    if (Get-Command py -ErrorAction SilentlyContinue) {
        try {
            $resolved = (& py -3.12 -c "import sys; print(sys.executable)" 2>$null | Select-Object -First 1)
            if ($resolved -and (Test-Path $resolved)) {
                return $resolved
            }
        } catch {
            # Continue to the other discovery methods.
        }
    }

    foreach ($candidate in $knownPaths) {
        if (Test-Path $candidate) {
            return $candidate
        }
    }

    if (Get-Command python -ErrorAction SilentlyContinue) {
        try {
            $version = (& python -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')" 2>$null | Select-Object -First 1)
            if ($version -eq "3.12") {
                return (Get-Command python).Source
            }
        } catch {
            # Python exists but is not usable as the required runtime.
        }
    }

    return $null
}

if (-not $IsWindows -and $PSVersionTable.PSEdition -eq "Core") {
    throw "This setup script is intended for Windows."
}

$WorkerRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$StateRoot = Join-Path $env:LOCALAPPDATA "Codistan\Acquisition"
$ProfileRoot = Join-Path $StateRoot "profiles"
$OutputRoot = Join-Path $StateRoot "output"
$CheckpointRoot = Join-Path $StateRoot "checkpoints"
$VenvPath = Join-Path $WorkerRoot ".venv"
$VenvPython = Join-Path $VenvPath "Scripts\python.exe"

Write-Step "Checking Python 3.12"
$PythonExe = Find-Python312
if (-not $PythonExe) {
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
        throw "Python 3.12 is missing and Windows Package Manager (winget) is unavailable. Install Python 3.12 from python.org, then run START-HERE.cmd again."
    }

    Write-Host "Python 3.12 is not installed. Windows may ask for permission to install it."
    & winget install --id Python.Python.3.12 --exact --accept-package-agreements --accept-source-agreements
    if ($LASTEXITCODE -ne 0) {
        throw "Python 3.12 installation failed with exit code $LASTEXITCODE."
    }

    $PythonExe = Find-Python312
    if (-not $PythonExe) {
        throw "Python 3.12 was installed but could not be detected. Restart Windows and run START-HERE.cmd again."
    }
}
Write-Host "Using Python: $PythonExe"

Write-Step "Creating private local folders"
New-Item -ItemType Directory -Force -Path $StateRoot, $ProfileRoot, $OutputRoot, $CheckpointRoot | Out-Null

Write-Step "Creating the acquisition worker environment"
if (-not (Test-Path $VenvPython)) {
    & $PythonExe -m venv $VenvPath
    if ($LASTEXITCODE -ne 0) {
        throw "Could not create the Python environment."
    }
}

Push-Location $WorkerRoot
try {
    Write-Step "Installing the worker and browser support"
    & $VenvPython -m pip install --upgrade pip
    if ($LASTEXITCODE -ne 0) { throw "pip upgrade failed." }

    & $VenvPython -m pip install -e ".[browser]"
    if ($LASTEXITCODE -ne 0) { throw "Worker installation failed." }

    & $VenvPython -m playwright install chromium
    if ($LASTEXITCODE -ne 0) { throw "Chromium installation failed." }

    Write-Step "Running safety and reliability checks"
    & $VenvPython -m unittest discover -s tests -v
    if ($LASTEXITCODE -ne 0) { throw "The worker tests failed. Account connection has been stopped." }
} finally {
    Pop-Location
}

$Settings = [ordered]@{
    schema_version = "codistan-acquisition-local.v1"
    worker_root = $WorkerRoot
    state_root = $StateRoot
    profile_root = $ProfileRoot
    output_root = $OutputRoot
    checkpoint_root = $CheckpointRoot
    installed_at = (Get-Date).ToString("o")
}
$Settings | ConvertTo-Json -Depth 3 | Set-Content -Path (Join-Path $StateRoot "settings.json") -Encoding UTF8

Write-Step "Setup completed successfully"
Write-Host "Private account profiles will be stored under:" -ForegroundColor Green
Write-Host $ProfileRoot
Write-Host ""
Write-Host "No passwords, cookies, or browser profiles are stored in GitHub." -ForegroundColor Green
