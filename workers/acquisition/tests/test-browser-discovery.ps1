$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$packageRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$browserScript = Join-Path $packageRoot "scripts\windows\chromium-browser.ps1"
if (-not (Test-Path -LiteralPath $browserScript)) {
    throw "Chromium browser discovery script was not found."
}

$content = Get-Content -LiteralPath $browserScript -Raw
if ($content -match '\(\s*if\s*\(') {
    throw "Browser discovery contains an inline parenthesized if-expression that is incompatible with Windows PowerShell 5.1."
}

. $browserScript

$candidates = @(Get-CodistanBrowserCandidates)
if ($candidates.Count -eq 0) {
    throw "No supported Chromium browser was discovered on the Windows runner."
}

$browser = Get-CodistanChromiumBrowser
if ($null -eq $browser) {
    throw "Browser selection returned no value."
}

$browserId = [string](Get-OptionalPropertyValue -InputObject $browser -Name "Id" -DefaultValue "")
$browserName = [string](Get-OptionalPropertyValue -InputObject $browser -Name "Name" -DefaultValue "")
$browserExecutable = [string](Get-OptionalPropertyValue -InputObject $browser -Name "Executable" -DefaultValue "")
$extensionsUrl = [string](Get-OptionalPropertyValue -InputObject $browser -Name "ExtensionsUrl" -DefaultValue "")

if ([string]::IsNullOrWhiteSpace($browserId) -or [string]::IsNullOrWhiteSpace($browserName)) {
    throw "Selected browser identity is incomplete."
}
if ([string]::IsNullOrWhiteSpace($browserExecutable) -or -not (Test-Path -LiteralPath $browserExecutable)) {
    throw "Selected browser executable is unavailable: $browserExecutable"
}
if ($extensionsUrl -notmatch '^(?:opera|chrome|edge|brave)://extensions/$') {
    throw "Selected browser extensions URL is invalid: $extensionsUrl"
}

Write-Host "Windows PowerShell browser discovery passed: $browserName ($browserId)"
Write-Host "Executable: $browserExecutable"
Write-Host "Extensions URL: $extensionsUrl"
