param(
    [string]$StateRoot = (Join-Path $env:LOCALAPPDATA "Codistan\Acquisition")
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

# This command removes only known Sales Automation/Acquisition launch registrations.
# It never deletes or recreates the operational state root.
$knownNamePattern = '(?i)^(Codistan Sales Automation|Codistan Acquisition|Sales Automation|Acquisition V4|Acquisition V5|Prospecting\s+OS)(?:\.lnk)?$'
$knownValuePattern = '(?i)(START-SALES-AUTOMATION\.cmd|START-ACQUISITION-V4\.cmd|acquisition_v4\.supervisor|Codistan\\Acquisition)'
$removed = New-Object System.Collections.Generic.List[string]
$warnings = New-Object System.Collections.Generic.List[string]

function Add-Removal([string]$Description) {
    [void]$removed.Add($Description)
}

function Add-Warning([string]$Description) {
    [void]$warnings.Add($Description)
}

function Get-OptionalPropertyValue {
    param(
        [AllowNull()][object]$InputObject,
        [Parameter(Mandatory = $true)][string]$Name,
        [AllowNull()][object]$DefaultValue = $null
    )
    if ($null -eq $InputObject) { return $DefaultValue }
    $property = $InputObject.PSObject.Properties[$Name]
    if ($null -eq $property) { return $DefaultValue }
    return $property.Value
}

function Test-KnownLaunch([string]$Name, [string]$Value = "") {
    return ($Name -match $knownNamePattern) -or ($Value -match $knownValuePattern)
}

function Remove-StartupShortcuts {
    $startupFolders = @(
        [Environment]::GetFolderPath("Startup"),
        [Environment]::GetFolderPath("CommonStartup")
    ) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -Unique

    foreach ($folder in $startupFolders) {
        foreach ($item in @(Get-ChildItem -Path $folder -File -ErrorAction SilentlyContinue)) {
            $baseName = [IO.Path]::GetFileNameWithoutExtension([string]$item.Name)
            $target = ""
            if ([string]$item.Extension -ieq ".lnk") {
                try {
                    $shell = New-Object -ComObject WScript.Shell
                    $shortcut = $shell.CreateShortcut([string]$item.FullName)
                    $target = "{0} {1}" -f [string]$shortcut.TargetPath, [string]$shortcut.Arguments
                } catch {
                    Add-Warning "Could not inspect startup shortcut: $([string]$item.FullName)"
                }
            }
            if (Test-KnownLaunch $baseName $target) {
                try {
                    Remove-Item -Path ([string]$item.FullName) -Force -ErrorAction Stop
                    Add-Removal "Startup shortcut: $([string]$item.FullName)"
                } catch {
                    Add-Warning "Could not remove startup shortcut: $([string]$item.FullName)"
                }
            }
        }
    }
}

function Remove-RunEntries {
    $runKeys = @(
        "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run",
        "HKCU:\Software\Microsoft\Windows\CurrentVersion\RunOnce",
        "HKLM:\Software\Microsoft\Windows\CurrentVersion\Run",
        "HKLM:\Software\Microsoft\Windows\CurrentVersion\RunOnce",
        "HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Run",
        "HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\RunOnce"
    )

    foreach ($key in $runKeys) {
        if (-not (Test-Path $key)) { continue }
        try {
            $properties = Get-ItemProperty -Path $key -ErrorAction Stop
            foreach ($property in $properties.PSObject.Properties) {
                if ($property.Name -like "PS*") { continue }
                if (Test-KnownLaunch $property.Name ([string]$property.Value)) {
                    Remove-ItemProperty -Path $key -Name $property.Name -Force -ErrorAction Stop
                    Add-Removal "Registry startup entry: ${key}::$($property.Name)"
                }
            }
        } catch {
            Add-Warning "Could not inspect or update registry startup key: $key"
        }
    }
}

function Convert-ScheduledTaskActionToText {
    param([AllowNull()][object]$Action)
    if ($null -eq $Action) { return "" }

    $parts = New-Object System.Collections.Generic.List[string]
    foreach ($propertyName in @("Execute", "Arguments", "WorkingDirectory", "ClassId", "Data")) {
        $value = Get-OptionalPropertyValue -InputObject $Action -Name $propertyName
        if ($null -eq $value) { continue }
        $text = [string]$value
        if (-not [string]::IsNullOrWhiteSpace($text)) { [void]$parts.Add($text) }
    }

    if ($parts.Count -eq 0) {
        $fallback = [string]$Action
        if (-not [string]::IsNullOrWhiteSpace($fallback)) { [void]$parts.Add($fallback) }
    }
    return ($parts -join " ")
}

function Remove-ScheduledTasks {
    try {
        $tasks = @(Get-ScheduledTask -ErrorAction Stop)
    } catch {
        Add-Warning "Scheduled Tasks could not be inspected."
        return
    }

    foreach ($task in $tasks) {
        $actions = @(Get-OptionalPropertyValue -InputObject $task -Name "Actions" -DefaultValue @())
        $actionText = (@($actions | ForEach-Object { Convert-ScheduledTaskActionToText -Action $_ }) -join " ")
        $taskName = [string](Get-OptionalPropertyValue -InputObject $task -Name "TaskName" -DefaultValue "")
        $taskPath = [string](Get-OptionalPropertyValue -InputObject $task -Name "TaskPath" -DefaultValue "")
        $taskPathAndName = "{0}{1}" -f $taskPath, $taskName
        if ((Test-KnownLaunch $taskName $actionText) -or ($taskPathAndName -match '(?i)(Codistan.*(Sales Automation|Acquisition)|Prospecting\s+OS)')) {
            try {
                if ([string]::IsNullOrWhiteSpace($taskName)) {
                    Add-Warning "A matching Scheduled Task had no TaskName and was not removed."
                    continue
                }
                Unregister-ScheduledTask -TaskName $taskName -TaskPath $taskPath -Confirm:$false -ErrorAction Stop
                Add-Removal "Scheduled Task: $taskPathAndName"
            } catch {
                Add-Warning "Could not remove Scheduled Task: $taskPathAndName"
            }
        }
    }
}

function Remove-StartupApprovedEntries {
    $approvedKeys = @(
        "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run",
        "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run32",
        "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\StartupFolder",
        "HKLM:\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run",
        "HKLM:\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run32",
        "HKLM:\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\StartupFolder"
    )

    foreach ($key in $approvedKeys) {
        if (-not (Test-Path $key)) { continue }
        try {
            $properties = Get-ItemProperty -Path $key -ErrorAction Stop
            foreach ($property in $properties.PSObject.Properties) {
                if ($property.Name -like "PS*") { continue }
                if ($property.Name -match $knownNamePattern) {
                    Remove-ItemProperty -Path $key -Name $property.Name -Force -ErrorAction Stop
                    Add-Removal "StartupApproved entry: ${key}::$($property.Name)"
                }
            }
        } catch {
            Add-Warning "Could not inspect or update StartupApproved key: $key"
        }
    }
}

Remove-StartupShortcuts
Remove-RunEntries
Remove-ScheduledTasks
Remove-StartupApprovedEntries

Write-Host "Sales Automation legacy auto-start cleanup complete."
Write-Host "Operational state preserved at: $StateRoot"
if ($removed.Count -eq 0) {
    Write-Host "No matching auto-start registrations were found."
} else {
    foreach ($entry in $removed) { Write-Host "Removed: $entry" }
}
foreach ($warning in $warnings) { Write-Warning $warning }
