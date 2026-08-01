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

$chromeCandidates = @(
    (Join-Path $env:ProgramFiles "Google\Chrome\Application\chrome.exe"),
    (if (${env:ProgramFiles(x86)}) { Join-Path ${env:ProgramFiles(x86)} "Google\Chrome\Application\chrome.exe" } else { $null }),
    (Join-Path $env:LOCALAPPDATA "Google\Chrome\Application\chrome.exe")
) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }
$chrome = $chromeCandidates | Select-Object -First 1
if (-not $chrome) {
    throw "Google Chrome was not found. Install Chrome, sign into your normal Upwork and LinkedIn accounts, then rerun this shortcut."
}

$instructionsPath = Join-Path $StateRoot "BROWSER-EXTENSION-SETUP.txt"
@"
CODISTAN SALES AUTOMATION — ONE-TIME CHROME SETUP

1. In chrome://extensions, turn Developer mode ON.
2. Click Load unpacked and select:
   $upworkPath
   Confirm: Codistan Upwork Opportunity Capture $upworkVersion
3. Click Load unpacked again and select:
   $linkedinPath
   Confirm: Codistan LinkedIn & Sales Navigator Capture $linkedinVersion
4. Keep both extensions enabled.
5. In the same normal Chrome profile, sign into Upwork and LinkedIn.
6. Sales Navigator capture requires an active licensed Sales Navigator session.

Safety boundary:
- The extensions collect visible evidence only.
- They never submit proposals or send messages, InMails, connection requests,
  follows, reactions, comments or emails.
- They never bypass login, verification or platform controls.
"@ | Set-Content -LiteralPath $instructionsPath -Encoding UTF8

Start-Process explorer.exe -ArgumentList ('"' + $upworkPath + '"') | Out-Null
Start-Process explorer.exe -ArgumentList ('"' + $linkedinPath + '"') | Out-Null
Start-Process -FilePath $chrome -ArgumentList @("--new-window", "chrome://extensions/") | Out-Null
Start-Process notepad.exe -ArgumentList ('"' + $instructionsPath + '"') | Out-Null

Write-Host ""
Write-Host "ONE-TIME CHROME SETUP" -ForegroundColor Cyan
Write-Host "Load these two unpacked extension folders in chrome://extensions/:"
Write-Host "  1. $upworkPath" -ForegroundColor White
Write-Host "  2. $linkedinPath" -ForegroundColor White
Write-Host "Expected versions: Upwork $upworkVersion; LinkedIn/Sales Navigator $linkedinVersion"
Write-Host ""
Write-Host "After loading them, sign into Upwork and LinkedIn in this same Chrome profile."
Write-Host "No proposal or outreach action is automated."
Write-Host ""

$confirmation = Read-Host "Type LOADED after both extensions are visible and enabled in Chrome"
if ($confirmation.Trim().ToUpperInvariant() -ne "LOADED") {
    throw "Extension setup was not confirmed. No setup marker was written."
}

$configRoot = Join-Path $StateRoot "config"
New-Item -ItemType Directory -Force -Path $configRoot | Out-Null
$markerPath = Join-Path $configRoot "browser-extensions-confirmed.json"
[ordered]@{
    schema_version = "codistan-sales-automation-browser-setup.v1"
    confirmed = $true
    confirmed_at = (Get-Date).ToUniversalTime().ToString("o")
    windows_user = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
    upwork_extension_version = $upworkVersion
    linkedin_sales_navigator_extension_version = $linkedinVersion
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
Write-Host "A Sales Navigator Campaigns shortcut is available on the desktop."

$campaignScript = Join-Path $commands "scripts\windows\open-sales-navigator-campaigns.ps1"
if (Test-Path -LiteralPath $campaignScript) {
    try {
        & $campaignScript -StateRoot $StateRoot
    } catch {
        Write-Warning "Sales Navigator campaign settings were not opened automatically: $($_.Exception.Message)"
    }
}
