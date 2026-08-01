param(
    [string]$StateRoot = (Join-Path $env:LOCALAPPDATA "Codistan\Acquisition")
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$extensionRoot = Join-Path $StateRoot "extensions"
$upworkPath = Join-Path $extensionRoot "upwork"
$linkedinPath = Join-Path $extensionRoot "linkedin"
$upworkManifest = Join-Path $upworkPath "manifest.json"
$linkedinManifest = Join-Path $linkedinPath "manifest.json"

if (-not (Test-Path -LiteralPath $upworkManifest) -or -not (Test-Path -LiteralPath $linkedinManifest)) {
    throw "The installed browser extensions were not found. Run SETUP-AND-RUN-SALES-AUTOMATION.cmd first."
}

$upworkVersion = [string](Get-Content -LiteralPath $upworkManifest -Raw | ConvertFrom-Json).version
$linkedinVersion = [string](Get-Content -LiteralPath $linkedinManifest -Raw | ConvertFrom-Json).version

$browserBootstrap = Join-Path $PSScriptRoot "chromium-browser.ps1"
if (-not (Test-Path -LiteralPath $browserBootstrap)) {
    throw "The Sales Automation browser discovery module was not found."
}
. $browserBootstrap
$browser = Get-CodistanChromiumBrowser -StateRoot $StateRoot

$instructionsPath = Join-Path $StateRoot "BROWSER-EXTENSION-SETUP.txt"
@"
CODISTAN SALES AUTOMATION — ONE-TIME BROWSER SETUP

Selected browser: $($browser.Name)
Extensions page: $($browser.ExtensionsUrl)

1. In the extensions page, turn Developer mode ON.
2. Click Load unpacked and select:
   $upworkPath
   Confirm: Codistan Upwork Opportunity Capture $upworkVersion
3. Click Load unpacked again and select:
   $linkedinPath
   Confirm: Codistan LinkedIn & Sales Navigator Capture $linkedinVersion
4. Keep both extensions enabled.
5. In this same browser profile, sign into Upwork and LinkedIn normally.
6. Sales Navigator capture requires an active licensed Sales Navigator session.

Safety boundary:
- The extensions collect visible evidence only.
- They never submit proposals or send messages, InMails, connection requests,
  follows, reactions, comments or emails.
- They never bypass login, verification or platform controls.
"@ | Set-Content -LiteralPath $instructionsPath -Encoding UTF8

Start-Process explorer.exe -ArgumentList ('"' + $upworkPath + '"') | Out-Null
Start-Process explorer.exe -ArgumentList ('"' + $linkedinPath + '"') | Out-Null
Start-CodistanBrowser -Browser $browser -Arguments @("--new-window", [string]$browser.ExtensionsUrl)
Start-Process notepad.exe -ArgumentList ('"' + $instructionsPath + '"') | Out-Null

Write-Host ""
Write-Host "ONE-TIME BROWSER SETUP" -ForegroundColor Cyan
Write-Host "Browser: $($browser.Name)" -ForegroundColor White
Write-Host "Load these two unpacked extension folders in $($browser.ExtensionsUrl):"
Write-Host "  1. $upworkPath" -ForegroundColor White
Write-Host "  2. $linkedinPath" -ForegroundColor White
Write-Host "Expected versions: Upwork $upworkVersion; LinkedIn/Sales Navigator $linkedinVersion"
Write-Host ""
Write-Host "After loading them, sign into Upwork and LinkedIn in this same browser profile."
Write-Host "No proposal or outreach action is automated."
Write-Host ""

$confirmation = Read-Host "Type LOADED after both extensions are visible and enabled"
if ($confirmation.Trim().ToUpperInvariant() -ne "LOADED") {
    throw "Extension setup was not confirmed. No setup marker was written."
}

Start-Sleep -Seconds 2
$upworkInstallation = Find-CodistanBrowserExtension `
    -Browser $browser `
    -ExtensionName "Codistan Upwork Opportunity Capture" `
    -ExpectedPath $upworkPath
$linkedinInstallation = Find-CodistanBrowserExtension `
    -Browser $browser `
    -ExtensionName "Codistan LinkedIn & Sales Navigator Capture" `
    -ExpectedPath $linkedinPath

$configRoot = Join-Path $StateRoot "config"
New-Item -ItemType Directory -Force -Path $configRoot | Out-Null
$markerPath = Join-Path $configRoot "browser-extensions-confirmed.json"
[ordered]@{
    schema_version = "codistan-sales-automation-browser-setup.v1"
    confirmed = $true
    confirmed_at = (Get-Date).ToUniversalTime().ToString("o")
    windows_user = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
    browser_id = [string]$browser.Id
    browser_name = [string]$browser.Name
    browser_executable = [string]$browser.Executable
    browser_extensions_url = [string]$browser.ExtensionsUrl
    browser_profile = if ($linkedinInstallation) { [string]$linkedinInstallation.ProfileName } elseif ($upworkInstallation) { [string]$upworkInstallation.ProfileName } else { "" }
    upwork_extension_version = $upworkVersion
    upwork_extension_id = if ($upworkInstallation) { [string]$upworkInstallation.Id } else { "" }
    linkedin_sales_navigator_extension_version = $linkedinVersion
    linkedin_sales_navigator_extension_id = if ($linkedinInstallation) { [string]$linkedinInstallation.Id } else { "" }
    upwork_extension_path = $upworkPath
    linkedin_extension_path = $linkedinPath
    external_actions_enabled = $false
} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $markerPath -Encoding UTF8

$commands = Join-Path $StateRoot "app-current\workers\acquisition"
$campaignCommand = Join-Path $commands "OPEN-SALES-NAVIGATOR-CAMPAIGNS.cmd"
if (Test-Path -LiteralPath $campaignCommand) {
    $desktop = [Environment]::GetFolderPath("Desktop")
    $shortcutPath = Join-Path $desktop "Sales Navigator Campaigns.lnk"
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = $campaignCommand
    $shortcut.WorkingDirectory = $commands
    $shortcut.WindowStyle = 1
    $shortcut.Save()
}

Write-Host "Browser extension setup confirmed: $markerPath" -ForegroundColor Green
if (-not $upworkInstallation -or -not $linkedinInstallation) {
    Write-Warning "The browser did not expose one or both extension IDs yet. Capture can still work; restart the browser once if an extension does not respond."
}
Write-Host "A Sales Navigator Campaigns shortcut is available on the desktop."

$campaignScript = Join-Path $commands "scripts\windows\open-sales-navigator-campaigns.ps1"
if (Test-Path -LiteralPath $campaignScript) {
    try {
        & $campaignScript -StateRoot $StateRoot
    } catch {
        Write-Warning "Sales Navigator campaign settings were not opened automatically: $($_.Exception.Message)"
    }
}
