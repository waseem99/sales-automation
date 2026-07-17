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
$AcceptancePath = Join-Path $StateRoot "upwork-automation-accepted.json"
$TaskName = "Codistan Upwork Acquisition"

Write-Step "Installing and testing the acquisition worker"
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $SetupScript
if ($LASTEXITCODE -ne 0) {
    throw "The acquisition worker setup or automated tests failed. No active schedule was created."
}

if (-not (Test-Path $ProfilePath) -or -not (Test-Path $ConnectionMarker)) {
    Write-Step "Connecting the dedicated Upwork browser profile once"
    Write-Host "A normal Chrome window will open. Log in and complete any verification yourself." -ForegroundColor Yellow
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $ConnectScript -Account Upwork
    if ($LASTEXITCODE -ne 0) {
        throw "The Upwork profile was not connected. No active schedule was created."
    }
}

New-Item -ItemType Directory -Force -Path $SecretsRoot | Out-Null
Write-Step "Configuring optional Prospect Desk ingestion"
Write-Host "The stability test never sends records to Prospect Desk." -ForegroundColor Yellow
$Configure = (Read-Host "Do you have the Prospect Desk ingestion URL and token now? Type Y for yes, or press Enter to skip").Trim().ToLowerInvariant()
if ($Configure -eq "y") {
    $Endpoint = (Read-Host "Paste the Prospect Desk ingestion endpoint URL").Trim()
    if (-not $Endpoint.StartsWith("https://")) {
        throw "The Prospect Desk endpoint must use HTTPS."
    }
    $TokenSecure = Read-Host "Paste the ingestion token (it will be encrypted for this Windows user)" -AsSecureString
    $PlainCheck = Convert-SecureStringToPlain $TokenSecure
    if (-not $PlainCheck) { throw "An ingestion token was not provided." }
    $PlainCheck = $null
    $SecretPayload = [ordered]@{
        schema_version = "codistan-prospect-desk-secret.v1"
        endpoint = $Endpoint
        encrypted_token = (ConvertFrom-SecureString $TokenSecure)
        created_at = (Get-Date).ToString("o")
        protection = "Windows DPAPI current user"
    }
    $SecretPayload | ConvertTo-Json -Depth 3 | Set-Content -Path $SecretsPath -Encoding UTF8
    Write-Host "Prospect Desk credentials were encrypted locally." -ForegroundColor Green
} elseif (Test-Path $SecretsPath) {
    Write-Host "Existing encrypted Prospect Desk credentials were preserved." -ForegroundColor Green
} else {
    Write-Host "Prospect Desk ingestion is not configured; Priority A/B records will remain local." -ForegroundColor Yellow
}

Write-Step "Reading the target-market schedule"
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
    throw "The configured acquisition cadence is outside the supported range."
}

Write-Step "Registering the schedule in disabled mode"
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
    -Description "Single-tab visible Chrome opportunity acquisition. Runs the three approved saved searches during configured US and Australian windows. Never submits proposals or messages." `
    -Force | Out-Null
Disable-ScheduledTask -TaskName $TaskName | Out-Null
Remove-Item -Path $AcceptancePath -Force -ErrorAction SilentlyContinue

$InstallRecord = [ordered]@{
    schema_version = "codistan-upwork-scheduled-install.v3"
    task_name = $TaskName
    task_enabled = $false
    cadence_minutes = $CadenceMinutes
    start_offset_minutes = $StartOffsetMinutes
    next_scheduler_trigger = $StartAt.ToString("o")
    active_window_strategy = "DST-aware America/New_York and Australia/Sydney windows"
    search_ids = @("ai-jobs", "roshana-2d-3d", "nadir-game-ar-vr")
    profile_path = $ProfilePath
    run_script = $RunScript
    installed_at = (Get-Date).ToString("o")
    user = $CurrentUser
    prospect_desk_credentials_configured = (Test-Path $SecretsPath)
    acceptance_required = $true
}
$InstallRecord | ConvertTo-Json -Depth 4 | Set-Content -Path (Join-Path $StateRoot "upwork-automation-installed.json") -Encoding UTF8

Write-Host "The recurring task is installed but remains disabled until the controlled test passes." -ForegroundColor Yellow

if ($SkipImmediateRun) {
    Write-Host "Controlled test skipped. The scheduled task remains disabled." -ForegroundColor Yellow
    exit 0
}

Write-Step "Running one controlled three-search stability test"
Write-Host "Chrome will use one tab. Do not click or refresh unless an explicit Upwork verification screen asks you to act." -ForegroundColor Yellow
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $RunScript -Force -AcceptanceTest
$AcceptanceExit = $LASTEXITCODE

if ($AcceptanceExit -eq 0 -and (Test-Path $AcceptancePath)) {
    Enable-ScheduledTask -TaskName $TaskName | Out-Null
    $Record = Get-Content -Raw -Path (Join-Path $StateRoot "upwork-automation-installed.json") | ConvertFrom-Json
    $Record.task_enabled = $true
    $Record.acceptance_required = $false
    $Record.accepted_at = (Get-Date).ToString("o")
    $Record | ConvertTo-Json -Depth 5 | Set-Content -Path (Join-Path $StateRoot "upwork-automation-installed.json") -Encoding UTF8

    Write-Host "" 
    Write-Host "Stability test passed. The 30-minute schedule is now enabled." -ForegroundColor Green
    Write-Host "Every active run checks AI Jobs, Roshana 2D/3D, and Nadir Game/AR/VR." -ForegroundColor Green
    Write-Host "Chrome opens only during the configured US or Australian market windows." -ForegroundColor Green
    exit 0
}

Disable-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue | Out-Null
Write-Host "" 
Write-Host "The stability test did not pass. The recurring task remains disabled." -ForegroundColor Yellow
Write-Host "A report and diagnostic files were preserved in the newest output folder." -ForegroundColor Yellow
exit 20
