Set-StrictMode -Version Latest

function Get-OptionalPropertyValue {
    param(
        [AllowNull()][object]$InputObject,
        [Parameter(Mandatory = $true)][string]$Name,
        [AllowNull()][object]$DefaultValue = $null
    )
    if ($null -eq $InputObject) { return $DefaultValue }
    if ($InputObject -is [System.Collections.IDictionary]) {
        if ($InputObject.Contains($Name)) { return $InputObject[$Name] }
        return $DefaultValue
    }
    $property = $InputObject.PSObject.Properties[$Name]
    if ($null -eq $property) { return $DefaultValue }
    return $property.Value
}

function Get-NestedOptionalPropertyValue {
    param(
        [AllowNull()][object]$InputObject,
        [Parameter(Mandatory = $true)][string[]]$Path,
        [AllowNull()][object]$DefaultValue = $null
    )
    $current = $InputObject
    foreach ($segment in $Path) {
        $current = Get-OptionalPropertyValue -InputObject $current -Name $segment -DefaultValue $null
        if ($null -eq $current) { return $DefaultValue }
    }
    return $current
}

function Get-CodistanDefaultBrowserHint {
    try {
        $choice = Get-ItemProperty -Path "HKCU:\Software\Microsoft\Windows\Shell\Associations\UrlAssociations\https\UserChoice" -ErrorAction Stop
        return [string](Get-OptionalPropertyValue -InputObject $choice -Name "ProgId" -DefaultValue "")
    } catch {
        return ""
    }
}

function New-CodistanBrowserCandidate {
    param(
        [Parameter(Mandatory = $true)][string]$Id,
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string[]]$ExecutablePaths,
        [Parameter(Mandatory = $true)][string]$ExtensionsUrl,
        [Parameter(Mandatory = $true)][string[]]$ProgIdPatterns,
        [Parameter(Mandatory = $true)][string[]]$ProfileRoots
    )
    return [pscustomobject]@{
        Id = $Id
        Name = $Name
        ExecutablePaths = @($ExecutablePaths | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) })
        ExtensionsUrl = $ExtensionsUrl
        ProgIdPatterns = @($ProgIdPatterns)
        ProfileRoots = @($ProfileRoots | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) })
    }
}

