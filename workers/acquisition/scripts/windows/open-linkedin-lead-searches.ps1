param(
    [string]$InstallRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..\..")).Path,
    [string]$StateRoot = (Join-Path $env:LOCALAPPDATA "Codistan\Acquisition")
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$healthUrl = "http://127.0.0.1:8775/health"
try {
    $health = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 2
    if ($health.schema_version -ne "codistan-acquisition-health.v1" -or $health.source -ne "linkedin" -or $health.external_actions_enabled -ne $false) {
        throw "Port 8775 is not the safe Sales Automation LinkedIn collector."
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
            if ($health.schema_version -eq "codistan-acquisition-health.v1" -and $health.source -eq "linkedin" -and $health.external_actions_enabled -eq $false) {
                $ready = $true
                break
            }
        } catch {}
    }
    if (-not $ready) { throw "The LinkedIn collector did not become healthy on port 8775." }
}

$browserBootstrap = Join-Path $PSScriptRoot "chromium-browser.ps1"
if (-not (Test-Path -LiteralPath $browserBootstrap)) { throw "The browser discovery module was not found." }
. $browserBootstrap
$browser = Get-CodistanChromiumBrowser -StateRoot $StateRoot

# These searches bias toward buyer-authored vendor/agency requests and away from employment posts.
$queries = @(
    '("looking for" OR "seeking" OR "need recommendations for" OR "request for proposal" OR RFP) AND ("software development agency" OR "software development partner" OR "MVP development agency" OR "web app development agency") NOT hiring NOT "job opening" NOT recruiter NOT "join our team"',
    '("looking for" OR "seeking" OR "need recommendations for" OR "request for proposal" OR RFP) AND ("AI automation agency" OR "AI development partner" OR "AI implementation partner" OR "generative AI consultancy") NOT hiring NOT job NOT recruiter',
    '("looking for" OR "seeking" OR "need recommendations for" OR "request for proposal" OR RFP) AND ("digital marketing agency" OR "performance marketing agency" OR "SEO agency" OR "social media agency") NOT hiring NOT job NOT recruiter',
    '("looking for" OR "seeking" OR "need recommendations for" OR "request for proposal" OR RFP) AND ("video production agency" OR "animation studio" OR "3D visualization studio" OR "motion graphics agency") NOT hiring NOT job NOT recruiter',
    '("looking for" OR "seeking" OR "need recommendations for" OR "request for proposal" OR RFP OR "project-based engagement") AND ("cybersecurity consultancy" OR "security assessment firm" OR "ISO 27001 consultant" OR "SOC 2 consultant" OR "penetration testing company") NOT hiring NOT job NOT recruiter'
)
$urls = $queries | ForEach-Object {
    "https://www.linkedin.com/search/results/content/?keywords=$([uri]::EscapeDataString($_))&origin=GLOBAL_SEARCH_HEADER"
}
$chromeArguments = @("--new-window") + @($urls)
Start-Process -FilePath ([string]$browser.Executable) -ArgumentList $chromeArguments | Out-Null
Write-Host "Opened five high-intent buyer-request LinkedIn searches in $($browser.Name)."
