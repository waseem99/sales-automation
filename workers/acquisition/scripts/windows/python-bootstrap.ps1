Set-StrictMode -Version Latest

function Get-CodistanPythonCommand {
    $candidates = New-Object System.Collections.Generic.List[object]

    $py = Get-Command py.exe -ErrorAction SilentlyContinue
    if ($py) {
        $candidates.Add([pscustomobject]@{
            Executable = $py.Source
            Arguments = @("-3.12")
            Label = "Python launcher 3.12"
        }) | Out-Null
    }

    foreach ($commandName in @("python.exe", "python3.exe")) {
        $command = Get-Command $commandName -ErrorAction SilentlyContinue
        if ($command) {
            $candidates.Add([pscustomobject]@{
                Executable = $command.Source
                Arguments = @()
                Label = $commandName
            }) | Out-Null
        }
    }

    $knownPaths = @(
        (Join-Path $env:LOCALAPPDATA "Programs\Python\Python312\python.exe"),
        (Join-Path $env:LOCALAPPDATA "Programs\Python\Python313\python.exe"),
        (Join-Path $env:LOCALAPPDATA "Programs\Python\Python314\python.exe"),
        (Join-Path $env:ProgramFiles "Python312\python.exe"),
        (Join-Path $env:ProgramFiles "Python313\python.exe"),
        (Join-Path $env:ProgramFiles "Python314\python.exe")
    )
    if (${env:ProgramFiles(x86)}) {
        $knownPaths += Join-Path ${env:ProgramFiles(x86)} "Python312\python.exe"
        $knownPaths += Join-Path ${env:ProgramFiles(x86)} "Python313\python.exe"
        $knownPaths += Join-Path ${env:ProgramFiles(x86)} "Python314\python.exe"
    }
    foreach ($path in ($knownPaths | Select-Object -Unique)) {
        if (Test-Path -LiteralPath $path) {
            $candidates.Add([pscustomobject]@{
                Executable = $path
                Arguments = @()
                Label = $path
            }) | Out-Null
        }
    }

    foreach ($candidate in $candidates) {
        try {
            $candidateExecutable = [string]$candidate.Executable
            $candidateArguments = @($candidate.Arguments)
            $version = & $candidateExecutable @candidateArguments -c "import sys; print('.'.join(map(str, sys.version_info[:3]))); raise SystemExit(0 if sys.version_info >= (3, 12) else 1)" 2>$null
            if ($LASTEXITCODE -eq 0) {
                return [pscustomobject]@{
                    Executable = $candidateExecutable
                    Arguments = $candidateArguments
                    Version = ([string]$version).Trim()
                    Label = [string]$candidate.Label
                }
            }
        } catch {
            continue
        }
    }
    return $null
}

function Update-CodistanProcessPath {
    $parts = @(
        [Environment]::GetEnvironmentVariable("Path", "User"),
        [Environment]::GetEnvironmentVariable("Path", "Machine")
    ) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
    $env:Path = ($parts -join ";")
}

function Install-CodistanPythonFromOfficialInstaller {
    param(
        [string]$InstallerUrl = "https://www.python.org/ftp/python/3.12.10/python-3.12.10-amd64.exe"
    )

    $downloadRoot = Join-Path $env:TEMP "Codistan\SalesAutomationBootstrap"
    New-Item -ItemType Directory -Force -Path $downloadRoot | Out-Null
    $installerPath = Join-Path $downloadRoot "python-3.12.10-amd64.exe"

    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Write-Host "Downloading the official Python 3.12 Windows installer..."
    Invoke-WebRequest -UseBasicParsing -Uri $InstallerUrl -OutFile $installerPath

    $signature = Get-AuthenticodeSignature -LiteralPath $installerPath
    $subject = if ($signature.SignerCertificate) { [string]$signature.SignerCertificate.Subject } else { "" }
    if ($signature.Status -ne "Valid" -or $subject -notmatch "(?i)Python Software Foundation") {
        Remove-Item -LiteralPath $installerPath -Force -ErrorAction SilentlyContinue
        throw "The downloaded Python installer did not have a valid Python Software Foundation signature."
    }

    Write-Host "Installing Python 3.12 for the current Windows user..."
    $arguments = @(
        "/quiet",
        "InstallAllUsers=0",
        "PrependPath=1",
        "Include_launcher=1",
        "Include_test=0",
        "Shortcuts=0"
    )
    $process = Start-Process -FilePath $installerPath -ArgumentList $arguments -Wait -PassThru
    if ($process.ExitCode -ne 0) {
        throw "The official Python installer exited with code $($process.ExitCode)."
    }
    Remove-Item -LiteralPath $installerPath -Force -ErrorAction SilentlyContinue
}

function Ensure-CodistanPython {
    $existing = Get-CodistanPythonCommand
    if ($existing) {
        Write-Host "Python $($existing.Version) ready: $($existing.Label)"
        return $existing
    }

    $winget = Get-Command winget.exe -ErrorAction SilentlyContinue
    if ($winget) {
        Write-Host "Installing Python 3.12 with winget..."
        $wingetExecutable = [string]$winget.Source
        & $wingetExecutable install --exact --id Python.Python.3.12 --scope user --accept-package-agreements --accept-source-agreements
        if ($LASTEXITCODE -ne 0) {
            Write-Warning "winget could not install Python. Falling back to the official signed installer."
            Install-CodistanPythonFromOfficialInstaller
        }
    } else {
        Install-CodistanPythonFromOfficialInstaller
    }

    Update-CodistanProcessPath
    $installed = Get-CodistanPythonCommand
    if (-not $installed) {
        throw "Python 3.12 or later was installed but could not be located. Sign out of Windows once, then rerun setup."
    }
    Write-Host "Python $($installed.Version) installed and ready."
    return $installed
}
