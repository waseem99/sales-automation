param(
    [string]$StateRoot = (Join-Path $env:LOCALAPPDATA "Codistan\Acquisition")
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$chromeCandidates = @(
    (Join-Path $env:ProgramFiles "Google\Chrome\Application\chrome.exe"),
    (if (${env:ProgramFiles(x86)}) { Join-Path ${env:ProgramFiles(x86)} "Google\Chrome\Application\chrome.exe" } else { $null }),
    (Join-Path $env:LOCALAPPDATA "Google\Chrome\Application\chrome.exe")
)
$chrome = $chromeCandidates | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
if (-not $chrome) { throw "Google Chrome was not found." }

$expectedPath = [System.IO.Path]::GetFullPath((Join-Path $StateRoot "extensions\linkedin")).TrimEnd("\")
$userDataRoot = Join-Path $env:LOCALAPPDATA "Google\Chrome\User Data"
$extensionId = ""
$profileName = ""

if (Test-Path -LiteralPath $userDataRoot) {
    $profiles = @(Get-ChildItem -LiteralPath $userDataRoot -Directory -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -eq "Default" -or $_.Name -like "Profile *" })
    foreach ($profile in $profiles) {
        foreach ($preferenceName in @("Preferences", "Secure Preferences")) {
            $preferencePath = Join-Path $profile.FullName $preferenceName
            if (-not (Test-Path -LiteralPath $preferencePath)) { continue }
            try {
                $preferences = Get-Content -LiteralPath $preferencePath -Raw | ConvertFrom-Json
                $settings = $preferences.extensions.settings
                if (-not $settings) { continue }
                foreach ($property in $settings.PSObject.Properties) {
                    $setting = $property.Value
                    $storedPath = [string]$setting.path
                    $manifestName = [string]$setting.manifest.name
                    $normalizedStoredPath = ""
                    if ($storedPath) {
                        try { $normalizedStoredPath = [System.IO.Path]::GetFullPath($storedPath).TrimEnd("\") } catch {}
                    }
                    if ($normalizedStoredPath -eq $expectedPath -or $manifestName -eq "Codistan LinkedIn & Sales Navigator Capture") {
                        $extensionId = [string]$property.Name
                        $profileName = $profile.Name
                        break
                    }
                }
            } catch {
                continue
            }
            if ($extensionId) { break }
        }
        if ($extensionId) { break }
    }
}

if ($extensionId) {
    $arguments = @()
    if ($profileName -and $profileName -ne "Default") {
        $arguments += "--profile-directory=$profileName"
    }
    $arguments += "--new-window"
    $arguments += "chrome-extension://$extensionId/sales-nav-options.html"
    Start-Process -FilePath $chrome -ArgumentList $arguments | Out-Null
    Write-Host "Opened Sales Navigator campaign settings."
    Write-Host "Register licensed lead-search URLs, run a manual campaign, and keep the no-confirmed-intent warning."
    exit 0
}

Start-Process -FilePath $chrome -ArgumentList @("--new-window", "chrome://extensions/") | Out-Null
throw "The Codistan LinkedIn extension ID could not be located. Confirm the unpacked extension is loaded, then rerun this shortcut."
