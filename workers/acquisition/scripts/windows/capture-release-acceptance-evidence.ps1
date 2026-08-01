param(
    [Parameter(Mandatory = $true)]
    [ValidateSet(
        "before_install",
        "before_upgrade",
        "after_clean_install",
        "after_upgrade",
        "after_restart",
        "after_manual_start",
        "after_autostart_opt_in",
        "after_opt_in_restart",
        "after_cleanup_first",
        "after_cleanup_second",
        "after_rollback"
    )]
    [string]$Phase,
    [Parameter(Mandatory = $true)]
    [string]$EvidenceRoot,
    [string]$StateRoot = (Join-Path $env:LOCALAPPDATA "Codistan\Acquisition"),
    [string]$InstallRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..\..")).Path
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Convert-BytesToHex {
    param([byte[]]$Bytes)
    if ($null -eq $Bytes) { return $null }
    return -join ($Bytes | ForEach-Object { $_.ToString("x2") })
}

function Get-Sha256Hex {
    param([byte[]]$Bytes)
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
        return Convert-BytesToHex -Bytes $sha256.ComputeHash($Bytes)
    } finally {
        $sha256.Dispose()
    }
}

function Convert-ToSafePath {
    param([string]$Value)
    if ([string]::IsNullOrWhiteSpace($Value)) { return $null }
    try { return [System.IO.Path]::GetFullPath($Value) } catch { return $Value }
}

