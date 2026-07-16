[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Write-Step([string]$Message) {
    Write-Host ""
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Resolve-SavedProfile {
    param(
        [Parameter(Mandatory = $true)][string]$StateRoot,
        [Parameter(Mandatory = $true)][string]$ProfileRoot,
        [Parameter(Mandatory = $true)][string[]]$CandidateFolders,
        [Parameter(Mandatory = $true)][string[]]$CandidateMarkers,
        [Parameter(Mandatory = $true)][string[]]$FolderPatterns,
        [Parameter(Mandatory = $true)][string]$DisplayName
    )

    foreach ($markerName in $CandidateMarkers) {
        $markerPath = Join-Path $StateRoot $markerName
        if (-not (Test-Path $markerPath)) {
            continue
        }

        try {
            $marker = Get-Content -Raw -Path $markerPath | ConvertFrom-Json
            if ($marker.profile_folder) {
                $markedProfile = Join-Path $ProfileRoot ([string]$marker.profile_folder)
                if (Test-Path $markedProfile) {
                    return $markedProfile
                }
            }
        } catch {
            Write-Host "Ignoring an unreadable $DisplayName connection marker: $markerName" -ForegroundColor Yellow
        }
    }

    foreach ($folderName in $CandidateFolders) {
        $candidate = Join-Path $ProfileRoot $folderName
        if (Test-Path $candidate) {
            return $candidate
        }
    }

    if (Test-Path $ProfileRoot) {
        $matchedFolders = @(
            Get-ChildItem -Path $ProfileRoot -Directory -ErrorAction SilentlyContinue |
                Where-Object {
                    $name = $_.Name.ToLowerInvariant()
                    foreach ($pattern in $FolderPatterns) {
                        if ($name -like $pattern.ToLowerInvariant()) {
                            return $true
                        }
                    }
                    return $false
                } |
                Sort-Object LastWriteTime -Descending
        )
        if ($matchedFolders.Count -gt 0) {
            Write-Host "Using discovered $DisplayName profile folder: $($matchedFolders[0].Name)" -ForegroundColor Green
            return $matchedFolders[0].FullName
        }
    }

    $availableFolders = @()
    if (Test-Path $ProfileRoot) {
        $availableFolders = @(Get-ChildItem -Path $ProfileRoot -Directory -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name)
    }
    $folderText = if ($availableFolders.Count -gt 0) { $availableFolders -join ", " } else { "none" }
    throw "The saved $DisplayName profile was not found. Available local profile folders: $folderText. Do not log in again yet; share this exact error in the project chat."
}

$WorkerRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$RepositoryRoot = (Resolve-Path (Join-Path $WorkerRoot "..\..")).Path
$SetupScript = Join-Path $PSScriptRoot "setup-worker.ps1"
$VenvPython = Join-Path $WorkerRoot ".venv\Scripts\python.exe"
$StateRoot = Join-Path $env:LOCALAPPDATA "Codistan\Acquisition"
$ProfileRoot = Join-Path $StateRoot "profiles"
$OutputRoot = Join-Path $StateRoot "output"
$UpworkResult = Join-Path $OutputRoot "upwork-session-check.json"
$LinkedInResult = Join-Path $OutputRoot "linkedin-session-check.json"
$CombinedResult = Join-Path $OutputRoot "account-session-validation.json"

if (-not (Test-Path $VenvPython)) {
    Write-Step "The worker is not installed yet; running setup first"
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $SetupScript
    if ($LASTEXITCODE -ne 0) {
        throw "Worker setup failed."
    }
}

$UpworkProfile = Resolve-SavedProfile `
    -StateRoot $StateRoot `
    -ProfileRoot $ProfileRoot `
    -CandidateFolders @("upwork-browser-v2", "upwork") `
    -CandidateMarkers @("upwork-browser-v2.connected.json", "upwork.connected.json") `
    -FolderPatterns @("upwork*") `
    -DisplayName "Upwork"

$LinkedInProfile = Resolve-SavedProfile `
    -StateRoot $StateRoot `
    -ProfileRoot $ProfileRoot `
    -CandidateFolders @("linkedin-sales-navigator-browser-v2", "linkedin-sales-navigator", "linkedin", "linkedin-sales") `
    -CandidateMarkers @("linkedin-sales-navigator-browser-v2.connected.json", "linkedin-sales-navigator.connected.json", "linkedin.connected.json", "linkedin-sales.connected.json") `
    -FolderPatterns @("linkedin*") `
    -DisplayName "LinkedIn"

New-Item -ItemType Directory -Force -Path $OutputRoot | Out-Null

Write-Step "Preparing account session validation"
Write-Host "Close the dedicated Upwork and LinkedIn browser windows before continuing." -ForegroundColor Yellow
Write-Host "Your ordinary browser windows may remain open if they do not use these dedicated profiles."
Write-Host ""
Read-Host "Press Enter when the dedicated account windows are closed"

Push-Location $WorkerRoot
try {
    Write-Step "Validating the saved Upwork session"
    & $VenvPython -m acquisition session-check `
        --profile $UpworkProfile `
        --account upwork `
        --repository-root $RepositoryRoot `
        --output $UpworkResult
    $UpworkExit = $LASTEXITCODE

    Write-Step "Validating the saved LinkedIn Sales Navigator session"
    & $VenvPython -m acquisition session-check `
        --profile $LinkedInProfile `
        --account linkedin `
        --repository-root $RepositoryRoot `
        --output $LinkedInResult
    $LinkedInExit = $LASTEXITCODE
} finally {
    Pop-Location
}

$Upwork = Get-Content -Raw -Path $UpworkResult | ConvertFrom-Json
$LinkedIn = Get-Content -Raw -Path $LinkedInResult | ConvertFrom-Json
$Combined = [ordered]@{
    schema_version = "codistan-account-session-validation.v1"
    checked_at = (Get-Date).ToString("o")
    upwork = $Upwork
    linkedin = $LinkedIn
    ready_for_upwork_pilot = [bool]($Upwork.authenticated -and $LinkedIn.authenticated)
    privacy = "Only domain, path, boolean state and known navigation-marker names are recorded. No page content or credentials are captured."
}
$Combined | ConvertTo-Json -Depth 6 | Set-Content -Path $CombinedResult -Encoding UTF8

Write-Step "Validation result"
if ($UpworkExit -eq 0 -and $LinkedInExit -eq 0) {
    Write-Host "UPWORK SESSION: PASSED" -ForegroundColor Green
    Write-Host "LINKEDIN SESSION: PASSED" -ForegroundColor Green
    Write-Host "READY FOR UPWORK DRY-RUN PILOT" -ForegroundColor Green
    Write-Host ""
    Write-Host "Result file: $CombinedResult"
    exit 0
}

Write-Host "UPWORK SESSION: $(if ($UpworkExit -eq 0) { 'PASSED' } else { 'NEEDS ATTENTION' })"
Write-Host "LINKEDIN SESSION: $(if ($LinkedInExit -eq 0) { 'PASSED' } else { 'NEEDS ATTENTION' })"
Write-Host ""
Write-Host "The result file contains only sanitized diagnostics:" -ForegroundColor Yellow
Write-Host $CombinedResult
throw "One or more account sessions could not be confirmed."
