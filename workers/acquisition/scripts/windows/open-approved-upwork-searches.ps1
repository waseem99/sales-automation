[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$StateRoot = Join-Path $env:LOCALAPPDATA "Codistan\Acquisition"
$LogRoot = Join-Path $StateRoot "logs"
$LogPath = Join-Path $LogRoot "upwork-one-click-launcher.log"
$TaskName = "Codistan Upwork Capture Service"
$StatusUrl = "http://127.0.0.1:8765/status"
$ApprovedUrls = @(
    "https://www.upwork.com/nx/find-work/9652811",
    "https://www.upwork.com/nx/find-work/9652860",
    "https://www.upwork.com/nx/find-work/9652877"
)

function Write-LauncherLog([string]$Message) {
    New-Item -ItemType Directory -Force -Path $LogRoot | Out-Null
    $line = "{0} {1}" -f (Get-Date).ToString("o"), $Message
    Add-Content -Path $LogPath -Value $line -Encoding UTF8
}

function Find-Chrome {
    $candidates = @(
        (Join-Path $env:ProgramFiles "Google\Chrome\Application\chrome.exe"),
        (Join-Path ${env:ProgramFiles(x86)} "Google\Chrome\Application\chrome.exe"),
        (Join-Path $env:LOCALAPPDATA "Google\Chrome\Application\chrome.exe")
    )
    foreach ($path in $candidates) {
        if ($path -and (Test-Path $path)) { return $path }
    }
    $command = Get-Command chrome.exe -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
    return $null
}

function Test-ProcessorReady {
    try {
        $status = Invoke-RestMethod -Uri $StatusUrl -TimeoutSec 3
        return [bool]$status.ready -and $status.mode -eq "normal_chrome_auto_capture"
    } catch {
        return $false
    }
}

function Start-ProcessorIfNeeded {
    if (Test-ProcessorReady) { return }

    $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if (-not $task) {
        throw "The Codistan Upwork capture service is not installed. Run the exact-search installer once."
    }

    Start-ScheduledTask -TaskName $TaskName
    for ($attempt = 1; $attempt -le 10; $attempt++) {
        Start-Sleep -Seconds 1
        if (Test-ProcessorReady) { return }
    }
    throw "The local Upwork capture processor did not become ready."
}

function Show-LauncherError([string]$Message) {
    try {
        Add-Type -AssemblyName PresentationFramework -ErrorAction Stop
        [System.Windows.MessageBox]::Show(
            $Message,
            "Codistan Upwork launcher",
            [System.Windows.MessageBoxButton]::OK,
            [System.Windows.MessageBoxImage]::Error
        ) | Out-Null
    } catch {
        Write-Error $Message
    }
}

try {
    Write-LauncherLog "Launcher started."
    Start-ProcessorIfNeeded

    $chrome = Find-Chrome
    if (-not $chrome) {
        throw "Google Chrome was not found on this PC."
    }

    $arguments = @("--new-window") + $ApprovedUrls
    Start-Process -FilePath $chrome -ArgumentList $arguments | Out-Null
    Write-LauncherLog "Opened the three approved saved searches in normal Chrome."
} catch {
    $message = $_.Exception.Message
    Write-LauncherLog "ERROR: $message"
    Show-LauncherError $message
    exit 1
}
