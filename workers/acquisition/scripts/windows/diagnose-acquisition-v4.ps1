param([string]$StateRoot = (Join-Path $env:LOCALAPPDATA "Codistan\Acquisition"))
$ErrorActionPreference = "Stop"
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$diagnosticsRoot = Join-Path $StateRoot "diagnostics"
$working = Join-Path $diagnosticsRoot "acquisition-v4-$timestamp"
New-Item -ItemType Directory -Force -Path $working | Out-Null

$status = @{}
foreach ($source in @(@("upwork", 8765), @("linkedin", 8775))) {
    try { $status[$source[0]] = Invoke-RestMethod -Uri "http://127.0.0.1:$($source[1])/health" -TimeoutSec 3 }
    catch { $status[$source[0]] = @{ ready = $false; error = $_.Exception.GetType().Name } }
}
$status | ConvertTo-Json -Depth 8 | Set-Content (Join-Path $working "health.json") -Encoding UTF8

$metadata = [ordered]@{
    generated_at = (Get-Date).ToString("o")
    windows_version = [Environment]::OSVersion.VersionString
    powershell_version = $PSVersionTable.PSVersion.ToString()
    state_root = "%LOCALAPPDATA%\Codistan\Acquisition"
    runtime_pid_present = Test-Path (Join-Path $StateRoot "runtime.pid")
}
$metadata | ConvertTo-Json | Set-Content (Join-Path $working "metadata.json") -Encoding UTF8

$app = Join-Path $StateRoot "app-current\workers\acquisition"
if (Test-Path $app) {
    Get-ChildItem $app -File -Recurse | ForEach-Object {
        [pscustomobject]@{ path = $_.FullName.Substring($app.Length).TrimStart('\'); length = $_.Length; modified = $_.LastWriteTimeUtc.ToString("o") }
    } | ConvertTo-Json -Depth 4 | Set-Content (Join-Path $working "application-files.json") -Encoding UTF8
}
foreach ($source in @("upwork", "linkedin")) {
    $manifest = Join-Path $StateRoot "extensions\$source\manifest.json"
    if (Test-Path $manifest) { Copy-Item $manifest (Join-Path $working "$source-manifest.json") }
}
$zip = Join-Path $diagnosticsRoot "acquisition-v4-diagnostics-$timestamp.zip"
Compress-Archive -Path (Join-Path $working "*") -DestinationPath $zip -Force
Remove-Item $working -Recurse -Force
Write-Host "Safe diagnostic bundle created: $zip"
Write-Host "It contains health, versions and file metadata only; no opportunity bodies, cookies or credentials."
