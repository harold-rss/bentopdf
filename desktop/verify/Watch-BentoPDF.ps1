<#
.SYNOPSIS
    Watches BentoPDF while it runs and reports every network connection it makes.

.DESCRIPTION
    Uses only Windows' own networking commands (Get-NetTCPConnection and
    Get-NetUDPEndpoint), so the result does not depend on any of BentoPDF's code.

    Every half second it lists the sockets owned by BentoPDF's processes. Any
    connection to another computer is a failure. Connections that stay inside
    this PC (127.0.0.1 / ::1) are listed but do not fail the test.

    Run it, use BentoPDF normally (open, edit, sign, save, try the other
    tools), then close BentoPDF. The report appears when BentoPDF closes and is
    also saved as BentoPDF-network-report.txt on your desktop.

.PARAMETER Launch
    Start BentoPDF from this script (optionally with -PdfPath). Without it,
    start BentoPDF yourself after this script says it is watching.

.PARAMETER PdfPath
    A PDF to open when using -Launch.

.PARAMETER Seconds
    Stop after this many seconds (closing BentoPDF if -Launch was used).
    0 (the default) means: until BentoPDF is closed.

.PARAMETER ExePath
    Full path to BentoPDF.exe, if it is not installed in the usual place.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\Watch-BentoPDF.ps1 -Launch -PdfPath .\sample-contract.pdf
#>
param(
    [switch]$Launch,
    [string]$PdfPath,
    [int]$Seconds = 0,
    [string]$ExePath
)

$ErrorActionPreference = 'Stop'

function Find-BentoPDF {
    if ($ExePath) {
        if (-not (Test-Path -LiteralPath $ExePath)) { throw "Not found: $ExePath" }
        return (Resolve-Path -LiteralPath $ExePath).Path
    }
    $roots = @("$env:LOCALAPPDATA\Programs", $env:ProgramFiles, ${env:ProgramFiles(x86)}) | Where-Object { $_ -and (Test-Path $_) }
    foreach ($root in $roots) {
        $hit = Get-ChildItem -Path $root -Filter 'BentoPDF.exe' -Recurse -Depth 2 -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($hit) { return $hit.FullName }
    }
    throw 'Could not find BentoPDF.exe. Install BentoPDF first, or pass -ExePath "C:\path\to\BentoPDF.exe".'
}

function Test-IsLocalAddress([string]$address) {
    if (-not $address) { return $true }
    return ($address -match '^(127\.|0\.0\.0\.0$|::1$|::$|0:0:0:0:0:0:0:1$|::ffff:127\.)')
}

$exe = Find-BentoPDF
$exeFull = [System.IO.Path]::GetFullPath($exe)
Write-Host ''
Write-Host "Watching: $exeFull" -ForegroundColor Cyan

$started = Get-Date
$outside = @{}   # key -> description, connections to other computers
$local = @{}     # key -> description, connections inside this PC
$udp = @{}       # key -> description, UDP ports opened
$seenIds = @{}
$sawProcess = $false
$app = $null

if ($Launch) {
    $arguments = @()
    if ($PdfPath) { $arguments += '"' + (Resolve-Path -LiteralPath $PdfPath).Path + '"' }
    if ($arguments.Count -gt 0) {
        $app = Start-Process -FilePath $exeFull -ArgumentList $arguments -PassThru
    } else {
        $app = Start-Process -FilePath $exeFull -PassThru
    }
    Write-Host 'BentoPDF started. Use it as normal, then close it to see the report.' -ForegroundColor Cyan
} else {
    Write-Host 'Now start BentoPDF and use it as normal. Close it when done to see the report.' -ForegroundColor Cyan
}
if ($Seconds -gt 0) { Write-Host "Stopping automatically after $Seconds seconds." }
Write-Host ''

