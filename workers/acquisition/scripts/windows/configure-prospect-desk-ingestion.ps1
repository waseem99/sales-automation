[CmdletBinding()]
param(
    [string]$Endpoint,
    [switch]$GenerateToken
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

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

function New-HighEntropyToken {
    $Bytes = New-Object byte[] 48
    [Security.Cryptography.RandomNumberGenerator]::Fill($Bytes)
    return [Convert]::ToBase64String($Bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

$StateRoot = Join-Path $env:LOCALAPPDATA "Codistan\Acquisition"
$SecretsRoot = Join-Path $StateRoot "secrets"
$SecretsPath = Join-Path $SecretsRoot "prospect-desk.json"
New-Item -ItemType Directory -Force -Path $SecretsRoot | Out-Null

if (-not $Endpoint) {
    $Endpoint = (Read-Host "Paste the production Prospect Desk acquisition endpoint, for example https://YOUR-DOMAIN/api/acquisition-ingest").Trim()
}
if (-not $Endpoint.StartsWith("https://")) {
    throw "The Prospect Desk endpoint must use HTTPS."
}
try {
    $EndpointUri = [Uri]$Endpoint
} catch {
    throw "The Prospect Desk endpoint is not a valid URL."
}
if ($EndpointUri.AbsolutePath.TrimEnd('/') -ne "/api/acquisition-ingest") {
    throw "The endpoint path must be /api/acquisition-ingest."
}

$PlainToken = $null
$TokenSecure = $null
if ($GenerateToken) {
    $PlainToken = New-HighEntropyToken
    $TokenSecure = ConvertTo-SecureString $PlainToken -AsPlainText -Force
} else {
    $Choice = (Read-Host "Type G to generate a new high-entropy token, or press Enter to enter the token already configured in Vercel").Trim().ToLowerInvariant()
    if ($Choice -eq "g") {
        $PlainToken = New-HighEntropyToken
        $TokenSecure = ConvertTo-SecureString $PlainToken -AsPlainText -Force
    } else {
        $TokenSecure = Read-Host "Paste the ACQUISITION_INGEST_TOKEN configured in Vercel" -AsSecureString
        $PlainCheck = Convert-SecureStringToPlain $TokenSecure
        if (-not $PlainCheck) {
            throw "An ingestion token was not provided."
        }
        $PlainCheck = $null
    }
}

$SecretPayload = [ordered]@{
    schema_version = "codistan-prospect-desk-secret.v1"
    endpoint = $Endpoint.TrimEnd('/')
    encrypted_token = (ConvertFrom-SecureString $TokenSecure)
    created_at = (Get-Date).ToString("o")
    protection = "Windows DPAPI current user"
}
$SecretPayload | ConvertTo-Json -Depth 3 | Set-Content -Path $SecretsPath -Encoding UTF8

Write-Host "Prospect Desk ingestion was configured locally." -ForegroundColor Green
Write-Host "Encrypted file: $SecretsPath" -ForegroundColor Green
Write-Host ""
if ($PlainToken) {
    Write-Host "NEW TOKEN - COPY THIS NOW" -ForegroundColor Yellow
    Write-Host "Set the following exact value as ACQUISITION_INGEST_TOKEN in the production Vercel project:" -ForegroundColor Yellow
    Write-Host ""
    Write-Host $PlainToken -ForegroundColor Cyan
    Write-Host ""
    try {
        Set-Clipboard -Value $PlainToken
        Write-Host "The token was also copied to the Windows clipboard." -ForegroundColor Green
    } catch {
        Write-Host "Clipboard copy was unavailable; copy the token from this window." -ForegroundColor Yellow
    }
    Write-Host "This plaintext token is not written to disk and will not be displayed again." -ForegroundColor Yellow
}
Write-Host ""
Write-Host "The scheduled worker will use this configuration on its next run." -ForegroundColor Green
$PlainToken = $null
$TokenSecure = $null
