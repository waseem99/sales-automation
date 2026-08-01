param(
    [string]$InstallRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..\..")).Path,
    [string]$StateRoot = (Join-Path $env:LOCALAPPDATA "Codistan\Acquisition")
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$healthUrl = "http://127.0.0.1:8765/health"
try {
    $health = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 2
    if ($health.schema_version -ne "codistan-acquisition-health.v1" -or $health.source -ne "upwork" -or $health.external_actions_enabled -ne $false) {
        throw "Port 8765 is not the safe Sales Automation Upwork collector."
    }
} catch {
    $startCommand = Join-Path $InstallRoot "workers\acquisition\START-ACQUISITION-V4.cmd"
    if (-not (Test-Path $startCommand)) { throw "The Sales Automation start command was not found." }
    Start-Process -FilePath $startCommand -WindowStyle Minimized | Out-Null
    $ready = $false
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        Start-Sleep -Seconds 1
        try {
            $health = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 2
            if ($health.schema_version -eq "codistan-acquisition-health.v1" -and $health.source -eq "upwork" -and $health.external_actions_enabled -eq $false) {
                $ready = $true
                break
            }
        } catch {}
    }
    if (-not $ready) { throw "The Upwork collector did not become healthy on port 8765." }
}

$browserBootstrap = Join-Path $PSScriptRoot "chromium-browser.ps1"
if (-not (Test-Path -LiteralPath $browserBootstrap)) { throw "The browser discovery module was not found." }
. $browserBootstrap
$browser = Get-CodistanChromiumBrowser -StateRoot $StateRoot

$urls = @(
    "https://www.upwork.com/nx/find-work/9652811",
    "https://www.upwork.com/nx/find-work/9652860",
    "https://www.upwork.com/nx/find-work/9652877"
)
$chromeArguments = @("--new-window") + $urls
Start-Process -FilePath ([string]$browser.Executable) -ArgumentList $chromeArguments | Out-Null
Write-Host "Opened the three approved Upwork searches in $($browser.Name)."
