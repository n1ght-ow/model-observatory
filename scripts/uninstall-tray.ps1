<#
    Removes what install-tray.ps1 put on the machine.

    install-tray.ps1 wrote a desktop shortcut, a Startup-folder shortcut and started
    the app, and there was no way back other than deleting things by hand.

    Usage:  powershell -ExecutionPolicy Bypass -File scripts\uninstall-tray.ps1
            powershell -ExecutionPolicy Bypass -File scripts\uninstall-tray.ps1 -KeepSettings
#>
param(
    [switch]$KeepSettings,
    [switch]$KeepLogs,
    [switch]$NoStop
)

$ErrorActionPreference = "Stop"

$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$Exe = Join-Path $ProjectRoot "dist\tray\RouterMonitorTray.exe"
$DataDir = Join-Path $env:LOCALAPPDATA "RouterMonitorTray"

# 1. Stop the tray through its own channel first, so the WebView is suspended and
#    disposed rather than killed - a forced kill is what leaves msedgewebview2
#    children holding the profile lock.
if (-not $NoStop) {
    $running = Get-Process -Name "RouterMonitorTray" -ErrorAction SilentlyContinue
    if ($running) {
        if (Test-Path -LiteralPath $Exe) {
            & $Exe --ctl quit | Out-Null
            Start-Sleep -Milliseconds 1500
        }
        $still = Get-Process -Name "RouterMonitorTray" -ErrorAction SilentlyContinue
        if ($still) {
            Write-Host ("tray     : asking politely did not work; stopping pid " + ($still.Id -join ","))
            $still | Stop-Process -Force
        } else {
            Write-Host "tray     : stopped"
        }
    } else {
        Write-Host "tray     : not running"
    }
}

# 2. Shortcuts
$desktop = [Environment]::GetFolderPath("Desktop")
$links = @(
    (Join-Path $desktop "Router Monitor.lnk"),
    (Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Startup\Router Monitor Tray.lnk")
)
foreach ($link in $links) {
    if (Test-Path -LiteralPath $link) {
        Remove-Item -LiteralPath $link -Force
        Write-Host "removed  : $link"
    }
}

# 3. Legacy scheduled tasks from earlier setups
foreach ($task in "Router Monitor Tray", "Router Monitor Dashboard") {
    $entry = Get-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue
    if ($entry) {
        Unregister-ScheduledTask -TaskName $task -Confirm:$false
        Write-Host "removed  : scheduled task $task"
    }
}

# 4. Per-user data: the WebView2 profile, the settings, the logs
$targets = @()
if (-not $KeepSettings) {
    $targets += (Join-Path $DataDir "settings.json")
    $targets += (Join-Path $DataDir "settings.json.bad")
    $targets += (Join-Path $DataDir "WebView2")
}
if (-not $KeepLogs) {
    $targets += (Join-Path $DataDir "logs")
    $targets += (Join-Path $env:TEMP "RouterMonitorTray-crash.log")
}
foreach ($target in $targets) {
    if (Test-Path -LiteralPath $target) {
        Remove-Item -LiteralPath $target -Recurse -Force -ErrorAction SilentlyContinue
        Write-Host "removed  : $target"
    }
}
if (-not $KeepSettings -and (Test-Path -LiteralPath $DataDir)) {
    $left = Get-ChildItem -LiteralPath $DataDir -Force -ErrorAction SilentlyContinue
    if (-not $left) {
        Remove-Item -LiteralPath $DataDir -Force -ErrorAction SilentlyContinue
        Write-Host "removed  : $DataDir"
    }
}

Write-Host ""
Write-Host "The build output (dist\tray) and the repository itself were left alone."
Write-Host "done"
