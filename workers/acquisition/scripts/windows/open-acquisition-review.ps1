param(
    [string]$StateRoot = (Join-Path $env:LOCALAPPDATA "Codistan\Acquisition")
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$commands = Join-Path $StateRoot "app-current\workers\acquisition"
$reviewPath = Join-Path $StateRoot "review\index.html"
$pythonBootstrap = Join-Path $commands "scripts\windows\python-bootstrap.ps1"

if (Test-Path -LiteralPath $pythonBootstrap) {
    . $pythonBootstrap
    $pythonCommand = Get-CodistanPythonCommand
    if ($pythonCommand) {
        $pythonExecutable = [string]$pythonCommand.Executable
        $pythonArguments = @($pythonCommand.Arguments)
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
Start-Process -FilePath $reviewPath | Out-Null
Write-Host "Opened the Codistan Lead Desk. It refreshes every 30 seconds."
