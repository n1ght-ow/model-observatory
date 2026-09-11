param(
    [switch]$Start,
    [switch]$NoBuild,
    [switch]$NoShortcut,
    [switch]$NoStartup
)

$ErrorActionPreference = "Stop"

$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$Exe         = Join-Path $ProjectRoot "dist\tray\RouterMonitorTray.exe"
$Icon        = Join-Path $ProjectRoot "public\router-monitor-tray.ico"
$BuildScript = Join-Path $ProjectRoot "scripts\build-tray.ps1"
$LinkName    = "Router Monitor.lnk"

if (-not $NoBuild) {
    if (-not (Test-Path -LiteralPath $BuildScript)) { throw "missing $BuildScript" }
    & $BuildScript
}
if (-not (Test-Path -LiteralPath $Exe)) { throw "tray executable not found: $Exe" }

function New-Link {
    param([string]$Path, [string]$Target, [string]$Description)
    $dir = Split-Path -Parent $Path
    if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    $shell = New-Object -ComObject WScript.Shell
    $link = $shell.CreateShortcut($Path)
    $link.TargetPath = $Target
    $link.Arguments = ""
    $link.WorkingDirectory = $ProjectRoot
    $link.Description = $Description
    if (Test-Path -LiteralPath $Icon) { $link.IconLocation = "$Icon,0" }
    $link.Save()
    $Path
}

# 1. Desktop shortcut: opens the tray app instead of a browser tab.
if (-not $NoShortcut) {
    $desktop = [Environment]::GetFolderPath("Desktop")
    $path = New-Link -Path (Join-Path $desktop $LinkName) -Target $Exe -Description "Router Monitor - system tray panel"
    Write-Host "shortcut : $path"
}

# 2. Autostart: a Startup-folder shortcut (no elevation needed).
#    Registering an ONLOGON scheduled task requires admin on this machine,
#    so the tray never uses schtasks for its own autostart.
if (-not $NoStartup) {
    $startup = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Startup"
    $path = New-Link -Path (Join-Path $startup "Router Monitor Tray.lnk") -Target $Exe -Description "Router Monitor - system tray panel"
    Write-Host "autostart: $path"
}

# 3. Drop a legacy tray task if an earlier build created one.
$legacy = Get-ScheduledTask -TaskName "Router Monitor Tray" -ErrorAction SilentlyContinue
if ($legacy) {
    Unregister-ScheduledTask -TaskName "Router Monitor Tray" -Confirm:$false
    Write-Host "cleanup  : removed legacy scheduled task 'Router Monitor Tray'"
}

# 4. The web host must NOT auto-start: the tray is the only thing that boots at
#    logon, and it starts the host on demand. Drop the task if an older setup
#    left one behind.
$hostTask = "Router Monitor Dashboard"
$hostEntry = Get-ScheduledTask -TaskName $hostTask -ErrorAction SilentlyContinue
if ($hostEntry) {
    Unregister-ScheduledTask -TaskName $hostTask -Confirm:$false
    Write-Host "cleanup  : removed web logon task '$hostTask' (the tray starts it on demand)"
} else {
    Write-Host "autostart: web host has no logon task (correct)"
}

if ($Start) {
    $running = Get-Process -Name "RouterMonitorTray" -ErrorAction SilentlyContinue
    if ($running) {
        Write-Host "tray     : already running (pid $($running.Id -join ','))"
    } else {
        # Win32_Process.Create starts the tray detached from this shell, so
        # closing the console window does not take the tray down with it.
        $created = $null
        try { $created = ([wmiclass]'Win32_Process').Create($Exe) } catch { $created = $null }
        if (-not $created -or $created.ReturnValue -ne 0) { Start-Process -FilePath $Exe }
        Start-Sleep -Milliseconds 1800
        $p = Get-Process -Name "RouterMonitorTray" -ErrorAction SilentlyContinue
        if ($p) { Write-Host "tray     : started (pid $($p.Id -join ','))" }
        else { throw "tray process did not stay alive" }
    }
}

Write-Host "done"