function Test-VolatileStatePath {
    param([string]$RelativePath)
    $normalized = $RelativePath.Replace("/", "\").ToLowerInvariant()
    return (
        $normalized -match "(^|\\)(runtime|logs|acceptance-evidence)(\\|$)" -or
        $normalized -match "\.(pid|lock|tmp)$" -or
        $normalized -match "sales-automation-release-acceptance\.json$"
    )
}

function Get-ProtectedStateManifest {
    param([string]$Root)
    if (-not (Test-Path -LiteralPath $Root)) { return @() }
    $rootPath = [System.IO.Path]::GetFullPath($Root).TrimEnd("\")
    return @(
        Get-ChildItem -LiteralPath $Root -File -Recurse -Force -ErrorAction SilentlyContinue |
            ForEach-Object {
                $relative = $_.FullName.Substring($rootPath.Length).TrimStart("\")
                if (-not (Test-VolatileStatePath -RelativePath $relative)) {
                    $hash = Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256
                    [ordered]@{
                        relative_path = $relative.Replace("\", "/")
                        sha256 = $hash.Hash.ToLowerInvariant()
                        bytes = $_.Length
                        last_write_utc = $_.LastWriteTimeUtc.ToString("o")
                    }
                }
            } |
            Sort-Object relative_path
    )
}

function Get-StartupFolderEntries {
    $folders = @(
        [Environment]::GetFolderPath("Startup"),
        [Environment]::GetFolderPath("CommonStartup")
    ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }
    $entries = foreach ($folder in $folders) {
        Get-ChildItem -LiteralPath $folder -Force -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -match "(?i)(codistan|sales automation|acquisition|prospecting)" } |
            ForEach-Object {
                [ordered]@{
                    folder = $folder
                    name = $_.Name
                    full_path = $_.FullName
                    bytes = if ($_.PSIsContainer) { $null } else { $_.Length }
                }
            }
    }
    return @($entries)
}

function Get-RunKeyEntries {
    $paths = @(
        "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run",
        "HKCU:\Software\Microsoft\Windows\CurrentVersion\RunOnce",
        "HKLM:\Software\Microsoft\Windows\CurrentVersion\Run",
        "HKLM:\Software\Microsoft\Windows\CurrentVersion\RunOnce"
    )
    $results = foreach ($path in $paths) {
        if (-not (Test-Path $path)) { continue }
        $properties = Get-ItemProperty -Path $path -ErrorAction SilentlyContinue
        if (-not $properties) { continue }
        foreach ($property in $properties.PSObject.Properties) {
            if ($property.Name -match "^PS") { continue }
            $text = "$($property.Name) $($property.Value)"
            if ($text -match "(?i)(codistan|sales automation|acquisition|prospecting)") {
                [ordered]@{
                    registry_path = $path
                    name = $property.Name
                    value = [string]$property.Value
                }
            }
        }
    }
    return @($results)
}

function Get-StartupApprovedEntries {
    $paths = @(
        "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run",
        "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\StartupFolder",
        "HKLM:\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run",
        "HKLM:\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\StartupFolder"
    )
    $results = foreach ($path in $paths) {
        if (-not (Test-Path $path)) { continue }
        $properties = Get-ItemProperty -Path $path -ErrorAction SilentlyContinue
        if (-not $properties) { continue }
        foreach ($property in $properties.PSObject.Properties) {
            if ($property.Name -match "^PS") { continue }
            if ($property.Name -match "(?i)(codistan|sales automation|acquisition|prospecting)") {
                $value = $property.Value
                [ordered]@{
                    registry_path = $path
                    name = $property.Name
                    value_hex = if ($value -is [byte[]]) { Convert-BytesToHex -Bytes $value } else { [string]$value }
                }
            }
        }
    }
    return @($results)
}

function Get-ScheduledTaskEntries {
    try {
        return @(
            Get-ScheduledTask -ErrorAction Stop |
                Where-Object {
                    "$($_.TaskName) $($_.TaskPath) $($_.Description)" -match "(?i)(codistan|sales automation|acquisition|prospecting)"
                } |
                ForEach-Object {
                    [ordered]@{
                        task_name = $_.TaskName
                        task_path = $_.TaskPath
                        state = [string]$_.State
                        description = [string]$_.Description
                    }
                }
        )
    } catch {
        return @([ordered]@{ error = $_.Exception.Message })
    }
}

function Get-ManagedProcesses {
    $results = @()
    foreach ($process in Get-CimInstance Win32_Process -ErrorAction SilentlyContinue) {
        $commandLine = [string]$process.CommandLine
        if ($commandLine -match "(?i)(acquisition_v4|sales automation|codistan.*acquisition|8765|8775|8785)") {
            $results += [ordered]@{
                process_id = [int]$process.ProcessId
                name = [string]$process.Name
                command_line_hash = if ($commandLine) {
                    $bytes = [Text.Encoding]::UTF8.GetBytes($commandLine)
                    Get-Sha256Hex -Bytes $bytes
                } else { $null }
            }
        }
    }
    return @($results)
}

function Get-PortStatus {
    param([int]$Port)
    $connections = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
    return [ordered]@{
        port = $Port
        listening = $connections.Count -gt 0
        owning_process_ids = @($connections | ForEach-Object { [int]$_.OwningProcess } | Sort-Object -Unique)
    }
}

function Get-CollectorHealth {
    param([string]$Source, [int]$Port)
    try {
        $health = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 3
        $external = if ($null -ne $health.external_actions_enabled) { [bool]$health.external_actions_enabled } else { $null }
        return [ordered]@{
            source = $Source
            port = $Port
            reachable = $true
            ready = [bool]($health.ready -or $health.status -eq "ok" -or $health.healthy)
            external_actions_enabled = $external
            runtime_version = [string]$health.runtime_version
            response_keys = @($health.PSObject.Properties.Name | Sort-Object)
        }
    } catch {
        return [ordered]@{
            source = $Source
            port = $Port
            reachable = $false
            ready = $false
            external_actions_enabled = $null
            runtime_version = $null
            error = $_.Exception.Message.Substring(0, [Math]::Min(300, $_.Exception.Message.Length))
        }
    }
}

function Get-ReleaseIdentity {
    param([string]$Root)
    $manifestPath = Join-Path $Root "workers\acquisition\release-manifest.json"
    $linkedinPath = Join-Path $Root "workers\acquisition\extensions\linkedin\manifest.json"
    $upworkPath = Join-Path $Root "workers\acquisition\extensions\upwork\manifest.json"
    $result = [ordered]@{
        release_manifest_path = $manifestPath
        release_version = $null
        release_status = $null
        linkedin_sales_navigator_extension = $null
        upwork_extension = $null
        external_actions_enabled = $null
    }
    if (Test-Path -LiteralPath $manifestPath) {
        $release = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
        $result.release_version = [string]$release.release_version
        $result.release_status = [string]$release.release_status
        $result.linkedin_sales_navigator_extension = [string]$release.components.linkedin_sales_navigator_extension
        $result.upwork_extension = [string]$release.components.upwork_extension
        $result.external_actions_enabled = [bool]$release.state_contract.external_actions_enabled
    }
    if (Test-Path -LiteralPath $linkedinPath) {
        $result.linkedin_manifest_version = [string](Get-Content -LiteralPath $linkedinPath -Raw | ConvertFrom-Json).version
    }
    if (Test-Path -LiteralPath $upworkPath) {
        $result.upwork_manifest_version = [string](Get-Content -LiteralPath $upworkPath -Raw | ConvertFrom-Json).version
    }
    return $result
}

$evidencePath = [System.IO.Path]::GetFullPath($EvidenceRoot)
New-Item -ItemType Directory -Force -Path $evidencePath | Out-Null
$statePath = Convert-ToSafePath $StateRoot
$installPath = Convert-ToSafePath $InstallRoot
$ports = [ordered]@{ upwork = 8765; linkedin = 8775; sales_navigator = 8785 }

$os = Get-CimInstance Win32_OperatingSystem
$computer = Get-CimInstance Win32_ComputerSystem
$health = foreach ($entry in $ports.GetEnumerator()) {
    Get-CollectorHealth -Source $entry.Key -Port $entry.Value
}

$snapshot = [ordered]@{
    schema_version = "codistan-sales-automation-windows-evidence.v1"
    phase = $Phase
    captured_at = (Get-Date).ToUniversalTime().ToString("o")
    machine = [ordered]@{
        name = $env:COMPUTERNAME
        user = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
        os_caption = [string]$os.Caption
        os_version = [string]$os.Version
        os_build = [string]$os.BuildNumber
        architecture = [string]$computer.SystemType
        powershell_version = $PSVersionTable.PSVersion.ToString()
    }
    paths = [ordered]@{
        install_root = $installPath
        state_root = $statePath
        evidence_root = $evidencePath
    }
    release_identity = Get-ReleaseIdentity -Root $installPath
    protected_state_manifest = Get-ProtectedStateManifest -Root $statePath
    startup = [ordered]@{
        startup_folder_entries = Get-StartupFolderEntries
        run_key_entries = Get-RunKeyEntries
        startup_approved_entries = Get-StartupApprovedEntries
        scheduled_tasks = Get-ScheduledTaskEntries
    }
    runtime = [ordered]@{
        managed_processes = Get-ManagedProcesses
        ports = @($ports.Values | ForEach-Object { Get-PortStatus -Port $_ })
        collector_health = @($health)
        all_collectors_ready = @($health | Where-Object { -not $_.ready }).Count -eq 0
        all_external_actions_disabled = @($health | Where-Object { $_.reachable -and $_.external_actions_enabled -ne $false }).Count -eq 0
    }
    safety = [ordered]@{
        state_root_preserved = $true
        capture_is_read_only = $true
        external_action_performed = $false
    }
}

$outputPath = Join-Path $evidencePath "$Phase.json"
$snapshot | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $outputPath -Encoding UTF8
Write-Host "Release evidence captured: $outputPath"
Write-Host "Protected state files: $($snapshot.protected_state_manifest.Count)"
Write-Host "Startup registrations: $($snapshot.startup.startup_folder_entries.Count + $snapshot.startup.run_key_entries.Count + $snapshot.startup.startup_approved_entries.Count + $snapshot.startup.scheduled_tasks.Count)"
Write-Host "All collectors ready: $($snapshot.runtime.all_collectors_ready)"
Write-Host "All reachable collectors report external actions disabled: $($snapshot.runtime.all_external_actions_disabled)"
