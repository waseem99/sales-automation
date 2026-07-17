[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Step([string]$Text) {
    Write-Host ""
    Write-Host "==> $Text" -ForegroundColor Cyan
}

function Find-Chrome {
    foreach ($Path in @(
        (Join-Path $env:ProgramFiles "Google\Chrome\Application\chrome.exe"),
        (Join-Path ${env:ProgramFiles(x86)} "Google\Chrome\Application\chrome.exe"),
        (Join-Path $env:LOCALAPPDATA "Google\Chrome\Application\chrome.exe")
    )) {
        if ($Path -and (Test-Path $Path)) { return $Path }
    }
    return $null
}

$WorkerRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$Setup = Join-Path $PSScriptRoot "setup-normal-chrome-worker.ps1"
$Runner = Join-Path $PSScriptRoot "run-upwork-normal-chrome-service.ps1"
$StateRoot = Join-Path $env:LOCALAPPDATA "Codistan\Acquisition"
$SourceExtension = Join-Path $WorkerRoot "browser-extension"
$TargetExtension = Join-Path $StateRoot "upwork-capture-extension"
$OldTask = "Codistan Upwork Acquisition"
$TaskName = "Codistan Upwork Capture Service"

Step "Installing and testing the localhost processor"
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $Setup
if ($LASTEXITCODE -ne 0) { throw "Processor setup or tests failed." }

Step "Removing the previous automated-browser task"
if (Get-ScheduledTask -TaskName $OldTask -ErrorAction SilentlyContinue) {
    Stop-ScheduledTask -TaskName $OldTask -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $OldTask -Confirm:$false
}
if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

Step "Updating the unpacked Chrome extension"
New-Item -ItemType Directory -Force -Path $StateRoot | Out-Null
if (Test-Path $TargetExtension) { Remove-Item -Recurse -Force $TargetExtension }
Copy-Item -Recurse -Force $SourceExtension $TargetExtension

Step "Starting the localhost processor at Windows sign-in"
$User = "$env:USERDOMAIN\$env:USERNAME"
$Trigger = New-ScheduledTaskTrigger -AtLogOn -User $User
$Action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$Runner`""
$Principal = New-ScheduledTaskPrincipal -UserId $User -LogonType Interactive -RunLevel Limited
$Settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero)
Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Principal $Principal -Settings $Settings -Description "Local Codistan capture processor only. Does not open or control Upwork." -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName
Start-Sleep -Seconds 4

try {
    $Status = Invoke-RestMethod -Uri "http://127.0.0.1:8765/status" -TimeoutSec 5
    if (-not [bool]$Status.ready) { throw "Processor did not report ready." }
} catch {
    throw "The localhost processor did not start. The task remains installed for diagnosis."
}

@{
    schema_version = "codistan-upwork-normal-chrome-install.v1"
    installed_at = (Get-Date).ToString("o")
    task_name = $TaskName
    extension_path = $TargetExtension
    browser_automation_removed = $true
    automatic_navigation = $false
    automatic_refresh = $false
    automatic_scrolling = $false
    playwright_required = $false
} | ConvertTo-Json | Set-Content -Path (Join-Path $StateRoot "upwork-normal-chrome-installed.json") -Encoding UTF8

Step "Reloading the extension once"
Start-Process explorer.exe -ArgumentList "`"$TargetExtension`"" | Out-Null
$Chrome = Find-Chrome
if ($Chrome) { Start-Process -FilePath $Chrome -ArgumentList "chrome://extensions/" | Out-Null }

Write-Host ""
Write-Host "Processor ready. Reload Codistan Upwork Opportunity Capture once in chrome://extensions/." -ForegroundColor Green
Write-Host "Then open any approved saved search normally in Chrome." -ForegroundColor Green
