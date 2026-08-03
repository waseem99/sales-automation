param(
    [string]$StateRoot = (Join-Path $env:LOCALAPPDATA "Codistan\Acquisition"),
    [ValidateSet("Dedupe", "Close")][string]$Mode = "Dedupe",
    [switch]$Quiet
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Get-OptionalPropertyValue {
    param(
        [AllowNull()][object]$InputObject,
        [Parameter(Mandatory = $true)][string]$Name,
        [AllowNull()][object]$DefaultValue = $null
    )
    if ($null -eq $InputObject) { return $DefaultValue }
    if ($InputObject -is [System.Collections.IDictionary]) {
        if ($InputObject.Contains($Name)) { return $InputObject[$Name] }
        return $DefaultValue
    }
    $property = $InputObject.PSObject.Properties[$Name]
    if ($null -eq $property) { return $DefaultValue }
    return $property.Value
}

$markerPath = Join-Path $StateRoot "config\browser-extensions-confirmed.json"
if (-not (Test-Path -LiteralPath $markerPath)) {
    if ($Quiet) { exit 0 }
    throw "The confirmed browser-extension configuration was not found."
}

if ($Mode -eq "Close" -and -not (Get-Process chrome -ErrorAction SilentlyContinue)) {
    if (-not $Quiet) { Write-Host "No Chrome workspace was running." }
    exit 0
}

$marker = Get-Content -LiteralPath $markerPath -Raw | ConvertFrom-Json
$extensionId = [string](Get-OptionalPropertyValue -InputObject $marker -Name "linkedin_sales_navigator_extension_id" -DefaultValue "")
if ([string]::IsNullOrWhiteSpace($extensionId)) {
    if ($Quiet) { exit 0 }
    throw "The LinkedIn/Sales Navigator extension ID is unavailable. Run browser extension setup once."
}

$extensionRoot = Join-Path $StateRoot "extensions\linkedin"
$governancePage = Join-Path $extensionRoot "workspace-governance.html"
$governanceScript = Join-Path $extensionRoot "workspace-governance.js"
if (-not (Test-Path -LiteralPath $governancePage) -or -not (Test-Path -LiteralPath $governanceScript)) {
    if ($Quiet) { exit 0 }
    throw "The browser workspace-governance files are not installed."
}

$browserBootstrap = Join-Path $StateRoot "app-current\workers\acquisition\scripts\windows\chromium-browser.ps1"
if (-not (Test-Path -LiteralPath $browserBootstrap)) {
    if ($Quiet) { exit 0 }
    throw "The configured-browser module was not found."
}
. $browserBootstrap
$browser = Get-CodistanChromiumBrowser -StateRoot $StateRoot

$reviewPath = Join-Path $StateRoot "review\index.html"
$leadDeskUrl = ""
if (Test-Path -LiteralPath $reviewPath) {
    $leadDeskUrl = ([System.Uri]::new($reviewPath)).AbsoluteUri
}

$modeValue = if ($Mode -eq "Close") { "close" } else { "dedupe" }
$governanceUrl = "chrome-extension://$extensionId/workspace-governance.html?mode=$modeValue"
if ($leadDeskUrl) {
    $governanceUrl += "&leadDeskUrl=$([System.Uri]::EscapeDataString($leadDeskUrl))"
}

Start-CodistanBrowser -Browser $browser -Arguments @($governanceUrl)
Start-Sleep -Milliseconds 1600

if (-not $Quiet) {
    if ($Mode -eq "Close") {
        Write-Host "Closed Codistan-managed workspace tabs; unrelated Chrome tabs were untouched."
    } else {
        Write-Host "Browser workspace governed: one Upwork tab, one LinkedIn tab and one Lead Desk tab; unrelated tabs were untouched."
    }
}
