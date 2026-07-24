param(
    [string]$InstallRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..\..")).Path,
    [string]$StateRoot = (Join-Path $env:LOCALAPPDATA "Codistan\Acquisition")
)

$ErrorActionPreference = "Stop"
$source = Join-Path $InstallRoot "workers\acquisition\extensions\upwork"
$target = Join-Path $StateRoot "extensions\upwork"
if (-not (Test-Path (Join-Path $source "manifest.json"))) { throw "The Upwork extension source was not found." }
New-Item -ItemType Directory -Force -Path $target | Out-Null
Copy-Item -Path (Join-Path $source "*") -Destination $target -Recurse -Force

$chromeCandidates = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
)
$chrome = $chromeCandidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if (-not $chrome) { throw "Google Chrome was not found." }

Write-Host "Upwork extension prepared at: $target"
Write-Host "In Chrome: enable Developer mode, choose Load unpacked, and select that folder."
Start-Process -FilePath $chrome -ArgumentList "chrome://extensions/"
