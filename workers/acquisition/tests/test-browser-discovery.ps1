$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$packageRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$browserScript = Join-Path $packageRoot "scripts\windows\chromium-browser.ps1"
if (-not (Test-Path -LiteralPath $browserScript)) {
    throw "Chromium browser discovery script was not found."
}

$content = Get-Content -LiteralPath $browserScript -Raw
if ($content -match '(?<!\$)\(\s*if\s*\(') {
    throw "Browser discovery contains a parenthesized if-command that is incompatible with Windows PowerShell 5.1."
}

. $browserScript

$candidates = @(Get-CodistanBrowserCandidates)
if ($candidates.Count -eq 0) {
    throw "No supported Chromium browser was discovered on the Windows runner."
}

$chrome = $candidates | Where-Object { [string]$_.Id -eq "chrome" } | Select-Object -First 1
if (-not $chrome) {
    throw "Google Chrome was not discovered on the Windows runner."
}

$chromeUserData = Join-Path $env:LOCALAPPDATA "Google\Chrome\User Data"
$profilePath = Join-Path $chromeUserData "Profile 1"
$profilePreferences = Join-Path $profilePath "Preferences"
$createdProfile = $false
$createdPreferences = $false
$stateRoot = Join-Path $env:RUNNER_TEMP "Codistan-Browser-Profile-Test"

try {
    if (-not (Test-Path -LiteralPath $profilePath)) {
        New-Item -ItemType Directory -Force -Path $profilePath | Out-Null
        $createdProfile = $true
    }
    if (-not (Test-Path -LiteralPath $profilePreferences)) {
        "{}" | Set-Content -LiteralPath $profilePreferences -Encoding UTF8
        $createdPreferences = $true
    }

    $browser = Get-CodistanChromiumBrowser `
        -PreferredBrowserId "chrome" `
        -PreferredProfileName "Profile 1"

    if ([string]$browser.Id -ne "chrome") {
        throw "Explicit browser selection did not return Google Chrome."
    }
    if ([string]$browser.ProfileName -ne "Profile 1") {
        throw "Explicit browser selection did not retain Profile 1."
    }
    if ([string]$browser.BrowserArgument -ne "--profile-directory=Profile 1") {
        throw "Explicit browser selection did not produce the Profile 1 launch argument."
    }
    if (-not (Test-Path -LiteralPath ([string]$browser.Executable))) {
        throw "Selected Chrome executable is unavailable."
    }

    New-Item -ItemType Directory -Force -Path (Join-Path $stateRoot "config") | Out-Null
    [ordered]@{
        confirmed = $true
        browser_id = "chrome"
        browser_executable = [string]$browser.Executable
        browser_profile = "Profile 1"
        external_actions_enabled = $false
    } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $stateRoot "config\browser-extensions-confirmed.json") -Encoding UTF8

    $configured = Get-CodistanChromiumBrowser -StateRoot $stateRoot
    if ([string]$configured.Id -ne "chrome" -or [string]$configured.ProfileName -ne "Profile 1") {
        throw "Stored browser/profile configuration was not restored."
    }
    if ([string]$configured.BrowserArgument -ne "--profile-directory=Profile 1") {
        throw "Stored Chrome Profile 1 argument was not restored."
    }

    Write-Host "Windows PowerShell browser/profile discovery passed: Google Chrome / Profile 1"
    Write-Host "Executable: $($configured.Executable)"
    Write-Host "Argument: $($configured.BrowserArgument)"
} finally {
    Remove-Item -LiteralPath $stateRoot -Recurse -Force -ErrorAction SilentlyContinue
    if ($createdProfile) {
        Remove-Item -LiteralPath $profilePath -Recurse -Force -ErrorAction SilentlyContinue
    } elseif ($createdPreferences) {
        Remove-Item -LiteralPath $profilePreferences -Force -ErrorAction SilentlyContinue
    }
}
