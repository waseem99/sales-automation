[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Write-Step([string]$Message) {
    Write-Host ""
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Find-Python312 {
    $KnownPaths = @(
        (Join-Path $env:LOCALAPPDATA "Programs\Python\Python312\python.exe"),
        (Join-Path $env:ProgramFiles "Python312\python.exe")
    )
    if (Get-Command py -ErrorAction SilentlyContinue) {
        try {
            $Resolved = (& py -3.12 -c "import sys; print(sys.executable)" 2>$null | Select-Object -First 1)
            if ($Resolved -and (Test-Path $Resolved)) { return $Resolved }
        } catch {}
    }
    foreach ($Candidate in $KnownPaths) {
        if (Test-Path $Candidate) { return $Candidate }
    }
    if (Get-Command python -ErrorAction SilentlyContinue) {
        try {
            $Version = (& python -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')" 2>$null | Select-Object -First 1)
            if ($Version -eq "3.12") { return (Get-Command python).Source }
        } catch {}
    }
    return $null
}

if ($env:OS -ne "Windows_NT") {
    throw "This setup script is intended for Windows."
}

$WorkerRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$StateRoot = Join-Path $env:LOCALAPPDATA "Codistan\Acquisition"
$VenvPath = Join-Path $WorkerRoot ".venv"
$VenvPython = Join-Path $VenvPath "Scripts\python.exe"

Write-Step "Checking Python 3.12"
$PythonExe = Find-Python312
if (-not $PythonExe) {
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
        throw "Python 3.12 is missing. Install Python 3.12 from python.org, then rerun this installer."
    }
    & winget install --id Python.Python.3.12 --exact --accept-package-agreements --accept-source-agreements
    if ($LASTEXITCODE -ne 0) { throw "Python 3.12 installation failed." }
    $PythonExe = Find-Python312
    if (-not $PythonExe) { throw "Python 3.12 was installed but could not be detected. Restart Windows and retry." }
}

New-Item -ItemType Directory -Force -Path $StateRoot, (Join-Path $StateRoot "output"), (Join-Path $StateRoot "checkpoints") | Out-Null
if (-not (Test-Path $VenvPython)) {
    & $PythonExe -m venv $VenvPath
    if ($LASTEXITCODE -ne 0) { throw "Could not create the Python environment." }
}

Push-Location $WorkerRoot
try {
    Write-Step "Installing the localhost processor"
    & $VenvPython -m pip install --upgrade pip
    if ($LASTEXITCODE -ne 0) { throw "pip upgrade failed." }
    & $VenvPython -m pip install -e "."
    if ($LASTEXITCODE -ne 0) { throw "Processor installation failed." }

    Write-Step "Running safety and reliability checks"
    & $VenvPython -m unittest discover -s tests -v
    if ($LASTEXITCODE -ne 0) { throw "The processor tests failed. No Windows task was created." }
} finally {
    Pop-Location
}

Write-Host "Processor setup completed without Playwright or bundled Chromium." -ForegroundColor Green
