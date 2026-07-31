param(
    [string]$StateRoot = (Join-Path $env:LOCALAPPDATA "Codistan\Acquisition")
)

$ErrorActionPreference = "Stop"

# This command removes only known Sales Automation/Acquisition launch registrations.
# It never deletes or recreates the operational state root.
$knownNamePattern = '(?i)^(Codistan Sales Automation|Codistan Acquisition|Sales Automation|Acquisition V4|Acquisition V5|Prospecting OS)(?:\.lnk)?$'
$knownValuePattern = '(?i)(START-SALES-AUTOMATION\.cmd|START-ACQUISITION-V4\.cmd|acquisition_v4\.supervisor|Codistan\\Acquisition)'
$removed = New-Object System.Collections.Generic.List[string]
$warnings = New-Object System.Collections.Generic.List[string]

function Add-Removal([string]$Description) {
    [void]$removed.Add($Description)
}

function Add-Warning([string]$Description) {
    [void]$warnings.Add($Description)
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
        foreach ($item in (Get-ChildItem -Path $folder -File -ErrorAction SilentlyContinue)) {
            $baseName = [IO.Path]::GetFileNameWithoutExtension($item.Name)
            $target = ""
            if ($item.Extension -ieq ".lnk") {
                try {
                    $shell = New-Object -ComObject WScript.Shell
                    $shortcut = $shell.CreateShortcut($item.FullName)
                    $target = "{0} {1}" -f [string]$shortcut.TargetPath, [string]$shortcut.Arguments
                } catch {
                    Add-Warning "Could not inspect startup shortcut: $($item.FullName)"
                }
            }
            if (Test-KnownLaunch $baseName $target) {
                try {
                    Remove-Item -Path $item.FullName -Force -ErrorAction Stop
                    Add-Removal "Startup shortcut: $($item.FullName)"
                } catch {
                    Add-Warning "Could not remove startup shortcut: $($item.FullName)"
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
                    Add-Removal "Registry startup entry: $key::$($property.Name)"
                }
            }
        } catch {
            Add-Warning "Could not inspect or update registry startup key: $key"
        }
    }
}

function Remove-ScheduledTasks {
    try {
        $tasks = Get-ScheduledTask -ErrorAction Stop
    } catch {
        Add-Warning "Scheduled Tasks could not be inspected."
        return
    }

    foreach ($task in $tasks) {
        $actionText = (($task.Actions | ForEach-Object { "{0} {1}" -f [string]$_.Execute, [string]$_.Arguments }) -join " ")
        $taskName = [string]$task.TaskName
        $taskPathAndName = "{0}{1}" -f [string]$task.TaskPath, $taskName
        if ((Test-KnownLaunch $taskName $actionText) -or ($taskPathAndName -match '(?i)(Codistan.*(Sales Automation|Acquisition)|Prospecting OS)')) {
            try {
                Unregister-ScheduledTask -TaskName $task.TaskName -TaskPath $task.TaskPath -Confirm:$false -ErrorAction Stop
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
                    Add-Removal "StartupApproved entry: $key::$($property.Name)"
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
