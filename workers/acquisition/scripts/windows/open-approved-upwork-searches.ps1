param(
    [string]$InstallRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..\..")).Path,
    [string]$StateRoot = (Join-Path $env:LOCALAPPDATA "Codistan\Acquisition")
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$healthUrl = "http://127.0.0.1:8765/health"
try {
    $health = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 2
    if ($health.schema_version -ne "codistan-acquisition-health.v1" -or $health.source -ne "upwork" -or $health.external_actions_enabled -ne $false) {
        throw "Port 8765 is not the safe Sales Automation Upwork collector."
    }
} catch {
    $startCommand = Join-Path $InstallRoot "workers\acquisition\START-ACQUISITION-V4.cmd"
    if (-not (Test-Path $startCommand)) { throw "The Sales Automation start command was not found." }
    Start-Process -FilePath $startCommand -WindowStyle Minimized | Out-Null
    $ready = $false
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        Start-Sleep -Seconds 1
        try {
            $health = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 2
            if ($health.schema_version -eq "codistan-acquisition-health.v1" -and $health.source -eq "upwork" -and $health.external_actions_enabled -eq $false) {
                $ready = $true
                break
            }
        } catch {}
    }
    if (-not $ready) { throw "The Upwork collector did not become healthy on port 8765." }
}

$browserBootstrap = Join-Path $PSScriptRoot "chromium-browser.ps1"
if (-not (Test-Path -LiteralPath $browserBootstrap)) { throw "The browser discovery module was not found." }
. $browserBootstrap
$browser = Get-CodistanChromiumBrowser -StateRoot $StateRoot

# Keep the operator workspace to one visible Upwork tab. The Upwork extension's
# bounded scheduler continues rotating through all approved saved searches in
# temporary background tabs and closes those tabs after capture.
$workspaceUrl = "https://www.upwork.com/nx/find-work/9652811"
Start-CodistanBrowser -Browser $browser -Arguments @($workspaceUrl)

$profileDisplayName = [string](Get-OptionalPropertyValue -InputObject $browser -Name "ProfileDisplayName" -DefaultValue "")
$profileDirectory = [string](Get-OptionalPropertyValue -InputObject $browser -Name "ProfileDirectoryName" -DefaultValue "")
$profileLabel = if ($profileDisplayName) { $profileDisplayName } elseif ($profileDirectory) { $profileDirectory } else { "current profile" }
Write-Host "Opened one governed Upwork workspace tab in $($browser.Name), profile $profileLabel."
