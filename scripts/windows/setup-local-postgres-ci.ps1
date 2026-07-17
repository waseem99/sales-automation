[CmdletBinding()]
param(
  [string]$DatabaseName = 'sales_automation_ci',
  [string]$DatabaseUser = 'sales_automation_ci',
  [string]$DatabasePassword,
  [string]$PostgresAdminUser = 'postgres',
  [int]$Port = 5432
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Write-Step([string]$Text) {
  Write-Host ''
  Write-Host "==> $Text" -ForegroundColor Cyan
}

function Assert-Administrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Run this PowerShell script as Administrator.'
  }
}

function Assert-Identifier([string]$Value, [string]$Label) {
  if ($Value -notmatch '^[A-Za-z_][A-Za-z0-9_]*$') {
    throw "$Label may contain only letters, numbers and underscores, and may not start with a number."
  }
}

function Find-Psql {
  $command = Get-Command psql.exe -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }
  return Get-ChildItem 'C:\Program Files\PostgreSQL\*\bin\psql.exe' -ErrorAction SilentlyContinue |
    Sort-Object FullName -Descending |
    Select-Object -First 1 -ExpandProperty FullName
}

function Convert-SecureStringToPlainText([Security.SecureString]$SecureValue) {
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureValue)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  }
}

function New-RandomPassword {
  $alphabet = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  $bytes = New-Object byte[] 28
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $rng.GetBytes($bytes)
  } finally {
    $rng.Dispose()
  }
  return -join ($bytes | ForEach-Object { $alphabet[$_ % $alphabet.Length] })
}

function Invoke-Psql(
  [string]$PsqlPath,
  [string]$AdminPassword,
  [string]$Database,
  [string]$Sql,
  [switch]$TuplesOnly
) {
  $previousPassword = $env:PGPASSWORD
  try {
    $env:PGPASSWORD = $AdminPassword
    $arguments = @(
      '--host=127.0.0.1',
      "--port=$Port",
      "--username=$PostgresAdminUser",
      "--dbname=$Database",
      '--set', 'ON_ERROR_STOP=1'
    )
    if ($TuplesOnly) { $arguments += @('--tuples-only', '--no-align') }
    $arguments += @('--command', $Sql)
    $output = & $PsqlPath @arguments 2>&1
    if ($LASTEXITCODE -ne 0) {
      throw ($output -join [Environment]::NewLine)
    }
    return $output
  } finally {
    $env:PGPASSWORD = $previousPassword
  }
}

Assert-Administrator
Assert-Identifier $DatabaseName 'DatabaseName'
Assert-Identifier $DatabaseUser 'DatabaseUser'
if ($Port -lt 1 -or $Port -gt 65535) { throw 'Port must be between 1 and 65535.' }

Write-Step 'Locating PostgreSQL'
$psqlPath = Find-Psql
if ([string]::IsNullOrWhiteSpace($psqlPath) -or -not (Test-Path $psqlPath)) {
  Start-Process 'https://www.postgresql.org/download/windows/'
  throw 'PostgreSQL was not found. Install PostgreSQL for Windows, then run this script again.'
}
Write-Host "Using: $psqlPath" -ForegroundColor Green

$postgresService = Get-Service -Name 'postgresql*' -ErrorAction SilentlyContinue |
  Sort-Object Name -Descending |
  Select-Object -First 1
if ($postgresService -and $postgresService.Status -ne 'Running') {
  Write-Step "Starting PostgreSQL service $($postgresService.Name)"
  Start-Service $postgresService.Name
  $postgresService.WaitForStatus('Running', [TimeSpan]::FromSeconds(30))
}

Write-Step 'Reading the local PostgreSQL administrator password'
$secureAdminPassword = Read-Host "Enter the password for PostgreSQL user '$PostgresAdminUser'" -AsSecureString
$adminPassword = Convert-SecureStringToPlainText $secureAdminPassword
if ([string]::IsNullOrWhiteSpace($adminPassword)) { throw 'The PostgreSQL administrator password is required.' }

if ([string]::IsNullOrWhiteSpace($DatabasePassword)) {
  $DatabasePassword = New-RandomPassword
}
$escapedPassword = $DatabasePassword.Replace("'", "''")

