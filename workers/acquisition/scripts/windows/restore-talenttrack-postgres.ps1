param(
    [string]$InstallRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..\..")).Path,
    [string]$StateRoot = (Join-Path $env:LOCALAPPDATA "Codistan\Acquisition"),
    [string]$BackupPath = ""
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "talenttrack-postgres-common.ps1")

$context = Get-TalentTrackPostgresContext -InstallRoot $InstallRoot -StateRoot $StateRoot
$values = Read-TalentTrackPostgresEnv -Path $context.EnvPath
Require-TalentTrackDocker $context

if (-not $BackupPath) {
    $latest = Get-ChildItem (Join-Path $StateRoot "backups") -Filter "talenttrack-postgres-*.dump" -File -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTimeUtc -Descending |
        Select-Object -First 1
    if ($latest) {
        Write-Host "Latest backup: $($latest.FullName)"
        $BackupPath = Read-Host "Enter a backup path, or press Enter to use the latest backup"
        if (-not $BackupPath) { $BackupPath = $latest.FullName }
    } else {
        $BackupPath = Read-Host "Enter the full path to a TalentTrack PostgreSQL .dump backup"
    }
}

$resolvedBackup = (Resolve-Path $BackupPath -ErrorAction Stop).Path
if ([System.IO.Path]::GetExtension($resolvedBackup) -ne ".dump") { throw "Only a TalentTrack PostgreSQL .dump backup may be restored." }
if ((Get-Item $resolvedBackup).Length -le 0) { throw "The selected backup is empty." }
$metadataPath = "$resolvedBackup.json"
if (Test-Path $metadataPath) {
    $metadata = Get-Content $metadataPath -Raw | ConvertFrom-Json
    $actualHash = (Get-FileHash -Path $resolvedBackup -Algorithm SHA256).Hash.ToLowerInvariant()
    $expectedHash = if ($metadata.sha256) { [string]$metadata.sha256 } else { "" }
    if (-not $expectedHash -or $expectedHash -ne $actualHash) { throw "The backup SHA-256 does not match its metadata." }
}

Write-Host ""
Write-Host "Restore source: $resolvedBackup"
Write-Host "This replaces the current local PostgreSQL database after creating a new safety backup."
Write-Host "Captured JSON rollback shadows are not deleted."
$confirmation = Read-Host "Type RESTORE TALENTTRACK to continue"
if ($confirmation -ne "RESTORE TALENTTRACK") { throw "Restore cancelled." }

$backupScript = Join-Path $PSScriptRoot "backup-talenttrack-postgres.ps1"
& $backupScript -InstallRoot $InstallRoot -StateRoot $StateRoot
$safetyBackup = Get-ChildItem (Join-Path $StateRoot "backups") -Filter "talenttrack-postgres-*.dump" -File |
    Sort-Object LastWriteTimeUtc -Descending |
    Select-Object -First 1
if (-not $safetyBackup) { throw "The pre-restore safety backup could not be verified." }

Stop-TalentTrackRuntime -StateRoot $StateRoot
$user = [string]$values["TALENTTRACK_POSTGRES_USER"]
$database = [string]$values["TALENTTRACK_POSTGRES_DB"]
$timestamp = (Get-Date).ToUniversalTime().ToString("yyyyMMdd-HHmmss")
$containerPath = "/tmp/talenttrack-restore-$timestamp.dump"
$dockerPath = [string]$context.DockerPath
$containerId = (& $dockerPath compose --project-name $context.ProjectName --env-file $context.EnvPath -f $context.ComposePath ps -q postgres | Select-Object -First 1)
$containerId = [string]$containerId
if (-not $containerId.Trim()) { throw "The TalentTrack PostgreSQL container could not be identified." }

try {
    & $dockerPath cp $resolvedBackup "${containerId}:$containerPath"
    if ($LASTEXITCODE -ne 0) { throw "The selected backup could not be copied into the local PostgreSQL container." }

    $null = Invoke-TalentTrackCompose -Context $context -Arguments @("exec", "-T", "postgres", "dropdb", "--if-exists", "--force", "-U", $user, $database)
    $null = Invoke-TalentTrackCompose -Context $context -Arguments @("exec", "-T", "postgres", "createdb", "-U", $user, $database)
    $null = Invoke-TalentTrackCompose -Context $context -Arguments @(
        "exec", "-T", "postgres", "pg_restore",
        "--exit-on-error",
        "--no-owner",
        "-U", $user,
        "-d", $database,
        $containerPath
    )
} catch {
    Write-Host "Restore failed. TalentTrack collectors remain stopped to avoid writing into a partial database."
    Write-Host "Pre-restore safety backup: $($safetyBackup.FullName)"
    throw
} finally {
    $null = Invoke-TalentTrackCompose -Context $context -Arguments @("exec", "-T", "postgres", "rm", "-f", $containerPath) -AllowFailure
}

Start-TalentTrackRuntime -Context $context
$health = Wait-TalentTrackCollectorBackend -Backend "postgresql" -Attempts 45

Write-Host ""
Write-Host "TalentTrack PostgreSQL restore completed."
Write-Host "Restored backup: $resolvedBackup"
Write-Host "Collectors using PostgreSQL: $($health.Count)/3"
Write-Host "The JSON rollback shadow was refreshed from the restored database during collector startup."
