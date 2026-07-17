[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Write-Step([string]$Message) {
    Write-Host ""
    Write-Host "==> $Message" -ForegroundColor Cyan
}

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

if ($env:OS -ne "Windows_NT") {
    throw "This installer is intended for the configured Windows workstation."
}

$WorkerRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$SetupScript = Join-Path $PSScriptRoot "setup-worker.ps1"
$RunScript = Join-Path $PSScriptRoot "run-upwork-normal-chrome-service.ps1"
$SourceExtension = Join-Path $WorkerRoot "browser-extension"
$StateRoot = Join-Path $env:LOCALAPPDATA "Codistan\Acquisition"
$TargetExtension = Join-Path $StateRoot "upwork-capture-extension"
$InstallRecordPath = Join-Path $StateRoot "upwork-normal-chrome-installed.json"
$OldTaskName = "Codistan Upwork Acquisition"
$TaskName = "Codistan Upwork Capture Service"

Write-Step "Installing and testing the acquisition processor"
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $SetupScript
if ($LASTEXITCODE -ne 0) {
    throw "The acquisition processor setup or tests failed. No service task was created."
}

Write-Step "Removing the old browser-automation schedule"
$OldTask = Get-ScheduledTask -TaskName $OldTaskName -ErrorAction SilentlyContinue
if ($OldTask) {
    Stop-ScheduledTask -TaskName $OldTaskName -ErrorAction SilentlyContinue
    Disable-ScheduledTask -TaskName $OldTaskName -ErrorAction SilentlyContinue | Out-Null
    Unregister-ScheduledTask -TaskName $OldTaskName -Confirm:$false
    Write-Host "Removed: $OldTaskName" -ForegroundColor Green
} else {
    Write-Host "The old browser-automation task was not installed." -ForegroundColor Green
}

Write-Step "Stopping earlier local capture processors"
$MatchingProcesses = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
    $_.CommandLine -and $_.CommandLine -match "acquisition\.(upwork_extension_collector|upwork_extension_service)"
}
foreach ($Process in @($MatchingProcesses)) {
    Stop-Process -Id $Process.ProcessId -Force -ErrorAction SilentlyContinue
}
Start-Sleep -Seconds 1

Write-Step "Updating the unpacked Chrome extension"
if (-not (Test-Path $SourceExtension)) {
    throw "The Codistan Chrome extension source folder was not found."
}
New-Item -ItemType Directory -Force -Path $StateRoot | Out-Null
if (Test-Path $TargetExtension) {
    Remove-Item -Recurse -Force $TargetExtension
}
Copy-Item -Recurse -Force $SourceExtension $TargetExtension
Write-Host "Extension folder updated: $TargetExtension" -ForegroundColor Green

Write-Step "Registering the localhost processor at Windows sign-in"
if (-not (Get-Module -ListAvailable -Name ScheduledTasks)) {
    throw "Windows Scheduled Tasks support is unavailable on this computer."
}

$ExistingTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($ExistingTask) {
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

$CurrentUser = "$env:USERDOMAIN\$env:USERNAME"
$Trigger = New-ScheduledTaskTrigger -AtLogOn -User $CurrentUser
$Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$RunScript`""
$Action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $Arguments
$Principal = New-ScheduledTaskPrincipal -UserId $CurrentUser -LogonType Interactive -RunLevel Limited
$Settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $Action `
    -Trigger $Trigger `
    -Principal $Principal `
    -Settings $Settings `
    -Description "Runs only the Codistan localhost processor. It never opens, navigates, refreshes, scrolls or controls Upwork. Normal Chrome extension captures are processed after the user visits an approved saved search." `
    -Force | Out-Null

Start-ScheduledTask -TaskName $TaskName
Start-Sleep -Seconds 4

$ServiceReady = $false
try {
    $Status = Invoke-RestMethod -Uri "http://127.0.0.1:8765/status" -Method Get -TimeoutSec 5
    $ServiceReady = [bool]$Status.ready
} catch {
    $ServiceReady = $false
}
if (-not $ServiceReady) {
    throw "The localhost capture processor did not start successfully. The Chrome extension was updated, but automatic capture is not ready."
}

$InstallRecord = [ordered]@{
    schema_version = "codistan-upwork-normal-chrome-install.v1"
    installed_at = (Get-Date).ToString("o")
    user = $CurrentUser
    task_name = $TaskName
    task_purpose = "localhost capture processing only"
    extension_path = $TargetExtension
    collector_url = "http://127.0.0.1:8765"
    browser_automation_removed = $true
    automatic_navigation = $false
    automatic_refresh = $false
    automatic_scrolling = $false
}
$InstallRecord | ConvertTo-Json -Depth 4 | Set-Content -Path $InstallRecordPath -Encoding UTF8

Write-Step "Reloading the unpacked extension once"
$Chrome = Resolve-ChromeExecutable
Start-Process explorer.exe -ArgumentList "`"$TargetExtension`"" | Out-Null
if ($Chrome) {
    Start-Process -FilePath $Chrome -ArgumentList "chrome://extensions/" | Out-Null
    Write-Host "Chrome Extensions and the extension folder are open." -ForegroundColor Yellow
    Write-Host "Find Codistan Upwork Opportunity Capture and click its circular Reload icon once." -ForegroundColor Yellow
} else {
    Write-Host "Google Chrome was not found automatically." -ForegroundColor Yellow
    Write-Host "Open chrome://extensions/ yourself and reload the Codistan extension once." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Normal-Chrome capture service installed successfully." -ForegroundColor Green
Write-Host "The service does not open Upwork. Open an approved saved search normally; visible cards will be captured automatically." -ForegroundColor Green
Write-Host "No proposal, message, application, navigation, refresh or scrolling is automated." -ForegroundColor Green
