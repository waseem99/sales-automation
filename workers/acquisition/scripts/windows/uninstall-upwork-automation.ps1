[CmdletBinding()]
param(
    [switch]$RemoveEncryptedProspectDeskCredentials
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$TaskName = "Codistan Upwork Acquisition"
$StateRoot = Join-Path $env:LOCALAPPDATA "Codistan\Acquisition"
$SecretsPath = Join-Path $StateRoot "secrets\prospect-desk.json"
$InstallRecord = Join-Path $StateRoot "upwork-automation-installed.json"
$LockPath = Join-Path $StateRoot "upwork-automation.lock"

$Existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($Existing) {
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "Removed Windows task: $TaskName" -ForegroundColor Green
} else {
    Write-Host "The scheduled Upwork task was not installed." -ForegroundColor Yellow
}

Remove-Item -Path $InstallRecord, $LockPath -Force -ErrorAction SilentlyContinue

if ($RemoveEncryptedProspectDeskCredentials) {
    Remove-Item -Path $SecretsPath -Force -ErrorAction SilentlyContinue
    Write-Host "Removed the encrypted local Prospect Desk credential file." -ForegroundColor Green
} elseif (Test-Path $SecretsPath) {
    Write-Host "Encrypted Prospect Desk credentials were preserved." -ForegroundColor Yellow
}

Write-Host "Browser profiles, reports, checkpoints and opportunity history were preserved." -ForegroundColor Green
