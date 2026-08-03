param(
    [string]$StateRoot = (Join-Path $env:LOCALAPPDATA "Codistan\Acquisition")
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$browserBootstrap = Join-Path $PSScriptRoot "chromium-browser.ps1"
if (-not (Test-Path -LiteralPath $browserBootstrap)) { throw "The browser discovery module was not found." }
. $browserBootstrap
$browser = Get-CodistanChromiumBrowser -StateRoot $StateRoot

$expectedPath = [System.IO.Path]::GetFullPath((Join-Path $StateRoot "extensions\linkedin")).TrimEnd("\")
$extensionId = ""
$markerPath = Join-Path $StateRoot "config\browser-extensions-confirmed.json"
$profileDirectory = [string](Get-OptionalPropertyValue -InputObject $browser -Name "ProfileDirectoryName" -DefaultValue "")

if (Test-Path -LiteralPath $markerPath) {
    try {
        $marker = Get-Content -LiteralPath $markerPath -Raw | ConvertFrom-Json
        $markerProfileDirectory = [string](Get-OptionalPropertyValue -InputObject $marker -Name "browser_profile_directory" -DefaultValue "")
        if ([string]::IsNullOrWhiteSpace($markerProfileDirectory)) {
            $markerProfileDirectory = [string](Get-OptionalPropertyValue -InputObject $marker -Name "browser_profile" -DefaultValue "")
        }
        if (
            [string](Get-OptionalPropertyValue -InputObject $marker -Name "browser_id" -DefaultValue "") -eq [string]$browser.Id -and
            $markerProfileDirectory -eq $profileDirectory
        ) {
            $extensionId = [string](Get-OptionalPropertyValue -InputObject $marker -Name "linkedin_sales_navigator_extension_id" -DefaultValue "")
        }
    } catch {}
}

if (-not $extensionId) {
    $installation = Find-CodistanBrowserExtension `
        -Browser $browser `
        -ExtensionName "Codistan LinkedIn & Sales Navigator Capture" `
        -ExpectedPath $expectedPath `
        -PreferredProfileName $profileDirectory
    if ($installation) {
        $extensionId = [string]$installation.Id
    }
}

if ($extensionId) {
    Start-CodistanBrowser -Browser $browser -Arguments @(
        "chrome-extension://$extensionId/sales-nav-options.html"
    )
    Start-Sleep -Milliseconds 600
    $governanceScript = Join-Path $PSScriptRoot "govern-sales-automation-workspace.ps1"
    if (Test-Path -LiteralPath $governanceScript) {
        & $governanceScript -StateRoot $StateRoot -Mode Dedupe -Quiet
    }
    $profileDisplayName = [string](Get-OptionalPropertyValue -InputObject $browser -Name "ProfileDisplayName" -DefaultValue "")
    $profileLabel = if ($profileDisplayName) { $profileDisplayName } elseif ($profileDirectory) { $profileDirectory } else { "current profile" }
    Write-Host "Opened one Sales Navigator campaign-settings tab in $($browser.Name), profile $profileLabel."
    Write-Host "Register licensed lead-search URLs, run a manual campaign, and keep the no-confirmed-intent warning."
    exit 0
}

Start-CodistanBrowser -Browser $browser -Arguments @([string]$browser.ExtensionsUrl)
throw "The Codistan LinkedIn extension ID could not be located in $($browser.Name), profile $profileDirectory. Confirm the unpacked extension is loaded in that profile, then rerun this shortcut."
