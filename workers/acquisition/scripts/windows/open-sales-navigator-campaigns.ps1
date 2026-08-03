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
$profileName = [string](Get-OptionalPropertyValue -InputObject $browser -Name "ProfileName" -DefaultValue "")

if (Test-Path -LiteralPath $markerPath) {
    try {
        $marker = Get-Content -LiteralPath $markerPath -Raw | ConvertFrom-Json
        if (
            [string](Get-OptionalPropertyValue -InputObject $marker -Name "browser_id" -DefaultValue "") -eq [string]$browser.Id -and
            [string](Get-OptionalPropertyValue -InputObject $marker -Name "browser_profile" -DefaultValue "") -eq $profileName
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
        -PreferredProfileName $profileName
    if ($installation) {
        $extensionId = [string]$installation.Id
    }
}

if ($extensionId) {
    Start-CodistanBrowser -Browser $browser -Arguments @(
        "--new-window",
        "chrome-extension://$extensionId/sales-nav-options.html"
    )
    $profileSuffix = $(if ($profileName) { ", profile $profileName" } else { "" })
    Write-Host "Opened Sales Navigator campaign settings in $($browser.Name)$profileSuffix."
    Write-Host "Register licensed lead-search URLs, run a manual campaign, and keep the no-confirmed-intent warning."
    exit 0
}

Start-CodistanBrowser -Browser $browser -Arguments @("--new-window", [string]$browser.ExtensionsUrl)
throw "The Codistan LinkedIn extension ID could not be located in $($browser.Name), profile $profileName. Confirm the unpacked extension is loaded in that profile, then rerun this shortcut."
