<#
    Runs inside Windows Sandbox (started by BentoPDF-Sandbox.wsb).

    1. Installs BentoPDF from the test folder.
    2. Opens a PDF from the test folder in BentoPDF, with Watch-BentoPDF.ps1
       recording every network connection.
    3. Shows the report when you close BentoPDF.

    The sandbox has a normal internet connection on purpose, so BentoPDF
    could go online if it tried. Everything in the sandbox is deleted when
    you close the sandbox window.
#>
$ErrorActionPreference = 'Stop'
$testDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $testDir

Write-Host ''
Write-Host '=== BentoPDF privacy test (Windows Sandbox) ===' -ForegroundColor Cyan

$online = Test-NetConnection -ComputerName 'www.microsoft.com' -Port 443 -InformationLevel Quiet -WarningAction SilentlyContinue
if ($online) {
    Write-Host 'Sandbox internet connection: available (good - BentoPDF could go online if it tried).' -ForegroundColor Green
} else {
    Write-Host 'Sandbox internet connection: NOT available. The test still runs, but it is stronger with internet on.' -ForegroundColor Yellow
}

$installer = Get-ChildItem -Path $testDir -Filter 'BentoPDF-Setup-*.exe' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $installer) { throw "No BentoPDF-Setup-*.exe found in $testDir. Copy the installer into the test folder." }
Write-Host "Installing $($installer.Name) ..."
Start-Process -FilePath $installer.FullName -ArgumentList '/S' -Wait
Start-Sleep -Seconds 3

$pdf = Get-ChildItem -Path $testDir -Filter '*.pdf' | Select-Object -First 1
if ($pdf) {
    Write-Host "Opening $($pdf.Name). Try everything: edit, sign, insert an image, save, Tools > All Tools."
    & (Join-Path $testDir 'Watch-BentoPDF.ps1') -Launch -PdfPath $pdf.FullName
} else {
    & (Join-Path $testDir 'Watch-BentoPDF.ps1') -Launch
}

Write-Host ''
Write-Host 'Done. Close the Windows Sandbox window to delete everything in it.' -ForegroundColor Cyan
