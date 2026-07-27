param(
    [string]$InstallRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..\..")).Path,
    [string]$StateRoot = (Join-Path $env:LOCALAPPDATA "Codistan\Acquisition")
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "talenttrack-postgres-common.ps1")

$context = Get-TalentTrackPostgresContext -InstallRoot $InstallRoot -StateRoot $StateRoot
$values = Read-TalentTrackPostgresEnv -Path $context.EnvPath
Require-TalentTrackDocker $context

$timestamp = (Get-Date).ToUniversalTime().ToString("yyyyMMdd-HHmmss")
$backupRoot = Join-Path $StateRoot "backups"
New-Item -ItemType Directory -Force -Path $backupRoot | Out-Null
$backupPath = Join-Path $backupRoot "talenttrack-postgres-$timestamp.dump"
$metadataPath = "$backupPath.json"
$containerPath = "/tmp/talenttrack-postgres-$timestamp.dump"
$user = [string]$values["TALENTTRACK_POSTGRES_USER"]
$database = [string]$values["TALENTTRACK_POSTGRES_DB"]

$readyCode = Invoke-TalentTrackCompose -Context $context -Arguments @("exec", "-T", "postgres", "pg_isready", "-U", $user, "-d", $database) -AllowFailure
if ($readyCode -ne 0) { throw "TalentTrack PostgreSQL is not ready for backup." }

try {
    $null = Invoke-TalentTrackCompose -Context $context -Arguments @(
        "exec", "-T", "postgres", "pg_dump",
        "-U", $user,
        "-d", $database,
        "--format=custom",
        "--no-owner",
        "--file=$containerPath"
    )

    $containerId = (& $context.DockerPath compose --project-name $context.ProjectName --env-file $context.EnvPath -f $context.ComposePath ps -q postgres | Select-Object -First 1)
    $containerId = [string]$containerId
    if (-not $containerId.Trim()) { throw "The TalentTrack PostgreSQL container could not be identified." }
    & $context.DockerPath cp "${containerId}:$containerPath" $backupPath
    if ($LASTEXITCODE -ne 0) { throw "The PostgreSQL backup could not be copied from the local container." }
} finally {
    $null = Invoke-TalentTrackCompose -Context $context -Arguments @("exec", "-T", "postgres", "rm", "-f", $containerPath) -AllowFailure
}

if (-not (Test-Path $backupPath) -or (Get-Item $backupPath).Length -le 0) { throw "The PostgreSQL backup file is empty or missing." }
Protect-TalentTrackSecretFile -Path $backupPath
$hash = (Get-FileHash -Path $backupPath -Algorithm SHA256).Hash.ToLowerInvariant()
[ordered]@{
    version = 1
    created_at = (Get-Date).ToUniversalTime().ToString("o")
    database = $database
    format = "postgresql-custom"
    sha256 = $hash
    bytes = (Get-Item $backupPath).Length
    json_shadow_enabled = $true
} | ConvertTo-Json -Depth 4 | Set-Content -Path $metadataPath -Encoding UTF8
Protect-TalentTrackSecretFile -Path $metadataPath

Write-Host ""
Write-Host "TalentTrack PostgreSQL backup completed."
Write-Host "Backup: $backupPath"
Write-Host "SHA-256: $hash"
Write-Host "The backup is restricted to the current Windows user."
Write-Host "The database password and connection URL were not written to the backup metadata."
