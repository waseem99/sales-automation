[CmdletBinding()]
param(
  [string]$RepositoryUrl = 'https://github.com/waseem99/sales-automation',
  [string]$RunnerName = 'Codistan-PC',
  [string]$RunnerLabels = 'codistan-local',
  [string]$RunnerDirectory = 'C:\actions-runner',
  [switch]$ForceReconfigure
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

function Convert-SecureStringToPlainText([Security.SecureString]$SecureValue) {
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureValue)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  }
}

Assert-Administrator
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$existingConfiguration = Join-Path $RunnerDirectory '.runner'
if (Test-Path $existingConfiguration) {
  if (-not $ForceReconfigure) {
    $services = Get-Service -Name 'actions.runner.*' -ErrorAction SilentlyContinue
    if ($services) {
      $services | Where-Object Status -ne 'Running' | Start-Service
      Write-Host "A GitHub runner is already configured in $RunnerDirectory." -ForegroundColor Green
      $services | Format-Table Name, Status, StartType -AutoSize
      Write-Host 'Use -ForceReconfigure only after removing the old runner from GitHub.' -ForegroundColor Yellow
      exit 0
    }
    throw "A runner configuration exists in $RunnerDirectory but no runner service was found. Remove or repair the existing runner before reconfiguring."
  }
  throw 'Force reconfiguration requires removing the existing runner through config.cmd remove with a fresh removal token. This script will not overwrite runner identity files.'
}

Write-Step 'Obtaining the latest official GitHub Actions runner release'
$releaseHeaders = @{ 'User-Agent' = 'Codistan-Local-CI-Installer' }
$release = Invoke-RestMethod -Uri 'https://api.github.com/repos/actions/runner/releases/latest' -Headers $releaseHeaders
$asset = $release.assets |
  Where-Object { $_.name -match '^actions-runner-win-x64-.*\.zip$' } |
  Select-Object -First 1
if (-not $asset) { throw 'The Windows x64 GitHub Actions runner package was not found in the latest release.' }

Write-Step "Downloading $($asset.name)"
New-Item -ItemType Directory -Force -Path $RunnerDirectory | Out-Null
$tempZip = Join-Path $env:TEMP $asset.name
Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $tempZip -Headers $releaseHeaders
Expand-Archive -Path $tempZip -DestinationPath $RunnerDirectory -Force
Remove-Item $tempZip -Force -ErrorAction SilentlyContinue

Write-Host ''
Write-Host 'Open this GitHub page in your browser:' -ForegroundColor Yellow
Write-Host 'Repository Settings -> Actions -> Runners -> New self-hosted runner -> Windows -> x64' -ForegroundColor Yellow
Write-Host 'Copy only the temporary registration token shown in the config command.' -ForegroundColor Yellow
$secureToken = Read-Host 'Paste the temporary runner registration token' -AsSecureString
$registrationToken = Convert-SecureStringToPlainText $secureToken
if ([string]::IsNullOrWhiteSpace($registrationToken)) { throw 'A GitHub runner registration token is required.' }

Write-Step 'Registering the Windows runner as a service'
$configCommand = Join-Path $RunnerDirectory 'config.cmd'
if (-not (Test-Path $configCommand)) { throw 'config.cmd was not found after extracting the runner package.' }

Push-Location $RunnerDirectory
try {
  & $configCommand `
    --unattended `
    --url $RepositoryUrl `
    --token $registrationToken `
    --name $RunnerName `
    --labels $RunnerLabels `
    --work '_work' `
    --replace `
    --runasservice
  if ($LASTEXITCODE -ne 0) { throw "GitHub runner configuration exited with code $LASTEXITCODE." }
} finally {
  $registrationToken = $null
  Pop-Location
}

$serviceNameFile = Join-Path $RunnerDirectory '.service'
$serviceName = if (Test-Path $serviceNameFile) { (Get-Content $serviceNameFile -Raw).Trim() } else { $null }
$service = if ($serviceName) { Get-Service -Name $serviceName -ErrorAction SilentlyContinue } else {
  Get-Service -Name 'actions.runner.*' -ErrorAction SilentlyContinue | Select-Object -First 1
}
if (-not $service) { throw 'The runner was registered, but its Windows service could not be found.' }
if ($service.Status -ne 'Running') { Start-Service $service.Name }
Set-Service -Name $service.Name -StartupType Automatic

Write-Host ''
Write-Host 'GitHub Actions runner is installed.' -ForegroundColor Green
Write-Host "Runner name: $RunnerName" -ForegroundColor Green
Write-Host "Custom label: $RunnerLabels" -ForegroundColor Green
Write-Host "Service: $($service.Name)" -ForegroundColor Green
Write-Host "Status: $((Get-Service $service.Name).Status)" -ForegroundColor Green
Write-Host 'Return to GitHub Settings -> Actions -> Runners and confirm Codistan-PC shows Idle.' -ForegroundColor Yellow
