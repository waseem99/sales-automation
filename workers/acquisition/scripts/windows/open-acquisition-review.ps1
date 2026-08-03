param(
    [string]$StateRoot = (Join-Path $env:LOCALAPPDATA "Codistan\Acquisition")
)

$ErrorActionPreference = "Stop"
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

$commands = Join-Path $StateRoot "app-current\workers\acquisition"
$reviewPath = Join-Path $StateRoot "review\index.html"
$pythonBootstrap = Join-Path $commands "scripts\windows\python-bootstrap.ps1"

if (Test-Path -LiteralPath $pythonBootstrap) {
    . $pythonBootstrap
    $pythonCommand = Get-CodistanPythonCommand
    if ($pythonCommand) {
        $pythonExecutable = [string](Get-OptionalPropertyValue -InputObject $pythonCommand -Name "Executable" -DefaultValue "")
        $pythonArguments = @(Get-OptionalPropertyValue -InputObject $pythonCommand -Name "Arguments" -DefaultValue @())
        $previousPythonPath = $env:PYTHONPATH
        $env:PYTHONPATH = $commands
        try {
            $reviewCode = "from pathlib import Path; from acquisition_v4.review_v5 import write_review_outputs; write_review_outputs(Path(__import__('sys').argv[1]))"
            & $pythonExecutable @pythonArguments -c $reviewCode $StateRoot | Out-Null
            if ($LASTEXITCODE -ne 0) { throw "The current lead queue could not be generated." }
        } finally {
            $env:PYTHONPATH = $previousPythonPath
        }
    }
}

if (-not (Test-Path -LiteralPath $reviewPath)) {
    throw "The lead desk could not be generated. Start Sales Automation and run the approved source searches first."
}

$browserBootstrap = Join-Path $commands "scripts\windows\chromium-browser.ps1"
if (-not (Test-Path -LiteralPath $browserBootstrap)) {
    throw "The configured-browser module was not found."
}
. $browserBootstrap
$browser = Get-CodistanChromiumBrowser -StateRoot $StateRoot
$reviewUrl = ([System.Uri]::new($reviewPath)).AbsoluteUri
Start-CodistanBrowser -Browser $browser -Arguments @($reviewUrl)

Start-Sleep -Milliseconds 500
$governanceScript = Join-Path $commands "scripts\windows\govern-sales-automation-workspace.ps1"
if (Test-Path -LiteralPath $governanceScript) {
    & $governanceScript -StateRoot $StateRoot -Mode Dedupe -Quiet
}

Write-Host "Opened one governed Codistan Lead Desk tab in the configured Chrome profile. It refreshes every 30 seconds."
