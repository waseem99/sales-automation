[CmdletBinding()]
param(
    [switch]$SkipImmediateRun
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Write-Step([string]$Message) {
    Write-Host ""
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Convert-SecureStringToPlain([Security.SecureString]$Value) {
    $Pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Value)
    try {
        return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($Pointer)
    } finally {
        if ($Pointer -ne [IntPtr]::Zero) {
            [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($Pointer)
        }
    }
}

if ($env:OS -ne "Windows_NT") {
    throw "This installer is intended for the selected Windows acquisition workstation."
}

$WorkerRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$SetupScript = Join-Path $PSScriptRoot "setup-worker.ps1"
$ConnectScript = Join-Path $PSScriptRoot "connect-accounts.ps1"
$RunScript = Join-Path $PSScriptRoot "run-upwork-automation.ps1"
$VenvPython = Join-Path $WorkerRoot ".venv\Scripts\python.exe"
$ConfigPath = Join-Path $WorkerRoot "config\upwork-automation.toml"
$StateRoot = Join-Path $env:LOCALAPPDATA "Codistan\Acquisition"
$ProfilePath = Join-Path $StateRoot "profiles\upwork-browser-v2"
$ConnectionMarker = Join-Path $StateRoot "upwork.connected.json"
$SecretsRoot = Join-Path $StateRoot "secrets"
$SecretsPath = Join-Path $SecretsRoot "prospect-desk.json"
$TaskName = "Codistan Upwork Acquisition"

Write-Step "Installing and testing the acquisition worker"
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $SetupScript
if ($LASTEXITCODE -ne 0) {
    throw "The acquisition worker setup or automated tests failed. No scheduled task was created."
}

if (-not (Test-Path $ProfilePath) -or -not (Test-Path $ConnectionMarker)) {
    Write-Step "Connecting the dedicated Upwork browser profile once"
    Write-Host "A normal Chrome window will open. Log in and complete any verification yourself." -ForegroundColor Yellow
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $ConnectScript -Account Upwork
    if ($LASTEXITCODE -ne 0) {
        throw "The Upwork profile was not connected. No scheduled task was created."
    }
}

New-Item -ItemType Directory -Force -Path $SecretsRoot | Out-Null
Write-Step "Configuring optional Prospect Desk ingestion"
Write-Host "The worker can run without this and will keep Priority A/B opportunities in a safe local queue." -ForegroundColor Yellow
$Configure = (Read-Host "Do you have the Prospect Desk ingestion URL and token now? Type Y for yes, or press Enter to skip").Trim().ToLowerInvariant()
if ($Configure -eq "y") {
    $Endpoint = (Read-Host "Paste the Prospect Desk ingestion endpoint URL").Trim()
    if (-not $Endpoint.StartsWith("https://")) {
        throw "The Prospect Desk endpoint must use HTTPS."
    }
    $TokenSecure = Read-Host "Paste the ingestion token (it will be encrypted for this Windows user)" -AsSecureString
    $PlainCheck = Convert-SecureStringToPlain $TokenSecure
    if (-not $PlainCheck) {
        throw "An ingestion token was not provided."
    }
    $PlainCheck = $null
    $SecretPayload = [ordered]@{
        schema_version = "codistan-prospect-desk-secret.v1"
        endpoint = $Endpoint
        encrypted_token = (ConvertFrom-SecureString $TokenSecure)
        created_at = (Get-Date).ToString("o")
        protection = "Windows DPAPI current user"
    }
    $SecretPayload | ConvertTo-Json -Depth 3 | Set-Content -Path $SecretsPath -Encoding UTF8
    Write-Host "Prospect Desk credentials were encrypted locally and were not added to GitHub." -ForegroundColor Green
} elseif (Test-Path $SecretsPath) {
    Write-Host "Existing encrypted Prospect Desk credentials were preserved." -ForegroundColor Green
} else {
    Write-Host "Prospect Desk ingestion is not configured yet; Priority A/B opportunities will queue locally." -ForegroundColor Yellow
}

Write-Step "Reading the DST-aware acquisition schedule"
$ScheduleText = (& $VenvPython -m acquisition upwork-schedule-info --config $ConfigPath 2>&1 | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or -not $ScheduleText) {
    throw "The US/Australian target-market schedule could not be loaded."
}
try {
    $Schedule = $ScheduleText | ConvertFrom-Json
    $CadenceMinutes = [int]$Schedule.cadence_minutes
    $StartOffsetMinutes = [int]$Schedule.start_offset_minutes
} catch {
    throw "The target-market schedule output was invalid."
}
if ($CadenceMinutes -lt 15 -or $CadenceMinutes -gt 240) {
    throw "The configured acquisition cadence is outside the supported safety range."
}

Write-Step "Registering the recurring 30-minute schedule"
if (-not (Get-Module -ListAvailable -Name ScheduledTasks)) {
    throw "Windows Scheduled Tasks support is unavailable on this computer."
}

$Now = Get-Date
$StartAt = $Now.Date.AddMinutes($StartOffsetMinutes)
while ($StartAt -le $Now.AddSeconds(30)) {
    $StartAt = $StartAt.AddMinutes($CadenceMinutes)
}
$Trigger = New-ScheduledTaskTrigger `
    -Once `
    -At $StartAt `
    -RepetitionInterval (New-TimeSpan -Minutes $CadenceMinutes) `
    -RepetitionDuration (New-TimeSpan -Days 3650)

$PowerShellArguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$RunScript`""
$Action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $PowerShellArguments
$CurrentUser = "$env:USERDOMAIN\$env:USERNAME"
$Principal = New-ScheduledTaskPrincipal -UserId $CurrentUser -LogonType Interactive -RunLevel Limited
$TaskSettings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 29) `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $Action `
    -Trigger $Trigger `
    -Principal $Principal `
    -Settings $TaskSettings `
    -Description "Visible Upwork opportunity acquisition every 30 minutes during DST-aware US East-to-Pacific and early Australian windows. Runs all three approved saved searches. Stops and waits on login, CAPTCHA or security verification. Never submits proposals or messages." `
    -Force | Out-Null

$InstallRecord = [ordered]@{
    schema_version = "codistan-upwork-scheduled-install.v2"
    task_name = $TaskName
    cadence_minutes = $CadenceMinutes
    start_offset_minutes = $StartOffsetMinutes
    next_scheduler_trigger = $StartAt.ToString("o")
    active_window_strategy = "DST-aware America/New_York and Australia/Sydney windows from config"
    search_ids = @("ai-jobs", "roshana-2d-3d", "nadir-game-ar-vr")
    profile_path = $ProfilePath
    run_script = $RunScript
    installed_at = (Get-Date).ToString("o")
    user = $CurrentUser
    prospect_desk_credentials_configured = (Test-Path $SecretsPath)
}
$InstallRecord | ConvertTo-Json -Depth 4 | Set-Content -Path (Join-Path $StateRoot "upwork-automation-installed.json") -Encoding UTF8

Write-Host "Automatic Upwork acquisition is installed." -ForegroundColor Green
Write-Host "Cadence: every $CadenceMinutes minutes while a configured market window is active" -ForegroundColor Green
Write-Host "US window: 07:00 Eastern through 18:00 Pacific, DST-aware" -ForegroundColor Green
Write-Host "Australia window: 07:00-10:30 Sydney/Melbourne time, DST-aware" -ForegroundColor Green
Write-Host "Every active run checks AI Jobs, Roshana 2D/3D, and Nadir Game/AR/VR." -ForegroundColor Green
Write-Host "Windows task: $TaskName" -ForegroundColor Green
Write-Host ""
Write-Host "The computer must be powered on and this Windows user must be signed in so visible Chrome can run." -ForegroundColor Yellow
Write-Host "Cloudflare, CAPTCHA, login and identity checks are never bypassed. The worker waits safely and resumes only when the normal page returns." -ForegroundColor Yellow

if (-not $SkipImmediateRun) {
    Write-Step "Starting the first controlled test run"
    $Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$RunScript`" -Force"
    Start-Process -FilePath "powershell.exe" -ArgumentList $Arguments | Out-Null
    Write-Host "The first run has started. Chrome may open within a few seconds." -ForegroundColor Green
}
