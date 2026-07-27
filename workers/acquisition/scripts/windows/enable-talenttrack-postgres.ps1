param(
    [string]$InstallRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..\..")).Path,
    [string]$StateRoot = (Join-Path $env:LOCALAPPDATA "Codistan\Acquisition"),
    [int]$Port = 55432
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "talenttrack-postgres-common.ps1")

if ($Port -lt 1024 -or $Port -gt 65535) { throw "Choose a local PostgreSQL port between 1024 and 65535." }
$context = Get-TalentTrackPostgresContext -InstallRoot $InstallRoot -StateRoot $StateRoot
Require-TalentTrackDocker $context
New-Item -ItemType Directory -Force -Path $context.ConfigRoot | Out-Null

if (-not (Test-Path $context.EnvPath)) {
    $password = New-TalentTrackRandomSecret -Length 48
    @(
        "TALENTTRACK_POSTGRES_USER=talenttrack"
        "TALENTTRACK_POSTGRES_PASSWORD=$password"
        "TALENTTRACK_POSTGRES_DB=talenttrack"
        "TALENTTRACK_POSTGRES_PORT=$Port"
    ) | Set-Content -Path $context.EnvPath -Encoding ASCII
    Protect-TalentTrackSecretFile -Path $context.EnvPath
}

$values = Read-TalentTrackPostgresEnv -Path $context.EnvPath
[ordered]@{
    version = 1
    enabled = $true
    backend = "postgresql"
    host = "127.0.0.1"
    port = [int]$values["TALENTTRACK_POSTGRES_PORT"]
    database = [string]$values["TALENTTRACK_POSTGRES_DB"]
    compose_project = $context.ProjectName
    secret_file = "config\local-postgres.env"
    json_shadow_enabled = $true
} | ConvertTo-Json -Depth 4 | Set-Content -Path $context.PublicConfigPath -Encoding UTF8

Write-Host "Starting the loopback-only TalentTrack PostgreSQL service..."
$null = Invoke-TalentTrackCompose -Context $context -Arguments @("up", "-d")
$ready = $false
for ($attempt = 0; $attempt -lt 30; $attempt++) {
    Start-Sleep -Seconds 2
    $code = Invoke-TalentTrackCompose -Context $context -Arguments @(
        "exec", "-T", "postgres", "pg_isready",
        "-U", [string]$values["TALENTTRACK_POSTGRES_USER"],
        "-d", [string]$values["TALENTTRACK_POSTGRES_DB"]
    ) -AllowFailure
    if ($code -eq 0) { $ready = $true; break }
}
if (-not $ready) { throw "TalentTrack PostgreSQL did not become ready. Existing JSON capture files were not deleted." }

Stop-TalentTrackRuntime -StateRoot $StateRoot
Start-TalentTrackRuntime -Context $context
$health = Wait-TalentTrackCollectorBackend -Backend "postgresql" -Attempts 45

Write-Host ""
Write-Host "TalentTrack local PostgreSQL is enabled and healthy."
Write-Host "Host: 127.0.0.1"
Write-Host "Port: $($values['TALENTTRACK_POSTGRES_PORT'])"
Write-Host "Database: $($values['TALENTTRACK_POSTGRES_DB'])"
Write-Host "Collectors using PostgreSQL: $($health.Count)/3"
Write-Host "Existing JSONL records were imported when the database was empty."
Write-Host "A JSON rollback shadow remains under $StateRoot."
Write-Host "The database password and connection URL are not shown."
