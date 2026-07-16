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

function Find-NativeBrowser {
    $candidates = @(
        @{ Path = (Join-Path $env:LOCALAPPDATA "Google\Chrome\Application\chrome.exe"); Channel = "chrome"; Name = "Google Chrome" },
        @{ Path = (Join-Path $env:ProgramFiles "Google\Chrome\Application\chrome.exe"); Channel = "chrome"; Name = "Google Chrome" },
        @{ Path = (Join-Path ${env:ProgramFiles(x86)} "Google\Chrome\Application\chrome.exe"); Channel = "chrome"; Name = "Google Chrome" },
        @{ Path = (Join-Path ${env:ProgramFiles(x86)} "Microsoft\Edge\Application\msedge.exe"); Channel = "msedge"; Name = "Microsoft Edge" },
        @{ Path = (Join-Path $env:ProgramFiles "Microsoft\Edge\Application\msedge.exe"); Channel = "msedge"; Name = "Microsoft Edge" }
    )

    foreach ($candidate in $candidates) {
        if ($candidate.Path -and (Test-Path $candidate.Path)) {
            return $candidate
        }
    }

    return $null
}

$WorkerRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
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

$Browser = Find-NativeBrowser
if (-not $Browser) {
    throw "Google Chrome or Microsoft Edge was not found. Install either browser and run CONNECT-ACCOUNTS.cmd again."
}

New-Item -ItemType Directory -Force -Path $ProfileRoot | Out-Null

function Connect-AccountProfile {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$ProfileFolder,
        [Parameter(Mandatory = $true)][string]$Url
    )

    $ProfilePath = Join-Path $ProfileRoot $ProfileFolder
    New-Item -ItemType Directory -Force -Path $ProfilePath | Out-Null

    Write-Step "Connecting $Name"
    Write-Host "A normal $($Browser.Name) window will open with a separate private profile." -ForegroundColor Yellow
    Write-Host "1. Log in inside that browser window only."
    Write-Host "2. Complete OTP, CAPTCHA, or security verification yourself."
    Write-Host "3. Confirm that the account home page is visible."
    Write-Host "4. CLOSE that dedicated browser window so the login is saved."
    Write-Host "5. Return to this window and press Enter."
    Write-Host ""
    Write-Host "Never paste your password, cookies, recovery codes, or OTP into ChatGPT, GitHub, or this PowerShell window." -ForegroundColor Yellow

    $arguments = @(
        "--user-data-dir=$ProfilePath",
        "--no-first-run",
        "--no-default-browser-check",
        "--new-window",
        $Url
    )
    Start-Process -FilePath $Browser.Path -ArgumentList $arguments | Out-Null
    Read-Host "Press Enter only after login succeeds and you have closed the dedicated browser window"

    $Marker = [ordered]@{
        account = $Name
        profile_folder = $ProfileFolder
        browser_name = $Browser.Name
        browser_channel = $Browser.Channel
        browser_executable = $Browser.Path
        completed_at = (Get-Date).ToString("o")
        verification = "User confirmed the authorized account page was visible in a native browser. Live adapter validation is still required."
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