function Get-CodistanBrowserCandidates {
    $programFilesX86 = ${env:ProgramFiles(x86)}

    $chromePaths = @((Join-Path $env:ProgramFiles "Google\Chrome\Application\chrome.exe"))
    if (-not [string]::IsNullOrWhiteSpace($programFilesX86)) {
        $chromePaths += Join-Path $programFilesX86 "Google\Chrome\Application\chrome.exe"
    }
    $chromePaths += Join-Path $env:LOCALAPPDATA "Google\Chrome\Application\chrome.exe"

    $edgePaths = @((Join-Path $env:ProgramFiles "Microsoft\Edge\Application\msedge.exe"))
    if (-not [string]::IsNullOrWhiteSpace($programFilesX86)) {
        $edgePaths += Join-Path $programFilesX86 "Microsoft\Edge\Application\msedge.exe"
    }
    $edgePaths += Join-Path $env:LOCALAPPDATA "Microsoft\Edge\Application\msedge.exe"

    $bravePaths = @((Join-Path $env:ProgramFiles "BraveSoftware\Brave-Browser\Application\brave.exe"))
    if (-not [string]::IsNullOrWhiteSpace($programFilesX86)) {
        $bravePaths += Join-Path $programFilesX86 "BraveSoftware\Brave-Browser\Application\brave.exe"
    }
    $bravePaths += Join-Path $env:LOCALAPPDATA "BraveSoftware\Brave-Browser\Application\brave.exe"

    $candidates = @(
        (New-CodistanBrowserCandidate `
            -Id "opera" `
            -Name "Opera" `
            -ExecutablePaths @(
                (Join-Path $env:LOCALAPPDATA "Programs\Opera\opera.exe"),
                (Join-Path $env:LOCALAPPDATA "Programs\Opera\launcher.exe"),
                (Join-Path $env:ProgramFiles "Opera\opera.exe"),
                (Join-Path $env:ProgramFiles "Opera\launcher.exe")
            ) `
            -ExtensionsUrl "opera://extensions/" `
            -ProgIdPatterns @("Opera") `
            -ProfileRoots @((Join-Path $env:APPDATA "Opera Software\Opera Stable"))),
        (New-CodistanBrowserCandidate `
            -Id "opera_gx" `
            -Name "Opera GX" `
            -ExecutablePaths @(
                (Join-Path $env:LOCALAPPDATA "Programs\Opera GX\opera.exe"),
                (Join-Path $env:LOCALAPPDATA "Programs\Opera GX\launcher.exe")
            ) `
            -ExtensionsUrl "opera://extensions/" `
            -ProgIdPatterns @("Opera GX", "OperaGX") `
            -ProfileRoots @((Join-Path $env:APPDATA "Opera Software\Opera GX Stable"))),
        (New-CodistanBrowserCandidate `
            -Id "chrome" `
            -Name "Google Chrome" `
            -ExecutablePaths $chromePaths `
            -ExtensionsUrl "chrome://extensions/" `
            -ProgIdPatterns @("ChromeHTML") `
            -ProfileRoots @((Join-Path $env:LOCALAPPDATA "Google\Chrome\User Data"))),
        (New-CodistanBrowserCandidate `
            -Id "edge" `
            -Name "Microsoft Edge" `
            -ExecutablePaths $edgePaths `
            -ExtensionsUrl "edge://extensions/" `
            -ProgIdPatterns @("MSEdgeHTM") `
            -ProfileRoots @((Join-Path $env:LOCALAPPDATA "Microsoft\Edge\User Data"))),
        (New-CodistanBrowserCandidate `
            -Id "brave" `
            -Name "Brave" `
            -ExecutablePaths $bravePaths `
            -ExtensionsUrl "brave://extensions/" `
            -ProgIdPatterns @("BraveHTML") `
            -ProfileRoots @((Join-Path $env:LOCALAPPDATA "BraveSoftware\Brave-Browser\User Data")))
    )

    $available = @()
    foreach ($candidate in $candidates) {
        $paths = @(Get-OptionalPropertyValue -InputObject $candidate -Name "ExecutablePaths" -DefaultValue @())
        $executable = @($paths | Where-Object { $_ -and (Test-Path -LiteralPath $_) }) | Select-Object -First 1
        if (-not $executable) { continue }
        $available += [pscustomobject]@{
            Id = [string](Get-OptionalPropertyValue -InputObject $candidate -Name "Id" -DefaultValue "")
            Name = [string](Get-OptionalPropertyValue -InputObject $candidate -Name "Name" -DefaultValue "")
            Executable = [string]$executable
            ExtensionsUrl = [string](Get-OptionalPropertyValue -InputObject $candidate -Name "ExtensionsUrl" -DefaultValue "")
            ProgIdPatterns = @(Get-OptionalPropertyValue -InputObject $candidate -Name "ProgIdPatterns" -DefaultValue @())
            ProfileRoots = @((Get-OptionalPropertyValue -InputObject $candidate -Name "ProfileRoots" -DefaultValue @()) | Where-Object { $_ })
        }
    }
    return @($available)
}

function Get-CodistanChromiumBrowser {
    param([string]$StateRoot = "")

    $available = @(Get-CodistanBrowserCandidates)
    if ($available.Count -eq 0) {
        throw "No supported Chromium browser was found. Install or enable Opera, Google Chrome, Microsoft Edge, or Brave."
    }

    if ($StateRoot) {
        $markerPath = Join-Path $StateRoot "config\browser-extensions-confirmed.json"
        if (Test-Path -LiteralPath $markerPath) {
            try {
                $marker = Get-Content -LiteralPath $markerPath -Raw | ConvertFrom-Json
                $configuredId = [string](Get-OptionalPropertyValue -InputObject $marker -Name "browser_id" -DefaultValue "")
                $configuredExecutable = [string](Get-OptionalPropertyValue -InputObject $marker -Name "browser_executable" -DefaultValue "")
                $configured = $available | Where-Object {
                    [string](Get-OptionalPropertyValue -InputObject $_ -Name "Id" -DefaultValue "") -eq $configuredId -and
                    [string](Get-OptionalPropertyValue -InputObject $_ -Name "Executable" -DefaultValue "") -eq $configuredExecutable
                } | Select-Object -First 1
                if ($configured) { return $configured }
            } catch {}
        }
    }

    $hint = Get-CodistanDefaultBrowserHint
    if ($hint) {
        foreach ($candidate in $available) {
            foreach ($pattern in @(Get-OptionalPropertyValue -InputObject $candidate -Name "ProgIdPatterns" -DefaultValue @())) {
                if ($hint -match [regex]::Escape([string]$pattern)) { return $candidate }
            }
        }
    }

    foreach ($preferredId in @("opera", "opera_gx", "chrome", "edge", "brave")) {
        $candidate = $available | Where-Object {
            [string](Get-OptionalPropertyValue -InputObject $_ -Name "Id" -DefaultValue "") -eq $preferredId
        } | Select-Object -First 1
        if ($candidate) { return $candidate }
    }
    return $available[0]
}

