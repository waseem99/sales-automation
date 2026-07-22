param([string]$StateRoot = (Join-Path $env:LOCALAPPDATA "Codistan\Acquisition"))
$ErrorActionPreference = "Stop"
$appCurrent = Join-Path $StateRoot "app-current"
$appPrevious = Join-Path $StateRoot "app-previous"
if (-not (Test-Path $appPrevious)) { throw "No previous Acquisition V4 application version is available." }
$pidFile = Join-Path $StateRoot "runtime.pid"
if (Test-Path $pidFile) {
    $runtimePid = 0
    [void][int]::TryParse((Get-Content $pidFile -Raw).Trim(), [ref]$runtimePid)
    if ($runtimePid -gt 0) { Stop-Process -Id $runtimePid -Force -ErrorAction SilentlyContinue }
}
Get-NetTCPConnection -State Listen -LocalPort 8765,8775 -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique |
    ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }
$temp = Join-Path $StateRoot "app-rollback-temp"
if (Test-Path $temp) { Remove-Item $temp -Recurse -Force }
Move-Item $appCurrent $temp
Move-Item $appPrevious $appCurrent
Move-Item $temp $appPrevious
foreach ($source in @("upwork", "linkedin")) {
    $target = Join-Path $StateRoot "extensions\$source"
    if (Test-Path $target) { Remove-Item $target -Recurse -Force }
    New-Item -ItemType Directory -Force -Path $target | Out-Null
    Copy-Item -Path (Join-Path $appCurrent "workers\acquisition\extensions\$source\*") -Destination $target -Recurse -Force
}
$commands = Join-Path $appCurrent "workers\acquisition"
Start-Process -FilePath (Join-Path $commands "START-ACQUISITION-V4.cmd") -WindowStyle Minimized
Write-Host "Rolled back the application files. Captured records and deduplication state were preserved."
Write-Host "Reload both unpacked Chrome extensions from their stable local folders."
