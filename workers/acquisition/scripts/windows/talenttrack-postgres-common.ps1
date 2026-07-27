Set-StrictMode -Version 2.0

function Get-TalentTrackPostgresContext {
    param(
        [string]$InstallRoot,
        [string]$StateRoot
    )

    $packageRoot = Join-Path $InstallRoot "workers\acquisition"
    $composePath = Join-Path $packageRoot "local-postgres\docker-compose.yml"
    $configRoot = Join-Path $StateRoot "config"
    $envPath = Join-Path $configRoot "local-postgres.env"
    $publicConfigPath = Join-Path $configRoot "local-postgres.json"
    $docker = Get-Command docker.exe -ErrorAction SilentlyContinue
    if (-not $docker) { $docker = Get-Command docker -ErrorAction SilentlyContinue }

    return [pscustomobject]@{
        InstallRoot = $InstallRoot
        StateRoot = $StateRoot
        PackageRoot = $packageRoot
        ComposePath = $composePath
        ConfigRoot = $configRoot
        EnvPath = $envPath
        PublicConfigPath = $publicConfigPath
        DockerPath = if ($docker) { $docker.Source } else { $null }
        ProjectName = "codistan-talenttrack"
    }
}

function Read-TalentTrackPostgresEnv {
    param([string]$Path)

    if (-not (Test-Path $Path)) { throw "TalentTrack local PostgreSQL is not enabled." }
    $values = @{}
    foreach ($line in Get-Content -Path $Path -ErrorAction Stop) {
        $trimmed = [string]$line
        if (-not $trimmed.Trim() -or $trimmed.TrimStart().StartsWith("#")) { continue }
        if ($trimmed -notmatch '^([A-Z0-9_]+)=(.*)$') { throw "The TalentTrack PostgreSQL configuration is invalid." }
        $values[$matches[1]] = $matches[2]
    }
    foreach ($name in @("TALENTTRACK_POSTGRES_USER", "TALENTTRACK_POSTGRES_PASSWORD", "TALENTTRACK_POSTGRES_DB", "TALENTTRACK_POSTGRES_PORT")) {
        $configuredValue = if ($values.ContainsKey($name)) { [string]$values[$name] } else { "" }
        if (-not $configuredValue) { throw "The TalentTrack PostgreSQL configuration is incomplete." }
    }
    foreach ($name in @("TALENTTRACK_POSTGRES_USER", "TALENTTRACK_POSTGRES_DB")) {
        $configuredValue = [string]$values[$name]
        if ($configuredValue -notmatch '^[A-Za-z][A-Za-z0-9_]{0,62}$') { throw "The TalentTrack PostgreSQL user or database name is invalid." }
    }
    $configuredPassword = [string]$values["TALENTTRACK_POSTGRES_PASSWORD"]
    if ($configuredPassword -notmatch '^[A-Za-z0-9]{32,128}$') { throw "The TalentTrack PostgreSQL password configuration is invalid." }
    $configuredPort = [string]$values["TALENTTRACK_POSTGRES_PORT"]
    if ($configuredPort -notmatch '^\d{2,5}$') { throw "The TalentTrack PostgreSQL port is invalid." }
    $port = [int]$configuredPort
    if ($port -lt 1024 -or $port -gt 65535) { throw "The TalentTrack PostgreSQL port is outside the supported range." }
    return $values
}

function New-TalentTrackRandomSecret {
    param([int]$Length = 40)

    $alphabet = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    $bytes = New-Object byte[] $Length
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $rng.GetBytes($bytes)
    } finally {
        $rng.Dispose()
    }
    $characters = foreach ($byte in $bytes) { $alphabet[$byte % $alphabet.Length] }
    return -join $characters
}

