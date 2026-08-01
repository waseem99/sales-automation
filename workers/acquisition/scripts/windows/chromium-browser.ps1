Set-StrictMode -Version Latest

function Get-CodistanDefaultBrowserHint {
    try {
        $choice = Get-ItemProperty -Path "HKCU:\Software\Microsoft\Windows\Shell\Associations\UrlAssociations\https\UserChoice" -ErrorAction Stop
        return [string]$choice.ProgId
    } catch {
        return ""
    }
}

function Get-CodistanBrowserCandidates {
    $programFilesX86 = ${env:ProgramFiles(x86)}
    $candidates = @(
        [pscustomobject]@{
            Id = "opera"
            Name = "Opera"
            ExecutablePaths = @(
                (Join-Path $env:LOCALAPPDATA "Programs\Opera\opera.exe"),
                (Join-Path $env:LOCALAPPDATA "Programs\Opera\launcher.exe"),
                (Join-Path $env:ProgramFiles "Opera\opera.exe"),
                (Join-Path $env:ProgramFiles "Opera\launcher.exe")
            )
            ExtensionsUrl = "opera://extensions/"
            ProgIdPatterns = @("Opera")
            ProfileRoots = @(
                (Join-Path $env:APPDATA "Opera Software\Opera Stable")
            )
        },
        [pscustomobject]@{
            Id = "opera_gx"
            Name = "Opera GX"
            ExecutablePaths = @(
                (Join-Path $env:LOCALAPPDATA "Programs\Opera GX\opera.exe"),
                (Join-Path $env:LOCALAPPDATA "Programs\Opera GX\launcher.exe")
            )
            ExtensionsUrl = "opera://extensions/"
            ProgIdPatterns = @("Opera GX", "OperaGX")
            ProfileRoots = @(
                (Join-Path $env:APPDATA "Opera Software\Opera GX Stable")
            )
        },
        [pscustomobject]@{
            Id = "chrome"
            Name = "Google Chrome"
            ExecutablePaths = @(
                (Join-Path $env:ProgramFiles "Google\Chrome\Application\chrome.exe"),
                (if ($programFilesX86) { Join-Path $programFilesX86 "Google\Chrome\Application\chrome.exe" } else { $null }),
                (Join-Path $env:LOCALAPPDATA "Google\Chrome\Application\chrome.exe")
            )
            ExtensionsUrl = "chrome://extensions/"
            ProgIdPatterns = @("ChromeHTML")
            ProfileRoots = @(
                (Join-Path $env:LOCALAPPDATA "Google\Chrome\User Data")
            )
        },
        [pscustomobject]@{
            Id = "edge"
            Name = "Microsoft Edge"
            ExecutablePaths = @(
                (Join-Path $env:ProgramFiles "Microsoft\Edge\Application\msedge.exe"),
                (if ($programFilesX86) { Join-Path $programFilesX86 "Microsoft\Edge\Application\msedge.exe" } else { $null }),
                (Join-Path $env:LOCALAPPDATA "Microsoft\Edge\Application\msedge.exe")
            )
            ExtensionsUrl = "edge://extensions/"
            ProgIdPatterns = @("MSEdgeHTM")
            ProfileRoots = @(
                (Join-Path $env:LOCALAPPDATA "Microsoft\Edge\User Data")
            )
        },
        [pscustomobject]@{
            Id = "brave"
            Name = "Brave"
            ExecutablePaths = @(
                (Join-Path $env:ProgramFiles "BraveSoftware\Brave-Browser\Application\brave.exe"),
                (if ($programFilesX86) { Join-Path $programFilesX86 "BraveSoftware\Brave-Browser\Application\brave.exe" } else { $null }),
                (Join-Path $env:LOCALAPPDATA "BraveSoftware\Brave-Browser\Application\brave.exe")
            )
            ExtensionsUrl = "brave://extensions/"
            ProgIdPatterns = @("BraveHTML")
            ProfileRoots = @(
                (Join-Path $env:LOCALAPPDATA "BraveSoftware\Brave-Browser\User Data")
            )
        }
    )

    $available = foreach ($candidate in $candidates) {
        $executable = @($candidate.ExecutablePaths | Where-Object { $_ -and (Test-Path -LiteralPath $_) }) | Select-Object -First 1
        if (-not $executable) { continue }
        [pscustomobject]@{
            Id = [string]$candidate.Id
            Name = [string]$candidate.Name
            Executable = [string]$executable
            ExtensionsUrl = [string]$candidate.ExtensionsUrl
            ProgIdPatterns = @($candidate.ProgIdPatterns)
            ProfileRoots = @($candidate.ProfileRoots | Where-Object { $_ })
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
                $configured = $available | Where-Object {
                    $_.Id -eq [string]$marker.browser_id -and
                    $_.Executable -eq [string]$marker.browser_executable
                } | Select-Object -First 1
                if ($configured) { return $configured }
            } catch {}
        }
    }

    $hint = Get-CodistanDefaultBrowserHint
    if ($hint) {
        foreach ($candidate in $available) {
            foreach ($pattern in @($candidate.ProgIdPatterns)) {
                if ($hint -match [regex]::Escape([string]$pattern)) { return $candidate }
            }
        }
    }

    # Prefer Opera when installed because the current operator environment commonly uses it,
    # then Chrome, Edge and Brave. The default-browser lookup above always takes precedence.
    foreach ($preferredId in @("opera", "opera_gx", "chrome", "edge", "brave")) {
        $candidate = $available | Where-Object { $_.Id -eq $preferredId } | Select-Object -First 1
        if ($candidate) { return $candidate }
    }
    return $available[0]
}

