param(
    [string]$InstallRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..\..")).Path,
    [string]$StateRoot = (Join-Path $env:LOCALAPPDATA "Codistan\Acquisition")
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "talenttrack-postgres-common.ps1")

$context = Get-TalentTrackPostgresContext -InstallRoot $InstallRoot -StateRoot $StateRoot
$values = Read-TalentTrackPostgresEnv -Path $context.EnvPath
Require-TalentTrackDocker $context

Write-Host "TalentTrack local PostgreSQL service:"
$null = Invoke-TalentTrackCompose -Context $context -Arguments @("ps", "postgres")
$readyCode = Invoke-TalentTrackCompose -Context $context -Arguments @(
    "exec", "-T", "postgres", "pg_isready",
    "-U", [string]$values["TALENTTRACK_POSTGRES_USER"],
    "-d", [string]$values["TALENTTRACK_POSTGRES_DB"]
) -AllowFailure
if ($readyCode -ne 0) { throw "TalentTrack PostgreSQL is not accepting connections." }

$health = @()
foreach ($port in @(8765, 8775, 8785)) {
    try {
        $item = Invoke-RestMethod -Uri "http://127.0.0.1:$port/health" -TimeoutSec 3
        $health += $item
        Write-Host ("Collector {0}: ready={1}, storage={2}, records={3}" -f $item.source, $item.ready, $item.storage_backend, $item.accepted)
    } catch {
        Write-Host "Collector on port $port: unavailable"
    }
}

$postgresCollectors = @($health | Where-Object { $_.ready -and $_.storage_backend -eq "postgresql" }).Count
Write-Host ""
Write-Host "PostgreSQL host: 127.0.0.1"
Write-Host "PostgreSQL port: $($values['TALENTTRACK_POSTGRES_PORT'])"
Write-Host "PostgreSQL database: $($values['TALENTTRACK_POSTGRES_DB'])"
Write-Host "Collectors using PostgreSQL: $postgresCollectors/3"
Write-Host "JSON rollback shadow: enabled"
Write-Host "No password or connection URL was displayed."
if ($postgresCollectors -ne 3) { throw "Not all TalentTrack collectors are using local PostgreSQL." }