function Protect-TalentTrackSecretFile {
    param([string]$Path)

    $icacls = Get-Command icacls.exe -ErrorAction SilentlyContinue
    if (-not $icacls) { throw "Windows ACL tooling is unavailable; the PostgreSQL secret file was not accepted." }
    $principal = if ($env:USERDOMAIN) { "$env:USERDOMAIN\$env:USERNAME" } else { $env:USERNAME }
    $icaclsPath = [string]$icacls.Source
    & $icaclsPath $Path /inheritance:r /grant:r "${principal}:(F)" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "The PostgreSQL secret file could not be restricted to the current Windows user." }
}

function Require-TalentTrackDocker {
    param($Context)

    $dockerPath = [string]$Context.DockerPath
    if (-not $dockerPath) { throw "Docker Desktop with Docker Compose is required for local PostgreSQL." }
    & $dockerPath compose version | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Docker Compose is unavailable. Start or update Docker Desktop and retry." }
    if (-not (Test-Path $Context.ComposePath)) { throw "The TalentTrack PostgreSQL Compose file is missing." }
}

function Invoke-TalentTrackCompose {
    param(
        $Context,
        [string[]]$Arguments,
        [switch]$AllowFailure
    )

    Require-TalentTrackDocker $Context
    $dockerPath = [string]$Context.DockerPath
    $output = & $dockerPath compose --project-name $Context.ProjectName --env-file $Context.EnvPath -f $Context.ComposePath @Arguments 2>&1
    $code = $LASTEXITCODE
    foreach ($line in $output) { Write-Host ([string]$line) }
    if ($code -ne 0 -and -not $AllowFailure) { throw "The TalentTrack PostgreSQL Docker command failed with exit code $code." }
    return [int]$code
}

function Get-TalentTrackLocalDatabaseUrl {
    param([hashtable]$Values)

    $configuredUser = [string]$Values["TALENTTRACK_POSTGRES_USER"]
    $configuredPassword = [string]$Values["TALENTTRACK_POSTGRES_PASSWORD"]
    $configuredDatabase = [string]$Values["TALENTTRACK_POSTGRES_DB"]
    $configuredPort = [string]$Values["TALENTTRACK_POSTGRES_PORT"]
    $user = [uri]::EscapeDataString($configuredUser)
    $password = [uri]::EscapeDataString($configuredPassword)
    $database = [uri]::EscapeDataString($configuredDatabase)
    return "postgresql://${user}:${password}@127.0.0.1:${configuredPort}/${database}"
}

function Stop-TalentTrackRuntime {
    param([string]$StateRoot)

    foreach ($pidName in @("watchdog.pid", "runtime.pid")) {
        $pidPath = Join-Path $StateRoot $pidName
        if (-not (Test-Path $pidPath)) { continue }
        $processId = 0
        [void][int]::TryParse((Get-Content $pidPath -Raw).Trim(), [ref]$processId)
        if ($processId -gt 0) { Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue }
        Remove-Item $pidPath -Force -ErrorAction SilentlyContinue
    }
    Get-NetTCPConnection -State Listen -LocalPort 8765,8775,8785 -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty OwningProcess -Unique |
        ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }
    Start-Sleep -Seconds 2
}

function Start-TalentTrackRuntime {
    param($Context)

    $command = Join-Path $Context.PackageRoot "START-TALENTTRACK.cmd"
    if (-not (Test-Path $command)) { throw "The TalentTrack start command is missing." }
    Start-Process -FilePath $command -WindowStyle Minimized
}

function Wait-TalentTrackCollectorBackend {
    param(
        [string]$Backend,
        [int]$Attempts = 30
    )

    foreach ($attempt in 1..$Attempts) {
        Start-Sleep -Seconds 1
        try {
            $health = @(
                Invoke-RestMethod -Uri "http://127.0.0.1:8765/health" -TimeoutSec 2
                Invoke-RestMethod -Uri "http://127.0.0.1:8775/health" -TimeoutSec 2
                Invoke-RestMethod -Uri "http://127.0.0.1:8785/health" -TimeoutSec 2
            )
            if (($health | Where-Object { -not $_.ready -or $_.storage_backend -ne $Backend }).Count -eq 0) { return $health }
        } catch {}
    }
    throw "TalentTrack collectors did not become healthy on the expected $Backend storage backend."
}
