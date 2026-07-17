[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$failures = New-Object System.Collections.Generic.List[string]

function Write-Check([string]$Label, [bool]$Passed, [string]$Detail) {
  $status = if ($Passed) { 'PASS' } else { 'FAIL' }
  $color = if ($Passed) { 'Green' } else { 'Red' }
  Write-Host ("[{0}] {1}: {2}" -f $status, $Label, $Detail) -ForegroundColor $color
  if (-not $Passed) { $failures.Add("${Label}: ${Detail}") }
}

Write-Host 'Codistan local CI health check' -ForegroundColor Cyan
Write-Host ''

$runnerServices = @(Get-Service -Name 'actions.runner.*' -ErrorAction SilentlyContinue)
Write-Check 'GitHub runner service' ($runnerServices.Count -gt 0) $(if ($runnerServices.Count) { ($runnerServices | ForEach-Object { "$($_.Name)=$($_.Status)" }) -join ', ' } else { 'No actions.runner.* service found' })
if ($runnerServices.Count) {
  Write-Check 'GitHub runner running' (($runnerServices | Where-Object Status -eq 'Running').Count -gt 0) (($runnerServices | ForEach-Object { "$($_.Name)=$($_.Status)" }) -join ', ')
}

$databaseUrl = [Environment]::GetEnvironmentVariable('LOCAL_DATABASE_URL', 'Machine')
Write-Check 'LOCAL_DATABASE_URL' (-not [string]::IsNullOrWhiteSpace($databaseUrl)) $(if ($databaseUrl) { 'Machine variable is configured' } else { 'Machine variable is missing' })

$postgresServices = @(Get-Service -Name 'postgresql*' -ErrorAction SilentlyContinue)
Write-Check 'PostgreSQL service' ($postgresServices.Count -gt 0) $(if ($postgresServices.Count) { ($postgresServices | ForEach-Object { "$($_.Name)=$($_.Status)" }) -join ', ' } else { 'No PostgreSQL Windows service found' })
if ($postgresServices.Count) {
  Write-Check 'PostgreSQL running' (($postgresServices | Where-Object Status -eq 'Running').Count -gt 0) (($postgresServices | ForEach-Object { "$($_.Name)=$($_.Status)" }) -join ', ')
}

$psqlCommand = Get-Command psql.exe -ErrorAction SilentlyContinue
$psqlPath = if ($psqlCommand) { $psqlCommand.Source } else {
  Get-ChildItem 'C:\Program Files\PostgreSQL\*\bin\psql.exe' -ErrorAction SilentlyContinue |
    Sort-Object FullName -Descending |
    Select-Object -First 1 -ExpandProperty FullName
}
Write-Check 'psql.exe' (-not [string]::IsNullOrWhiteSpace($psqlPath) -and (Test-Path $psqlPath)) $(if ($psqlPath) { $psqlPath } else { 'Not found' })

if ($databaseUrl -and $psqlPath -and (Test-Path $psqlPath)) {
  Write-Host ''
  Write-Host 'Testing local database login...' -ForegroundColor Cyan
  & $psqlPath --dbname=$databaseUrl --set ON_ERROR_STOP=1 --command 'SELECT current_database(), current_user;' 2>&1 | ForEach-Object { Write-Host $_ }
  Write-Check 'Database connection' ($LASTEXITCODE -eq 0) $(if ($LASTEXITCODE -eq 0) { 'Connection succeeded' } else { "psql exited with code $LASTEXITCODE" })
}

$node = Get-Command node.exe -ErrorAction SilentlyContinue
Write-Check 'Node.js' ([bool]$node) $(if ($node) { (& $node.Source --version) } else { 'Node.js is not installed or not on PATH' })

$git = Get-Command git.exe -ErrorAction SilentlyContinue
Write-Check 'Git' ([bool]$git) $(if ($git) { (& $git.Source --version) } else { 'Git is not installed or not on PATH' })

Write-Host ''
if ($failures.Count -gt 0) {
  Write-Host "Local CI is not ready. $($failures.Count) check(s) failed." -ForegroundColor Red
  $failures | ForEach-Object { Write-Host " - $_" -ForegroundColor Red }
  exit 1
}

Write-Host 'Local CI machine is ready.' -ForegroundColor Green
exit 0
