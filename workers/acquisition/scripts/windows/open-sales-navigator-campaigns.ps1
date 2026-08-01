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
$profileArgument = ""
$markerPath = Join-Path $StateRoot "config\browser-extensions-confirmed.json"

if (Test-Path -LiteralPath $markerPath) {
    try {
        $marker = Get-Content -LiteralPath $markerPath -Raw | ConvertFrom-Json
        if ([string]$marker.browser_id -eq [string]$browser.Id) {
            $extensionId = [string]$marker.linkedin_sales_navigator_extension_id
        }
    } catch {}
}

if (-not $extensionId) {
    $installation = Find-CodistanBrowserExtension `
        -Browser $browser `
        -ExtensionName "Codistan LinkedIn & Sales Navigator Capture" `
        -ExpectedPath $expectedPath
    if ($installation) {
        $extensionId = [string]$installation.Id
        $profileArgument = [string]$installation.BrowserArgument
    }
}

if ($extensionId) {
    $arguments = @()
    if ($profileArgument) { $arguments += $profileArgument }
    $arguments += "--new-window"
    $arguments += "chrome-extension://$extensionId/sales-nav-options.html"
    Start-Process -FilePath ([string]$browser.Executable) -ArgumentList $arguments | Out-Null
    Write-Host "Opened Sales Navigator campaign settings in $($browser.Name)."
    Write-Host "Register licensed lead-search URLs, run a manual campaign, and keep the no-confirmed-intent warning."
    exit 0
}

Start-Process -FilePath ([string]$browser.Executable) -ArgumentList @("--new-window", [string]$browser.ExtensionsUrl) | Out-Null
throw "The Codistan LinkedIn extension ID could not be located in $($browser.Name). Confirm the unpacked extension is loaded, then rerun this shortcut."
