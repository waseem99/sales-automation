[CmdletBinding()]
param(
    [ValidateSet("Both", "Upwork", "LinkedIn")]
    [string]$Account = "Both"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Write-Step([string]$Message) {
    Write-Host ""
    Write-Host "==> $Message" -ForegroundColor Cyan
}

$WorkerRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$RepositoryRoot = (Resolve-Path (Join-Path $WorkerRoot "..\..")).Path
$SetupScript = Join-Path $PSScriptRoot "setup-worker.ps1"
$VenvPython = Join-Path $WorkerRoot ".venv\Scripts\python.exe"
$StateRoot = Join-Path $env:LOCALAPPDATA "Codistan\Acquisition"
$ProfileRoot = Join-Path $StateRoot "profiles"

if (-not (Test-Path $VenvPython)) {
    Write-Step "The worker is not installed yet; running setup first"
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $SetupScript
    if ($LASTEXITCODE -ne 0) {
        throw "Worker setup failed."
    }
}

New-Item -ItemType Directory -Force -Path $ProfileRoot | Out-Null

function Connect-AccountProfile {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$ProfileFolder,
        [Parameter(Mandatory = $true)][string]$Url
    )

    $ProfilePath = Join-Path $ProfileRoot $ProfileFolder
    Write-Step "Connecting $Name"
    Write-Host "A dedicated Chromium window will open." -ForegroundColor Yellow
    Write-Host "1. Log in inside that browser window only."
    Write-Host "2. Complete OTP, CAPTCHA, or security verification yourself."
    Write-Host "3. Confirm that the account home page is visible."
    Write-Host "4. Return to this window and press Enter."
    Write-Host ""
    Write-Host "Never paste your password, cookies, recovery codes, or OTP into ChatGPT, GitHub, or this PowerShell window." -ForegroundColor Yellow

    Push-Location $WorkerRoot
    try {
        & $VenvPython -m acquisition browser --profile $ProfilePath --url $Url --repository-root $RepositoryRoot
        if ($LASTEXITCODE -ne 0) {
            throw "$Name browser setup failed."
        }
    } finally {
        Pop-Location
    }

    $Marker = [ordered]@{
        account = $Name
        profile_folder = $ProfileFolder
        completed_at = (Get-Date).ToString("o")
        verification = "User confirmed the authorized account page was visible. Live adapter validation is still required."
    }
    $Marker | ConvertTo-Json | Set-Content -Path (Join-Path $StateRoot "$ProfileFolder.connected.json") -Encoding UTF8
    Write-Host "$Name profile saved locally." -ForegroundColor Green
}

if ($Account -in @("Both", "Upwork")) {
    Connect-AccountProfile -Name "Upwork" -ProfileFolder "upwork" -Url "https://www.upwork.com/nx/find-work/"
}

if ($Account -in @("Both", "LinkedIn")) {
    Connect-AccountProfile -Name "LinkedIn Sales Navigator" -ProfileFolder "linkedin-sales-navigator" -Url "https://www.linkedin.com/sales/home"
}

Write-Step "Account connection step completed"
Write-Host "The browser profiles remain only on this Windows computer under:" -ForegroundColor Green
Write-Host $ProfileRoot
Write-Host ""
Write-Host "No proposal, connection request, InMail, message, or application has been sent." -ForegroundColor Green
