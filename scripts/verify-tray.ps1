<#
    One-command evidence run for the WebView2 tray, and a gate that can fail.

    It drives the tray that is already running - through the control channel -
    rather than starting a second one, and it exits non-zero when a threshold is
    missed. The thresholds are parameters, so tightening one is how this is tested:

        powershell -ExecutionPolicy Bypass -File scripts\verify-tray.ps1 -MaxReopenMs 1
        echo $LASTEXITCODE   # 1

    Produces logs/verify/*.txt (raw) and docs/tray-evidence.md (a dated summary with
    the commit, which is the part that belongs in the repository).

    Usage:  powershell -ExecutionPolicy Bypass -File scripts\verify-tray.ps1
#>
param(
    [int]$HoldMs = 15000,
    [int]$MaxReopenMs = 200,
    [int]$MaxHiddenCpuMs = 20,
    [int]$MaxRouteChangeMs = 500,
    [int]$MinHiddenSamples = 10,
    [int]$MinShotKb = 20,
    [switch]$SkipShots,
    [switch]$SkipE2E
)

$ErrorActionPreference = "Stop"
$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$Exe = Join-Path $ProjectRoot "dist\tray\RouterMonitorTray.exe"
$Scratch = Join-Path $ProjectRoot "logs\verify"
$ShotDir = Join-Path $ProjectRoot "preview\tray"
$Report = Join-Path $Scratch "report.txt"

if (-not (Test-Path -LiteralPath $Exe)) {
    throw "Tray executable not found: $Exe (run scripts\build-tray.ps1 first)"
}
New-Item -ItemType Directory -Path $Scratch -Force | Out-Null
New-Item -ItemType Directory -Path $ShotDir -Force | Out-Null

$log = New-Object System.Collections.Generic.List[string]
$failures = New-Object System.Collections.Generic.List[string]

# A run that throws part way through must not leave the panel pinned: the pin exists
# only so this script can hold a flyout on screen, and it is restored on the way out.
trap {
    try { Set-StayOpen "false" | Out-Null } catch { }
    throw
}

function Say([string]$text) {
    $log.Add($text)
    Write-Host $text
}

function Assert-That([string]$name, [bool]$ok, [string]$detail) {
    if ($ok) {
        Say ("  ok    {0,-42} {1}" -f $name, $detail)
    } else {
        Say ("  FAIL  {0,-42} {1}" -f $name, $detail)
        $failures.Add("$name ($detail)")
    }
}

# -ArgumentList joins with spaces and does not quote, so an argument containing a
# space silently becomes two arguments. Quote those.
function Quote-Arg([string]$value) {
    if ($value -match "\s") { return '"' + $value + '"' }
    return $value
}

function Invoke-Exe([string[]]$exeArgs, [int]$timeoutMs) {
    $quoted = @($exeArgs | ForEach-Object { Quote-Arg $_ })
    $p = Start-Process -FilePath $Exe -ArgumentList $quoted -PassThru
    $p.WaitForExit($timeoutMs) | Out-Null
    if (-not $p.HasExited) {
        Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
        return @{ code = -1; lines = @() }
    }
    $content = @()
    $reportPath = $null
    for ($i = 0; $i -lt $exeArgs.Count - 1; $i++) {
        if ($exeArgs[$i] -eq "--report") { $reportPath = $exeArgs[$i + 1] }
    }
    if ($reportPath -and (Test-Path -LiteralPath $reportPath)) {
        $content = @(Get-Content -LiteralPath $reportPath)
    }
    return @{ code = $p.ExitCode; lines = $content }
}

function Invoke-Ctl([string]$cmd, [string[]]$extra) {
    # --report is how the answer comes back: without it the reply only reaches the
    # attached console, and a script sees an empty result.
    $reportPath = Join-Path $Scratch ("ctl-" + $cmd + ".txt")
    Remove-Item -LiteralPath $reportPath -Force -ErrorAction SilentlyContinue
    $ctrlArgs = @("--ctl", $cmd)
    if ($extra) { $ctrlArgs += $extra }
    $ctrlArgs += @("--report", $reportPath)
    return Invoke-Exe $ctrlArgs 120000
}

# Synthesises Alt+A through the same input queue Windows uses, so this exercises the
# real WM_HOTKEY path rather than calling the handler directly.
# A flyout hides as soon as it loses activation - that is the documented behaviour
# ("失焦隐藏"), not a fault. A script, however, cannot hold activation: this gate runs
# in a console that takes focus back, so an unpinned panel shows and vanishes within a
# second or two and every assertion that needs a live document fails on timing rather
# than on behaviour. Pinning it for those sections removes that race without touching
# what is being measured, and the previous value is restored when the run ends.
function Set-StayOpen([string]$value) {
    $result = Invoke-Ctl "config" @("--arg", "key=stayOpen", "--arg", ("value=" + $value))
    return $result.code -eq 0
}

function Read-StayOpen {
    $settings = (Invoke-Ctl "config").lines
    return (Read-Field $settings "stayOpen")
}

function Send-AltA {
    if (-not ("HotkeySender" -as [type])) {
        $source = @(
            'using System;',
            'using System.Runtime.InteropServices;',
            'public class HotkeySender {',
            '    [DllImport("user32.dll")]',
            '    public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);',
            '    public static void AltA() {',
            '        keybd_event(0x12, 0, 0, UIntPtr.Zero);',
            '        System.Threading.Thread.Sleep(30);',
            '        keybd_event(0x41, 0, 0, UIntPtr.Zero);',
            '        System.Threading.Thread.Sleep(30);',
            '        keybd_event(0x41, 0, 2, UIntPtr.Zero);',
            '        System.Threading.Thread.Sleep(30);',
            '        keybd_event(0x12, 0, 2, UIntPtr.Zero);',
            '    }',
            '}'
        ) -join [char]10
        Add-Type -TypeDefinition $source
    }
    [HotkeySender]::AltA()
}

function Read-Field([string[]]$lines, [string]$label) {
    $pattern = "^" + [regex]::Escape($label) + "\s*:\s*(.*)$"
    foreach ($line in $lines) {
        if ($line -match $pattern) { return $Matches[1].Trim() }
    }
    return $null
}

function Median-Of([double[]]$values) {
    if ($values.Count -eq 0) { return 0 }
    $sorted = @($values | Sort-Object)
    return $sorted[[int][math]::Floor($sorted.Count / 2)]
}

function Metric-Values([string[]]$lines, [string]$phase, [string]$metric) {
    $pattern = "^sample\s+" + $phase + "\s+.*" + $metric + "=\s*([0-9.]+)"
    $values = @()
    foreach ($line in $lines) {
        if ($line -match $pattern) { $values += [double]$Matches[1] }
    }
    return $values
}

# ---------------------------------------------------------------- 0. environment
Say "=== Router Monitor tray verification ==="
Say ("date            : " + (Get-Date -Format "yyyy-MM-dd HH:mm:ss"))
Say ("executable      : " + $Exe + "  (" + ("{0:N1} KB" -f ((Get-Item -LiteralPath $Exe).Length / 1KB)) + ")")
$commit = (& git -C $ProjectRoot rev-parse --short HEAD 2>$null)
if (-not $commit) { $commit = "(unknown)" }
$dirty = (& git -C $ProjectRoot status --porcelain 2>$null)
Say ("commit          : " + $commit + $(if ($dirty) { " + uncommitted changes" } else { "" }))

# ------------------------------------------------- 0b. measure the current build
# next start reads its build manifest when it starts, so a rebuild under a running
# server leaves it serving the previous build's chunk names - the flyout would then be
# measured against stale JavaScript and report on code that no longer exists. The
# server is restarted (the script rebuilds too, if a source is newer than .next) so
# every number below belongs to the source in the working tree.
Say ""
Say "--- bringing the server onto the current build ---"
$starter = Join-Path $ProjectRoot "scripts\start-dashboard.ps1"
# Created through WMI, not Process.Start: a plain child inherits this script's stdout,
# so anything piping this gate (verify-tray.ps1 | Tee-Object ...) would wait for the
# server to exit - which it never does. WMI gives a process that is nobody's child.
$cmdLine = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File $starter -Port 3000 -Restart"
$created = ([wmiclass]"Win32_Process").Create($cmdLine)
if (-not $created -or $created.ReturnValue -ne 0) {
    Say ("  warning: could not restart the server (Win32_Process.Create returned " + $(if ($created) { $created.ReturnValue } else { "nothing" }) + ")")
}
$healthUrl = "http://127.0.0.1:3000/api/health"
$serving = $false
for ($i = 0; $i -lt 240; $i++) {
    Start-Sleep -Milliseconds 1000
    try {
        $response = Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -TimeoutSec 3
        if ($response.StatusCode -eq 200 -and $response.Content -match "router-monitor-dashboard") { $serving = $true; break }
    } catch { }
}
Assert-That "server is serving the current build" $serving "waited $i s"

# A tray older than the executable on disk would be measured as if it were current.
$trayProcess = Get-Process -Name "RouterMonitorTray" -ErrorAction SilentlyContinue | Select-Object -First 1
$exeWritten = (Get-Item -LiteralPath $Exe).LastWriteTime
$stale = $false
if ($trayProcess) { $stale = $trayProcess.StartTime -lt $exeWritten }
Assert-That "running tray is not older than the executable" (-not $stale) $(if ($trayProcess) { "started " + $trayProcess.StartTime.ToString("HH:mm:ss") + ", exe written " + $exeWritten.ToString("HH:mm:ss") } else { "no tray running" })
# ---------------------------------------------------------------- 1. the tray
Say ""
Say "--- tray ---"
$ping = Invoke-Ctl "ping"
$trayPid = Read-Field $ping.lines "pid"
Assert-That "tray answers the control channel" ($ping.code -eq 0 -and $trayPid) "pid $trayPid"
Assert-That "local server is serving" ((Read-Field $ping.lines "server serving") -eq "yes") "$(Read-Field $ping.lines 'server serving')"

# Pin for the sections that need a panel which stays on screen, and remember what it
# was so the run leaves the user settings as it found them.
$previousStayOpen = Read-StayOpen
Set-StayOpen "true" | Out-Null
Say ("  (panel pinned for the live checks; was stayOpen=" + $previousStayOpen + ")")

# ---------------------------------------------------------------- 2. render probe
Say ""
Say "--- render probe ---"
$probeReport = Join-Path $Scratch "probe.txt"
Remove-Item -LiteralPath $probeReport -Force -ErrorAction SilentlyContinue
Invoke-Ctl "show" | Out-Null
Start-Sleep -Milliseconds 2500
$probe = Invoke-Exe @("--probe", "--report", $probeReport) 180000
Assert-That "--probe exits 0" ($probe.code -eq 0) "exit $($probe.code)"
foreach ($line in $probe.lines) { Say ("  " + $line) }

# The layout is pinned to 1688x935 CSS pixels. At 85% the window is sized in whole
# physical pixels and the viewport is that divided by the device pixel ratio, so it
# lands one pixel wide of the target - which is why this is a tolerance and not an
# equality, and why the measured value is recorded rather than rounded away.
$viewport = Read-Field $probe.lines "css viewport"
$viewportOk = $false
if ($viewport -match "^(\d+)x(\d+)$") {
    $vw = [int]$Matches[1]
    $vh = [int]$Matches[2]
    $viewportOk = ([math]::Abs($vw - 1688) -le 1) -and ([math]::Abs($vh - 935) -le 1)
}
Assert-That "CSS viewport is 1688x935 (within 1 px)" $viewportOk "$viewport"
$dpr = Read-Field $probe.lines "device pixel r"
$dprValue = 0.0
if ($dpr -match "^([0-9.]+)") { $dprValue = [double]$Matches[1] }
Assert-That "device pixel ratio is positive" ($dprValue -gt 0) "$dpr"
$bridge = Read-Field $probe.lines "escape bridge"
Assert-That "escape bridge is protocol v1" ($bridge -eq "v1") "$bridge"
Assert-That "content is ready" ((Read-Field $probe.lines "content ready") -eq "yes") "$(Read-Field $probe.lines 'content ready')"
Assert-That "webview did not fail" ((Read-Field $probe.lines "webview failed") -eq "no") "$(Read-Field $probe.lines 'webview failed')"
Assert-That "panel is visible" ((Read-Field $probe.lines "panel visible") -eq "yes") "$(Read-Field $probe.lines 'panel visible')"

# ------------------------------------------------- 2b. flyout page (tray only)
# Only the tray can run script inside its own WebView, so these are the page
# behaviours that cannot be checked from a browser at all.
Say ""
Say "--- flyout page behaviour ---"
$evalFile = Join-Path $Scratch "eval.js"
function Invoke-Eval([string]$script) {
    [System.IO.File]::WriteAllText($evalFile, $script, (New-Object System.Text.UTF8Encoding($false)))
    $result = Invoke-Ctl "eval" @("--arg", ("file=" + $evalFile))
    $value = Read-Field $result.lines "result"
    if (-not $value) { return "" }
    return $value
}

# Selected by data-tray-control rather than aria-label: this script is ASCII-only on
# purpose, because Windows PowerShell reads a BOM-less .ps1 with the ANSI codepage and
# would mangle a Chinese selector into something that matches nothing.
$controlsScript = @'
(function(){
  var close = document.querySelectorAll('[data-tray-control="close"]').length;
  var pin = document.querySelectorAll('[data-tray-control="pin"]').length;
  return String(close) + "|" + String(pin);
})()
'@
# The flyout may be showing a document loaded before the current build, in which case
# it would be measured against stale JavaScript. Reload it onto the dashboard route and
# wait for the page to come back before asserting anything about it.
Invoke-Ctl "reload" | Out-Null
# Wait for the value to be right, not merely well formed: right after a reload the
# server-rendered HTML is up but React has not hydrated, and "0|0" matches a
# number-pipe-number pattern perfectly well. Accepting that would make this assertion
# a race that passes or fails on timing rather than on behaviour.
$controls = ""
for ($i = 0; $i -lt 45; $i++) {
    Start-Sleep -Milliseconds 1000
    $controls = Invoke-Eval $controlsScript
    if ($controls -eq "1|1") { break }
}
Assert-That "flyout shows the tray pin and close" ($controls -eq "1|1") "$controls"

# The injected bridge is what tells the page it is in a tray. If it is missing the
# controls above vanish, so this is the same failure seen from the other side.
$bridgeVersion = Invoke-Eval '(function(){return window.__rmBridge ? String(window.__rmBridge.version) : "(absent)";})()'
Assert-That "page sees the bridge" ($bridgeVersion -eq "1") "version $bridgeVersion"

# The tooltip belongs to the tray, so the page can only reach it through the bridge.
$tooltip = Read-Field (Invoke-Ctl "status").lines "tooltip"
Assert-That "tooltip reports the current route" ($tooltip -like "Router Monitor*") "$tooltip"


# ------------------------------------------------------------- 2c. global hotkey
Say ""
Say "--- global hotkey ---"
$hotkeyLines = (Invoke-Ctl "hotkey").lines
foreach ($line in $hotkeyLines) { Say ("  " + $line) }
$hotkeySpec = Read-Field $hotkeyLines "hotkey"
$hotkeyState = Read-Field $hotkeyLines "hotkey state"
Assert-That "the hotkey is configured" (-not [string]::IsNullOrEmpty($hotkeySpec)) "$hotkeySpec"
# "disabled" and "already taken" are both legitimate states, so this asserts that the
# tray knows which state it is in, not that the key works - a key that silently failed
# to register looks exactly like one that works.
Assert-That "the hotkey reports its state" ($hotkeyState -match "registered|disabled|taken|invalid|waiting") "$hotkeyState"

if ($hotkeyState -match "registered") {
    # Press it for real, and prove the transition rather than just the end state: the
    # panel is hidden first and that has to be confirmed, or "yes -> yes" would pass
    # even if the key did nothing at all.
    Invoke-Ctl "hide" | Out-Null
    Start-Sleep -Milliseconds 1500
    $visibleBefore = Read-Field (Invoke-Ctl "ping").lines "panel visible"
    Assert-That "the panel starts hidden" ($visibleBefore -eq "no") "$visibleBefore"
    Send-AltA
    Start-Sleep -Milliseconds 2500
    $hotkeyPing = (Invoke-Ctl "ping").lines
    $visibleAfter = Read-Field $hotkeyPing "panel visible"
    Assert-That "pressing it summons the panel" ($visibleAfter -eq "yes") "$visibleBefore -> $visibleAfter"

    # The key hides a panel that is in front and summons one that is not, so the second
    # press only dismisses when the first one actually brought it to the front. That is
    # decided inside the process and is reported over the channel; asserting a dismissal
    # when the panel never had focus would be testing the console, not the tray.
    $foreground = Read-Field $hotkeyPing "panel foreground"
    if ($foreground -eq "yes") {
        Send-AltA
        Start-Sleep -Milliseconds 2000
        $visibleAgain = Read-Field (Invoke-Ctl "ping").lines "panel visible"
        Assert-That "pressing it again dismisses the panel" ($visibleAgain -eq "no") "$visibleAfter -> $visibleAgain"
    } else {
        Say "  skip  pressing it again dismisses the panel    (panel is not foreground: a console holds focus, so the key summons rather than dismisses)"
    }
}

# Put the user settings back before anything else can look at them.
Set-StayOpen $previousStayOpen | Out-Null
Say ("  (panel unpinned; stayOpen=" + $previousStayOpen + " restored)")

# ---------------------------------------------------------------- 3. screenshots
Say ""
Say "--- flyout screenshots ---"
if (-not $SkipShots) {
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
        $result = Invoke-Exe @("--shot", $shot, "--page", $page.route, "--report", $rep) 180000
        $kb = 0
        if (Test-Path -LiteralPath $shot) { $kb = [math]::Round((Get-Item -LiteralPath $shot).Length / 1KB, 1) }
        Assert-That ("shot " + $page.name) ($result.code -eq 0 -and $kb -ge $MinShotKb) "$kb KB on $($page.route)"
    }
} else {
    Say "  skipped"
}

# ---------------------------------------------------------------- 4. cycle + CPU
Say ""
Say "--- suspend / warm reopen / interaction / idle CPU ---"
$cycleShot = Join-Path $ShotDir "cycle.png"
$cycleReport = Join-Path $Scratch "cycle.txt"
Remove-Item -LiteralPath $cycleReport -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $cycleShot -Force -ErrorAction SilentlyContinue
$cycle = Invoke-Exe @("--cycle", $cycleShot, "--report", $cycleReport, "--hold", "$HoldMs") 300000
Assert-That "--cycle exits 0" ($cycle.code -eq 0) "exit $($cycle.code)"
foreach ($line in $cycle.lines) {
    if ($line -notlike "sample *") { Say ("  " + $line) }
}

$suspendHidden = Read-Field $cycle.lines "suspend hidden"
Assert-That "Chromium accepted the suspend" ($suspendHidden -eq "suspended") "$suspendHidden"

$reopenRaw = Read-Field $cycle.lines "reopen latency"
$reopenMs = 0
if ($reopenRaw -match "^(\d+)") { $reopenMs = [int]$Matches[1] }
Assert-That "warm reopen within budget" ($reopenMs -gt 0 -and $reopenMs -le $MaxReopenMs) "$reopenMs ms (budget $MaxReopenMs)"

$routeRaw = Read-Field $cycle.lines "route change"
$routeMs = 0
if ($routeRaw -match "after\s+(\d+)\s*ms") { $routeMs = [int]$Matches[1] }
Assert-That "route change within budget" ($routeMs -gt 0 -and $routeMs -le $MaxRouteChangeMs) "$routeMs ms (budget $MaxRouteChangeMs)"

$hiddenCpu = Metric-Values $cycle.lines "hidden" "wv2CpuDelta"
$visibleCpu = Metric-Values $cycle.lines "visible" "wv2CpuDelta"
$hiddenMem = Metric-Values $cycle.lines "hidden" "wv2Mem"
Assert-That "enough hidden samples" ($hiddenCpu.Count -ge $MinHiddenSamples) "$($hiddenCpu.Count) samples"
$hiddenMedian = Median-Of $hiddenCpu
Assert-That "hidden CPU median within budget" ($hiddenMedian -le $MaxHiddenCpuMs) "$hiddenMedian ms per 0.5s (budget $MaxHiddenCpuMs)"

Say ""
Say "  --- derived (median of samples) ---"
Say ("  visible CPU / 0.5s : " + (Median-Of $visibleCpu) + " ms")
Say ("  hidden  CPU / 0.5s : " + $hiddenMedian + " ms")
Say ("  hidden  working set: " + (Median-Of $hiddenMem) + " MB  (Windows trims a suspended process)")

# ---------------------------------------------------------------- 5. page behaviour
Say ""
Say "--- page behaviour in a real browser ---"
$e2eCode = 0
if (-not $SkipE2E) {
    Push-Location $ProjectRoot
    try {
        $e2e = & npm run test:e2e 2>&1
        $e2eCode = $LASTEXITCODE
    } finally {
        Pop-Location
    }
    foreach ($line in $e2e) {
        if ("$line" -match "^\s+(ok|FAIL)\s" -or "$line" -match "^\d+/\d+ passed") { Say ("  " + "$line".TrimEnd()) }
    }
    Assert-That "browser suite passes" ($e2eCode -eq 0) "npm run test:e2e exit $e2eCode"
} else {
    Say "  skipped"
}

# ---------------------------------------------------------------- 6. verdict
Say ""
$passed = ($failures.Count -eq 0)
if ($passed) {
    Say "RESULT: pass"
} else {
    Say ("RESULT: fail - " + $failures.Count + " assertion(s)")
    foreach ($failure in $failures) { Say ("  - " + $failure) }
}

$log | Set-Content -LiteralPath $Report -Encoding UTF8

# The dated summary is the part that belongs in the repository: logs/ is ignored.
$evidenceDir = Join-Path $ProjectRoot "docs"
New-Item -ItemType Directory -Path $evidenceDir -Force | Out-Null
$evidence = Join-Path $evidenceDir "tray-evidence.md"
$result = $(if ($passed) { "pass" } else { "FAIL" })
$summary = New-Object System.Collections.Generic.List[string]
$summary.Add("# Tray evidence")
$summary.Add("")
$summary.Add("Generated by scripts/verify-tray.ps1. Regenerate with:")
$summary.Add("")
$summary.Add("    powershell -ExecutionPolicy Bypass -File scripts\verify-tray.ps1")
$summary.Add("")
$summary.Add("| Run | Commit | Reopen | Route change | Hidden CPU / 0.5s | Hidden samples | Viewport | DPR | Result |")
$summary.Add("| --- | --- | --- | --- | --- | --- | --- | --- | --- |")
$row = "| " + (Get-Date -Format "yyyy-MM-dd HH:mm") + " | " + $commit + " | " + $reopenMs + " ms | " + $routeMs + " ms | " + $hiddenMedian + " ms | " + $hiddenCpu.Count + " | " + $viewport + " | " + $dpr + " | " + $result + " |"
$summary.Add($row)
$summary.Add("")
$summary.Add("Thresholds: reopen <= $MaxReopenMs ms, route change <= $MaxRouteChangeMs ms, hidden CPU median <= $MaxHiddenCpuMs ms per 0.5 s sample.")
$summary.Add("Raw report: logs/verify/report.txt (ignored by git).")
$summary | Set-Content -LiteralPath $evidence -Encoding UTF8

Write-Host ""
Write-Host "report   : $Report"
Write-Host "evidence : $evidence"
Write-Host "result   : $result"

exit $(if ($passed) { 0 } else { 1 })