function Get-CodistanBrowserProfileDirectories {
    param([Parameter(Mandatory = $true)][object]$Browser)
    $profiles = @()
    foreach ($root in @(Get-OptionalPropertyValue -InputObject $Browser -Name "ProfileRoots" -DefaultValue @())) {
        if (-not (Test-Path -LiteralPath $root)) { continue }

        if (Test-Path -LiteralPath (Join-Path $root "Preferences")) {
            $profiles += [pscustomobject]@{
                Name = [System.IO.Path]::GetFileName($root)
                Path = $root
                BrowserArgument = ""
            }
        }

        foreach ($directory in @(Get-ChildItem -LiteralPath $root -Directory -ErrorAction SilentlyContinue)) {
            $directoryName = [string](Get-OptionalPropertyValue -InputObject $directory -Name "Name" -DefaultValue "")
            if ($directoryName -ne "Default" -and $directoryName -notlike "Profile *") { continue }
            $directoryPath = [string](Get-OptionalPropertyValue -InputObject $directory -Name "FullName" -DefaultValue "")
            if ([string]::IsNullOrWhiteSpace($directoryPath)) { continue }
            $profiles += [pscustomobject]@{
                Name = $directoryName
                Path = $directoryPath
                BrowserArgument = "--profile-directory=$directoryName"
            }
        }
    }
    return @($profiles)
}

function Find-CodistanBrowserExtension {
    param(
        [Parameter(Mandatory = $true)][object]$Browser,
        [Parameter(Mandatory = $true)][string]$ExtensionName,
        [string]$ExpectedPath = ""
    )

    $normalizedExpectedPath = ""
    if ($ExpectedPath) {
        try { $normalizedExpectedPath = [System.IO.Path]::GetFullPath($ExpectedPath).TrimEnd("\") } catch {}
    }

    foreach ($profile in @(Get-CodistanBrowserProfileDirectories -Browser $Browser)) {
        $profilePath = [string](Get-OptionalPropertyValue -InputObject $profile -Name "Path" -DefaultValue "")
        if ([string]::IsNullOrWhiteSpace($profilePath)) { continue }
        foreach ($preferenceName in @("Preferences", "Secure Preferences")) {
            $preferencePath = Join-Path $profilePath $preferenceName
            if (-not (Test-Path -LiteralPath $preferencePath)) { continue }
            try {
                $preferences = Get-Content -LiteralPath $preferencePath -Raw | ConvertFrom-Json
                $settings = Get-NestedOptionalPropertyValue -InputObject $preferences -Path @("extensions", "settings") -DefaultValue $null
                if ($null -eq $settings) { continue }
                foreach ($property in $settings.PSObject.Properties) {
                    $setting = $property.Value
                    $storedPath = [string](Get-OptionalPropertyValue -InputObject $setting -Name "path" -DefaultValue "")
                    $manifest = Get-OptionalPropertyValue -InputObject $setting -Name "manifest" -DefaultValue $null
                    $manifestName = [string](Get-OptionalPropertyValue -InputObject $manifest -Name "name" -DefaultValue "")
                    $normalizedStoredPath = ""
                    if ($storedPath) {
                        try { $normalizedStoredPath = [System.IO.Path]::GetFullPath($storedPath).TrimEnd("\") } catch {}
                    }
                    if ($manifestName -eq $ExtensionName -or ($normalizedExpectedPath -and $normalizedStoredPath -eq $normalizedExpectedPath)) {
                        return [pscustomobject]@{
                            Id = [string]$property.Name
                            ProfileName = [string](Get-OptionalPropertyValue -InputObject $profile -Name "Name" -DefaultValue "")
                            ProfilePath = $profilePath
                            BrowserArgument = [string](Get-OptionalPropertyValue -InputObject $profile -Name "BrowserArgument" -DefaultValue "")
                            StoredPath = $storedPath
                        }
                    }
                }
            } catch {
                continue
            }
        }
    }
    return $null
}

function Start-CodistanBrowser {
    param(
        [Parameter(Mandatory = $true)][object]$Browser,
        [Parameter(Mandatory = $true)][string[]]$Arguments
    )
    $executable = [string](Get-OptionalPropertyValue -InputObject $Browser -Name "Executable" -DefaultValue "")
    if ([string]::IsNullOrWhiteSpace($executable) -or -not (Test-Path -LiteralPath $executable)) {
        throw "The configured Chromium browser executable is unavailable."
    }
    Start-Process -FilePath $executable -ArgumentList $Arguments | Out-Null
}
