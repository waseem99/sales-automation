param(
    [string]$InstallRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..\..")).Path
)

$ErrorActionPreference = "Stop"
$healthUrl = "http://127.0.0.1:8775/health"
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
    if (-not $ready) { throw "The LinkedIn collector did not become healthy on port 8775." }
}

$chromeCandidates = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
)
$chrome = $chromeCandidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if (-not $chrome) { throw "Google Chrome was not found." }

$queries = @(
    "looking for software development agency",
    "looking for AI automation partner",
    "looking for digital marketing agency",
    "looking for video animation agency",
    "looking for cybersecurity consultant"
)
$urls = $queries | ForEach-Object {
    "https://www.linkedin.com/search/results/content/?keywords=$([uri]::EscapeDataString($_))&origin=GLOBAL_SEARCH_HEADER"
}
$chromeArguments = @("--new-window") + @($urls)
Start-Process -FilePath $chrome -ArgumentList $chromeArguments
Write-Host "Opened the approved LinkedIn direct-requirement searches in normal Chrome."
