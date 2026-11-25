<#
.SYNOPSIS
    Makes Windows Firewall block all network traffic for BentoPDF.

.DESCRIPTION
    Adds two Windows Firewall rules (outbound and inbound) that block
    BentoPDF.exe completely. Windows then enforces "no network" itself,
    whatever the program tries. The rules stay in place when BentoPDF is
    updated, because the program's path does not change.

    Needs to run as administrator: right-click PowerShell, "Run as
    administrator".

.PARAMETER Remove
    Remove the rules again.

.PARAMETER ExePath
    Full path to BentoPDF.exe, if it is not installed in the usual place.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\Block-BentoPDF-Network.ps1
#>
#Requires -RunAsAdministrator
param(
    [switch]$Remove,
    [string]$ExePath
)

$ErrorActionPreference = 'Stop'
$ruleGroup = 'BentoPDF offline'

if ($Remove) {
    Get-NetFirewallRule -Group $ruleGroup -ErrorAction SilentlyContinue | Remove-NetFirewallRule
    Write-Host 'BentoPDF firewall rules removed.' -ForegroundColor Yellow
    exit 0
}

if (-not $ExePath) {
    $roots = @("$env:LOCALAPPDATA\Programs", $env:ProgramFiles, ${env:ProgramFiles(x86)}) | Where-Object { $_ -and (Test-Path $_) }
    foreach ($root in $roots) {
        $hit = Get-ChildItem -Path $root -Filter 'BentoPDF.exe' -Recurse -Depth 2 -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($hit) { $ExePath = $hit.FullName; break }
    }
}
if (-not $ExePath -or -not (Test-Path -LiteralPath $ExePath)) {
    throw 'Could not find BentoPDF.exe. Install BentoPDF first, or pass -ExePath "C:\path\to\BentoPDF.exe".'
}
$exe = (Resolve-Path -LiteralPath $ExePath).Path

# Replace any earlier rules, so running this twice is harmless.
Get-NetFirewallRule -Group $ruleGroup -ErrorAction SilentlyContinue | Remove-NetFirewallRule

foreach ($direction in 'Outbound', 'Inbound') {
    New-NetFirewallRule -DisplayName "BentoPDF - block all network ($direction)" -Group $ruleGroup `
        -Direction $direction -Action Block -Program $exe -Profile Any -Enabled True | Out-Null
}

Write-Host ''
Write-Host "Windows Firewall now blocks all network traffic for:" -ForegroundColor Green
Write-Host "  $exe"
Write-Host ''
Get-NetFirewallRule -Group $ruleGroup | Format-Table DisplayName, Direction, Action, Enabled -AutoSize
Write-Host 'To check later: Windows Security > Firewall & network protection > Advanced settings,'
Write-Host 'then Outbound Rules. To undo: run this script again with -Remove.'
