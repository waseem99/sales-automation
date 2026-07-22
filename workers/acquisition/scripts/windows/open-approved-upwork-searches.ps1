param(
    [string]$InstallRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..\..")).Path
)

$ErrorActionPreference = "Stop"
$healthUrl = "http://127.0.0.1:8765/health"
try {
    Invoke-RestMethod -Uri $healthUrl -TimeoutSec 2 | Out-Null
} catch {
    $startCommand = Join-Path $InstallRoot "workers\acquisition\START-ACQUISITION-V4.cmd"
    if (-not (Test-Path $startCommand)) { throw "The Acquisition V4 start command was not found." }
    Start-Process -FilePath $startCommand -WindowStyle Minimized
    $ready = $false
    for ($attempt = 0; $attempt -lt 15; $attempt++) {
        Start-Sleep -Seconds 1
        try {
            Invoke-RestMethod -Uri $healthUrl -TimeoutSec 2 | Out-Null
            $ready = $true
            break
        } catch {}
    }
    if (-not $ready) { throw "The Upwork collector did not become healthy on port 8765." }
}

$chromeCandidates = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
)
$chrome = $chromeCandidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if (-not $chrome) { throw "Google Chrome was not found." }

$urls = @(
    "https://www.upwork.com/nx/find-work/9652811",
    "https://www.upwork.com/nx/find-work/9652860",
    "https://www.upwork.com/nx/find-work/9652877"
)
Start-Process -FilePath $chrome -ArgumentList @("--new-window") + $urls
Write-Host "Opened the three approved Upwork searches in normal Chrome."