while ($true) {
    $procs = @(Get-Process -ErrorAction SilentlyContinue | Where-Object {
        try { $_.Path -and ([System.IO.Path]::GetFullPath($_.Path) -eq $exeFull) } catch { $false }
    })
    $ids = @($procs | ForEach-Object { $_.Id })
    foreach ($id in $ids) { $seenIds[$id] = $true }

    if ($ids.Count -gt 0) {
        $sawProcess = $true

        foreach ($c in @(Get-NetTCPConnection -OwningProcess $ids -ErrorAction SilentlyContinue)) {
            $key = "TCP $($c.LocalAddress):$($c.LocalPort) -> $($c.RemoteAddress):$($c.RemotePort)"
            $text = "$key  [$($c.State)]  (process $($c.OwningProcess))"
            if ($c.State -eq 'Listen') {
                $listenKey = "TCP listening on $($c.LocalAddress):$($c.LocalPort)"
                if (Test-IsLocalAddress $c.LocalAddress) {
                    if (-not $local.ContainsKey($listenKey)) { $local[$listenKey] = "$listenKey  (process $($c.OwningProcess))" }
                } elseif (-not $outside.ContainsKey($listenKey)) {
                    $outside[$listenKey] = "$listenKey  (reachable from other computers)  (process $($c.OwningProcess))"
                    Write-Host "  OUTSIDE  $($outside[$listenKey])" -ForegroundColor Red
                }
            } elseif (Test-IsLocalAddress $c.RemoteAddress) {
                if (-not $local.ContainsKey($key)) { $local[$key] = $text }
            } elseif (-not $outside.ContainsKey($key)) {
                $outside[$key] = $text
                Write-Host "  OUTSIDE  $text" -ForegroundColor Red
            }
        }

        foreach ($u in @(Get-NetUDPEndpoint -OwningProcess $ids -ErrorAction SilentlyContinue)) {
            $key = "UDP $($u.LocalAddress):$($u.LocalPort)"
            if (-not $udp.ContainsKey($key)) {
                $udp[$key] = "$key  (process $($u.OwningProcess))"
                Write-Host "  note     UDP port opened: $key" -ForegroundColor Yellow
            }
        }
    } elseif ($sawProcess) {
        break   # BentoPDF was running and has now closed
    }

    if ($Seconds -gt 0 -and ((Get-Date) - $started).TotalSeconds -ge $Seconds) {
        if ($Launch -and $app) {
            Get-Process -ErrorAction SilentlyContinue | Where-Object {
                try { $_.Path -and ([System.IO.Path]::GetFullPath($_.Path) -eq $exeFull) } catch { $false }
            } | Stop-Process -Force -ErrorAction SilentlyContinue
        }
        break
    }
    Start-Sleep -Milliseconds 500
}

$duration = [int]((Get-Date) - $started).TotalSeconds
$lines = @()
$lines += 'BentoPDF network report'
$lines += "Program:   $exeFull"
$lines += "Watched:   $($started.ToString('yyyy-MM-dd HH:mm:ss')) for $duration seconds, $($seenIds.Count) BentoPDF process(es)"
$lines += ''

if (-not $sawProcess) {
    $lines += 'RESULT: NOT TESTED - BentoPDF was never seen running.'
    $exitCode = 2
} elseif ($outside.Count -eq 0) {
    $lines += 'RESULT: PASS - BentoPDF made no connection to any other computer.'
    $exitCode = 0
} else {
    $lines += "RESULT: FAIL - BentoPDF connected to $($outside.Count) outside address(es):"
    $lines += ($outside.Values | Sort-Object | ForEach-Object { "  $_" })
    $exitCode = 1
}

$lines += ''
$lines += "Connections inside this PC only (not a privacy issue): $($local.Count)"
$lines += ($local.Values | Sort-Object | ForEach-Object { "  $_" })
$lines += "UDP ports opened (a port is not a connection; listed for completeness): $($udp.Count)"
$lines += ($udp.Values | Sort-Object | ForEach-Object { "  $_" })
$lines += ''
$lines += 'Method: Windows Get-NetTCPConnection / Get-NetUDPEndpoint, polled every 0.5 s,'
$lines += 'for every process running BentoPDF.exe. A connection that opens and closes'
$lines += 'within half a second could be missed; for a hard guarantee, also run'
$lines += 'Block-BentoPDF-Network.ps1 so Windows Firewall blocks the program outright.'

Write-Host ''
$lines | ForEach-Object {
    if ($_ -like 'RESULT: PASS*') { Write-Host $_ -ForegroundColor Green }
    elseif ($_ -like 'RESULT:*') { Write-Host $_ -ForegroundColor Red }
    else { Write-Host $_ }
}

try {
    $desktopDir = [Environment]::GetFolderPath('Desktop')
    if ($desktopDir) {
        $report = Join-Path $desktopDir 'BentoPDF-network-report.txt'
        $lines | Set-Content -Path $report -Encoding UTF8
        Write-Host ''
        Write-Host "Report saved to $report"
    }
} catch { }

exit $exitCode
