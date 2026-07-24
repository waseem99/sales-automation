param(
    [string]$InstallRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..\..")).Path,
    [string]$StateRoot = (Join-Path $env:LOCALAPPDATA "Codistan\Acquisition"),
    [string]$Endpoint,
    [string]$Token,
    [ValidateRange(30, 3600)][int]$IntervalSeconds = 60,
    [switch]$Disable
)

$ErrorActionPreference = "Stop"
$configDirectory = Join-Path $StateRoot "config"
$configPath = Join-Path $configDirectory "prospect-desk-sync.json"
New-Item -ItemType Directory -Force -Path $configDirectory | Out-Null

function Read-PlainTextSecret([string]$Prompt) {
    $secure = Read-Host $Prompt -AsSecureString
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}

if ($Disable) {
    $existing = $null
    if (Test-Path $configPath) {
        try { $existing = Get-Content $configPath -Raw | ConvertFrom-Json } catch {}
    }
    $disabledConfig = [ordered]@{
        version = 1
        enabled = $false
        endpoint = if ($existing.endpoint) { [string]$existing.endpoint } else { "" }
        token = if ($existing.token) { [string]$existing.token } else { "" }
        sources = @("linkedin")
        interval_seconds = $IntervalSeconds
    }
    $disabledConfig | ConvertTo-Json -Depth 5 | Set-Content -Path $configPath -Encoding UTF8
    Write-Host "Prospect Desk sync disabled. Local capture continues normally."
    Write-Host "Config: $configPath"
    exit 0
}

if (-not $Endpoint) {
    $Endpoint = Read-Host "Prospect Desk ingestion URL (must end with /api/acquisition-ingest)"
}
$Endpoint = $Endpoint.Trim().TrimEnd('/')
if (-not $Endpoint.EndsWith('/api/acquisition-ingest', [StringComparison]::OrdinalIgnoreCase)) {
    $Endpoint = "$Endpoint/api/acquisition-ingest"
}

$uri = $null
if (-not [uri]::TryCreate($Endpoint, [UriKind]::Absolute, [ref]$uri)) {
    throw "The Prospect Desk endpoint is not a valid absolute URL."
}
if ($uri.Scheme -ne "https" -and -not (($uri.Host -eq "127.0.0.1" -or $uri.Host -eq "localhost") -and $uri.Scheme -eq "http")) {
    throw "The Prospect Desk endpoint must use HTTPS."
}
if (-not $uri.AbsolutePath.EndsWith('/api/acquisition-ingest', [StringComparison]::OrdinalIgnoreCase)) {
    throw "The Prospect Desk endpoint must end with /api/acquisition-ingest."
}

if (-not $Token) {
    $Token = Read-PlainTextSecret "ACQUISITION_INGEST_TOKEN (input is hidden)"
}
$Token = $Token.Trim()
if ($Token.Length -lt 32) {
    throw "The ingestion token must contain at least 32 characters."
}

$config = [ordered]@{
    version = 1
    enabled = $true
    endpoint = $Endpoint
    token = $Token
    sources = @("linkedin")
    interval_seconds = $IntervalSeconds
}
$config | ConvertTo-Json -Depth 5 | Set-Content -Path $configPath -Encoding UTF8

Write-Host ""
Write-Host "Prospect Desk sync configured."
Write-Host "Endpoint host: $($uri.Host)"
Write-Host "Sources: LinkedIn"
Write-Host "Retry interval: $IntervalSeconds seconds"
Write-Host "Token: stored locally and not printed"
Write-Host "Config: $configPath"
Write-Host "The running collector will detect this configuration within one minute."

try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:8775/health" -TimeoutSec 3
    if ($health.ready) {
        Write-Host "LinkedIn collector is healthy. Existing unsynced records will be queued automatically."
    }
} catch {
    Write-Warning "The LinkedIn collector is not currently reachable. Start Acquisition V4; sync will resume automatically."
}
