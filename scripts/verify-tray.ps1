<#
    One-command evidence run for the WebView2 tray.

    Produces logs/verify/report.txt containing, in order:
      * the CSS viewport / DPR the flyout actually renders at
      * a screenshot of all five pages taken from the real flyout
      * the cold first-open latency
      * the warm reopen latency after a suspend
      * whether Chromium accepted the suspend
      * process and CPU samples while the panel is visible and while it is hidden

    Usage:  powershell -ExecutionPolicy Bypass -File scripts\verify-tray.ps1
#>
param(
    [int]$HoldMs = 30000,
    [switch]$SkipShots
)

$ErrorActionPreference = "Stop"
$OutputEncoding = [System.Text.Encoding]::UTF8

$ProjectRoot = "D:\dashboard"
$Exe = Join-Path $ProjectRoot "dist\tray\RouterMonitorTray.exe"
$Report = Join-Path $ProjectRoot "logs\verify\report.txt"
$ShotDir = Join-Path $ProjectRoot "preview\tray"
$Scratch = Join-Path $ProjectRoot "logs\verify"

if (-not (Test-Path -LiteralPath $Exe)) {
    throw "Tray executable not found: $Exe (run scripts\build-tray.ps1 first)"
}

New-Item -ItemType Directory -Path $Scratch -Force | Out-Null
New-Item -ItemType Directory -Path $ShotDir -Force | Out-Null

$lines = New-Object System.Collections.Generic.List[string]
function Say([string]$text) {
    $lines.Add($text)
    Write-Host $text
}

function Run-Exe([string[]]$exeArgs, [int]$timeoutMs) {
    $p = Start-Process -FilePath $Exe -ArgumentList $exeArgs -PassThru
    $p.WaitForExit($timeoutMs) | Out-Null
    if (-not $p.HasExited) {
        Stop-Process -Id $p.Id -Force
        return $false
    }
    return $true
}

Say "=== Router Monitor tray verification ==="
Say ("date            : " + (Get-Date -Format "yyyy-MM-dd HH:mm:ss"))
Say ("executable      : " + $Exe)
Say ("executable size : " + ("{0:N1} KB" -f ((Get-Item -LiteralPath $Exe).Length / 1KB)))

# ---------------------------------------------------------------- 0. clean slate
Get-Process -Name RouterMonitorTray -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Milliseconds 700

# ---------------------------------------------------------------- 1. server
$listening = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue
Say ""
Say "--- local server ---"
Say ("port 3000       : " + $(if ($listening) { "listening (pid " + $listening[0].OwningProcess + ")" } else { "not running - the tray will start it" }))

# ---------------------------------------------------------------- 2. probe
Say ""
Say "--- render probe (viewport, DPR, WebView2 core) ---"
$probeReport = Join-Path $Scratch "probe.txt"
Remove-Item -LiteralPath $probeReport -Force -ErrorAction SilentlyContinue
Run-Exe @("--probe", "--report", $probeReport) 180000 | Out-Null
if (Test-Path -LiteralPath $probeReport) {
    foreach ($line in (Get-Content -LiteralPath $probeReport)) { Say ("  " + $line) }
} else {
    Say "  probe produced no report"
}

# ---------------------------------------------------------------- 3. screenshots
if (-not $SkipShots) {
    Say ""
    Say "--- flyout screenshots (one process per page) ---"
    $pages = @(
        @{ name = "overview";     route = "/" },
        @{ name = "requests";     route = "/requests" },
        @{ name = "models";       route = "/models" },
        @{ name = "deepseek";     route = "/deepseek" },
        @{ name = "command-code"; route = "/command-code" }
    )
    foreach ($page in $pages) {
        $shot = Join-Path $ShotDir ($page.name + ".png")
        $rep = Join-Path $Scratch ("shot-" + $page.name + ".txt")
        Remove-Item -LiteralPath $shot -Force -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath $rep -Force -ErrorAction SilentlyContinue
        Run-Exe @("--shot", $shot, "--page", $page.route, "--report", $rep) 180000 | Out-Null
        $ready = "?"
        if (Test-Path -LiteralPath $rep) {
            $hit = Select-String -LiteralPath $rep -Pattern "first content" -ErrorAction SilentlyContinue
            if ($hit) { $ready = ($hit.Line -split ":")[1].Trim() }
        }
        $size = "missing"
        if (Test-Path -LiteralPath $shot) {
            $size = "{0:N1} KB" -f ((Get-Item -LiteralPath $shot).Length / 1KB)
        }
        Say ("  {0,-14} {1,-6} -> {2}  (first content {3})" -f $page.name, $page.route, $size, $ready)
    }
}

# ---------------------------------------------------------------- 4. suspend + CPU
Say ""
Say "--- suspend / warm reopen / idle CPU ---"
$cycleReport = Join-Path $Scratch "cycle.txt"
$cycleShot = Join-Path $ShotDir "cycle.png"
Remove-Item -LiteralPath $cycleReport -Force -ErrorAction SilentlyContinue
Run-Exe @("--cycle", $cycleShot, "--report", $cycleReport, "--hold", "$HoldMs") 300000 | Out-Null

if (Test-Path -LiteralPath $cycleReport) {
    $content = Get-Content -LiteralPath $cycleReport
    foreach ($line in $content) {
        if ($line -notlike "sample *") { Say ("  " + $line) }
    }

    $visible = @($content | Where-Object { $_ -like "sample visible*" })
    $hidden = @($content | Where-Object { $_ -like "sample hidden*" })

    function Median-Metric($rows, [string]$pattern) {
        if ($rows.Count -eq 0) { return 0 }
        $values = @()
        foreach ($row in $rows) {
            if ($row -match $pattern) { $values += [double]$Matches[1] }
        }
        if ($values.Count -eq 0) { return 0 }
        $sorted = @($values | Sort-Object)
        return $sorted[[int]([math]::Floor($sorted.Count / 2))]
    }

    Say ""
    Say "  --- derived (median of samples) ---"
    Say ("  hidden samples     : " + $hidden.Count)
    Say ("  visible CPU / 0.5s : " + (Median-Metric $visible "wv2CpuDelta=\s*([0-9]+)ms") + " ms")
    Say ("  hidden  CPU / 0.5s : " + (Median-Metric $hidden  "wv2CpuDelta=\s*([0-9]+)ms") + " ms")
    Say ("  visible working set: " + (Median-Metric $visible "wv2Mem=\s*([0-9.]+)MB") + " MB  (resident)")
    Say ("  hidden  working set: " + (Median-Metric $hidden  "wv2Mem=\s*([0-9.]+)MB") + " MB  (Windows trims a suspended process)")
    Say ("  hidden  committed  : " + (Median-Metric $hidden  "wv2Committed=\s*([0-9.]+)MB") + " MB  (still committed while suspended)")
    Say ("  tray    working set: " + (Median-Metric $hidden  "trayMem=\s*([0-9.]+)MB") + " MB")
    Say ""
    Say "  --- raw samples ---"
    foreach ($line in $content) {
        if ($line -like "sample *") { Say ("  " + $line) }
    }
} else {
    Say "  cycle produced no report"
}

Write-Output ""
$lines | Set-Content -LiteralPath $Report -Encoding UTF8
Write-Host ""
Write-Host "report written to $Report"