# DatabaseName and DatabaseUser have already passed Assert-Identifier, so they
# are safe to place directly into PostgreSQL identifier positions. PowerShell
# does not use backslash to escape quotes inside strings; avoiding unnecessary
# quoted identifiers prevents malformed SQL such as \"role\" from reaching psql.
Write-Step "Creating or updating role $DatabaseUser"
$roleExists = (Invoke-Psql $psqlPath $adminPassword 'postgres' "SELECT 1 FROM pg_roles WHERE rolname = '$DatabaseUser';" -TuplesOnly) -join ''
if ($roleExists.Trim() -eq '1') {
  Invoke-Psql $psqlPath $adminPassword 'postgres' "ALTER ROLE $DatabaseUser WITH LOGIN PASSWORD '$escapedPassword';" | Out-Null
} else {
  Invoke-Psql $psqlPath $adminPassword 'postgres' "CREATE ROLE $DatabaseUser WITH LOGIN PASSWORD '$escapedPassword';" | Out-Null
}

Write-Step "Creating or updating database $DatabaseName"
$databaseExists = (Invoke-Psql $psqlPath $adminPassword 'postgres' "SELECT 1 FROM pg_database WHERE datname = '$DatabaseName';" -TuplesOnly) -join ''
if ($databaseExists.Trim() -eq '1') {
  Invoke-Psql $psqlPath $adminPassword 'postgres' "ALTER DATABASE $DatabaseName OWNER TO $DatabaseUser;" | Out-Null
} else {
  Invoke-Psql $psqlPath $adminPassword 'postgres' "CREATE DATABASE $DatabaseName OWNER $DatabaseUser;" | Out-Null
}
Invoke-Psql $psqlPath $adminPassword $DatabaseName "ALTER SCHEMA public OWNER TO $DatabaseUser; GRANT ALL ON SCHEMA public TO $DatabaseUser;" | Out-Null

$connectionUrl = "postgresql://${DatabaseUser}:${DatabasePassword}@127.0.0.1:${Port}/${DatabaseName}?sslmode=disable"

Write-Step 'Storing the local CI connection for the runner service'
[Environment]::SetEnvironmentVariable('LOCAL_DATABASE_URL', $connectionUrl, 'Machine')
$programData = Join-Path $env:ProgramData 'Codistan\SalesAutomation'
New-Item -ItemType Directory -Force -Path $programData | Out-Null
$state = [ordered]@{
  schema_version = 'codistan-local-ci.v1'
  database_name = $DatabaseName
  database_user = $DatabaseUser
  host = '127.0.0.1'
  port = $Port
  environment_variable = 'LOCAL_DATABASE_URL'
  configured_at = (Get-Date).ToString('o')
}
$state | ConvertTo-Json | Set-Content -Path (Join-Path $programData 'local-ci.json') -Encoding UTF8

Write-Step 'Verifying the application database login'
$previousPassword = $env:PGPASSWORD
try {
  $env:PGPASSWORD = $DatabasePassword
  $verifyOutput = & $psqlPath --host=127.0.0.1 --port=$Port --username=$DatabaseUser --dbname=$DatabaseName --set ON_ERROR_STOP=1 --command 'SELECT current_database(), current_user;' 2>&1
  if ($LASTEXITCODE -ne 0) { throw ($verifyOutput -join [Environment]::NewLine) }
  $verifyOutput | ForEach-Object { Write-Host $_ }
} finally {
  $env:PGPASSWORD = $previousPassword
}

$runnerServices = Get-Service -Name 'actions.runner.*' -ErrorAction SilentlyContinue
if ($runnerServices) {
  Write-Step 'Restarting GitHub Actions runner service to load the machine environment'
  $runnerServices | Restart-Service -Force
}

Write-Host ''
Write-Host 'Local PostgreSQL CI database is ready.' -ForegroundColor Green
Write-Host "Database: $DatabaseName" -ForegroundColor Green
Write-Host "User: $DatabaseUser" -ForegroundColor Green
Write-Host 'Connection is stored in the machine-level LOCAL_DATABASE_URL variable.' -ForegroundColor Green
Write-Host 'The password was not written to the repository or the state JSON file.' -ForegroundColor Yellow