function Get-CodistanBrowserProfileDirectories {
    param([Parameter(Mandatory = $true)][object]$Browser)
    $profiles = New-Object System.Collections.Generic.List[object]
    foreach ($root in @($Browser.ProfileRoots)) {
        if (-not (Test-Path -LiteralPath $root)) { continue }

        # Opera stores Preferences directly in its profile root.
        if (Test-Path -LiteralPath (Join-Path $root "Preferences")) {
            $profiles.Add([pscustomobject]@{
                Name = [System.IO.Path]::GetFileName($root)
                Path = $root
                BrowserArgument = ""
            }) | Out-Null
        }

        foreach ($directory in @(Get-ChildItem -LiteralPath $root -Directory -ErrorAction SilentlyContinue)) {
            if ($directory.Name -ne "Default" -and $directory.Name -notlike "Profile *") { continue }
            $profiles.Add([pscustomobject]@{
                Name = $directory.Name
                Path = $directory.FullName
                BrowserArgument = "--profile-directory=$($directory.Name)"
            }) | Out-Null
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
        foreach ($preferenceName in @("Preferences", "Secure Preferences")) {
            $preferencePath = Join-Path $profile.Path $preferenceName
            if (-not (Test-Path -LiteralPath $preferencePath)) { continue }
            try {
                $preferences = Get-Content -LiteralPath $preferencePath -Raw | ConvertFrom-Json
                $settings = $preferences.extensions.settings
                if (-not $settings) { continue }
                foreach ($property in $settings.PSObject.Properties) {
                    $setting = $property.Value
                    $storedPath = [string]$setting.path
                    $manifestName = [string]$setting.manifest.name
                    $normalizedStoredPath = ""
                    if ($storedPath) {
                        try { $normalizedStoredPath = [System.IO.Path]::GetFullPath($storedPath).TrimEnd("\") } catch {}
                    }
                    if ($manifestName -eq $ExtensionName -or ($normalizedExpectedPath -and $normalizedStoredPath -eq $normalizedExpectedPath)) {
                        return [pscustomobject]@{
                            Id = [string]$property.Name
                            ProfileName = [string]$profile.Name
                            ProfilePath = [string]$profile.Path
                            BrowserArgument = [string]$profile.BrowserArgument
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
    Start-Process -FilePath ([string]$Browser.Executable) -ArgumentList $Arguments | Out-Null
}
