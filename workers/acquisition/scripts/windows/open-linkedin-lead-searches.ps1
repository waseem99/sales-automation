param(
    [string]$InstallRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..\..")).Path
)

$ErrorActionPreference = "Stop"
$healthUrl = "http://127.0.0.1:8775/health"
try {
    $health = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 2
    if ($health.schema_version -ne "codistan-acquisition-health.v1" -or $health.source -ne "linkedin") {
        throw "Port 8775 is occupied by a legacy LinkedIn service rather than Acquisition V4."
    }
} catch {
    $startCommand = Join-Path $InstallRoot "workers\acquisition\START-ACQUISITION-V4.cmd"
    if (-not (Test-Path $startCommand)) { throw "The Acquisition V4 start command was not found." }
    Start-Process -FilePath $startCommand -WindowStyle Minimized
    $ready = $false
    for ($attempt = 0; $attempt -lt 15; $attempt++) {
        Start-Sleep -Seconds 1
        try {
            $health = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 2
            if ($health.schema_version -eq "codistan-acquisition-health.v1" -and $health.source -eq "linkedin") {
                $ready = $true
                break
            }
        } catch {}
    }
    if (-not $ready) { throw "The LinkedIn Acquisition V4 collector did not become healthy on port 8775. Stop the legacy LinkedIn V3 service first." }
}

$chromeCandidates = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
)
$chrome = $chromeCandidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if (-not $chrome) { throw "Google Chrome was not found." }

$queries = @(
    '"looking for" AND ("software development agency" OR "development partner") NOT hiring NOT job NOT role',
    '("looking for" OR "seeking") AND ("AI automation partner" OR "AI agency") NOT hiring NOT job NOT role',
    '("looking for" OR "seeking" OR "request for proposal") AND "digital marketing agency" NOT hiring NOT job',
    '("looking for" OR "seeking") AND ("video production agency" OR "animation studio") NOT hiring NOT job',
    '("looking for" OR "seeking" OR "calling") AND ("cybersecurity consultant" OR "security firm" OR "project-based engagements") NOT hiring NOT job'
)
$urls = $queries | ForEach-Object {
    "https://www.linkedin.com/search/results/content/?keywords=$([uri]::EscapeDataString($_))&origin=GLOBAL_SEARCH_HEADER"
}
$chromeArguments = @("--new-window") + @($urls)
Start-Process -FilePath $chrome -ArgumentList $chromeArguments
Write-Host "Opened buyer-intent LinkedIn searches in normal Chrome."