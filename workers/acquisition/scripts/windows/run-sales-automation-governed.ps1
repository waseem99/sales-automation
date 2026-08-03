param(
    [string]$StateRoot = (Join-Path $env:LOCALAPPDATA "Codistan\Acquisition")
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$operationalScript = Join-Path $PSScriptRoot "run-sales-automation-operational.ps1"
if (-not (Test-Path -LiteralPath $operationalScript)) {
    throw "The Sales Automation operational startup script was not found."
}

# Start and verify collectors, regenerate the Lead Desk, and deliberately skip
# the legacy multi-tab launch. Browser opening is governed below.
& $operationalScript `
    -StateRoot $StateRoot `
    -SkipSourceLaunch `
    -SkipLeadDesk

$browserBootstrap = Join-Path $PSScriptRoot "chromium-browser.ps1"
if (-not (Test-Path -LiteralPath $browserBootstrap)) {
    throw "The configured-browser module was not found."
}
. $browserBootstrap
$browser = Get-CodistanChromiumBrowser -StateRoot $StateRoot

$installRoot = Join-Path $StateRoot "app-current"
& (Join-Path $PSScriptRoot "open-approved-upwork-searches.ps1") `
    -InstallRoot $installRoot `
    -StateRoot $StateRoot
& (Join-Path $PSScriptRoot "open-linkedin-lead-searches.ps1") `
    -InstallRoot $installRoot `
    -StateRoot $StateRoot

$reviewPath = Join-Path $StateRoot "review\index.html"
if (-not (Test-Path -LiteralPath $reviewPath)) {
    throw "The Lead Desk was not generated: $reviewPath"
}
$reviewUrl = ([System.Uri]::new($reviewPath)).AbsoluteUri
Start-CodistanBrowser -Browser $browser -Arguments @($reviewUrl)

# Allow Chrome to create the requested tabs before the extension governance
# page keeps one tab per managed category and closes only managed duplicates.
Start-Sleep -Milliseconds 900
$governanceScript = Join-Path $PSScriptRoot "govern-sales-automation-workspace.ps1"
if (-not (Test-Path -LiteralPath $governanceScript)) {
    throw "The Sales Automation workspace-governance script was not found."
}
& $governanceScript -StateRoot $StateRoot -Mode Dedupe

Write-Host ""
Write-Host "Governed Sales Automation workspace is ready." -ForegroundColor Green
Write-Host "  1 Upwork workspace tab"
Write-Host "  1 LinkedIn buyer-intent workspace tab"
Write-Host "  1 Lead Desk tab"
Write-Host "  Sales Navigator Campaigns opens only from its desktop shortcut"
Write-Host "  Unrelated Chrome tabs remain untouched"
Write-Host "Use Stop Sales Automation when finished; it closes Codistan-managed tabs and preserves all state."
