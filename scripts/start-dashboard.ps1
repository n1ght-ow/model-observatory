param(
    [int]$Port = 3000,
    [switch]$Restart
)

$ErrorActionPreference = "Stop"
$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$ProjectRoot = "D:\dashboard"
$NodeExe = "C:\Program Files\nodejs\node.exe"
$NpmCmd = "C:\Program Files\nodejs\npm.cmd"
$NextBin = Join-Path $ProjectRoot "node_modules\next\dist\bin\next"
$LogDir = Join-Path $ProjectRoot "logs"
$LogFile = Join-Path $LogDir "dashboard.log"
$ServerLogFile = Join-Path $LogDir "dashboard-server.log"
$ServerErrorLogFile = Join-Path $LogDir "dashboard-server-error.log"
$BuildLogFile = Join-Path $LogDir "dashboard-build.log"
$BuildErrorLogFile = Join-Path $LogDir "dashboard-build-error.log"
$BuildId = Join-Path $ProjectRoot ".next\BUILD_ID"

function Write-DashboardLog {
    param([string]$Message)
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Add-Content -LiteralPath $LogFile -Value "[$timestamp] $Message" -Encoding UTF8
}

if (-not (Test-Path -LiteralPath $LogDir)) {
    New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
}

# Keep logs bounded so the dashboard cannot slowly fill the disk.
if (Test-Path -LiteralPath $LogFile) {
    $logItem = Get-Item -LiteralPath $LogFile
    if ($logItem.Length -gt 5MB) {
        Move-Item -LiteralPath $LogFile -Destination "$LogFile.old" -Force
    }
}
foreach ($rotating in @($ServerLogFile, $ServerErrorLogFile, $BuildLogFile, $BuildErrorLogFile)) {
    if (Test-Path -LiteralPath $rotating) {
        $rotatingItem = Get-Item -LiteralPath $rotating
        if ($rotatingItem.Length -gt 5MB) {
            Move-Item -LiteralPath $rotating -Destination "$rotating.old" -Force
        }
    }
}

# Identity, not occupancy. "Something is listening on 3000" is not the same as
# "our dashboard is up": an unrelated service on this port used to make this
# script exit 0 while the tray happily navigated to a stranger.
$AppId = "router-monitor-dashboard"
$HealthUrl = "http://127.0.0.1:$Port/api/health"

function Test-DashboardHealth {
    try {
        $response = Invoke-WebRequest -Uri $HealthUrl -UseBasicParsing -TimeoutSec 3
        return ($response.StatusCode -eq 200 -and $response.Content -match [regex]::Escape($AppId))
    } catch {
        return $false
    }
}

$existing = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($existing) {
    if (Test-DashboardHealth) {
        if (-not $Restart) {
            Write-DashboardLog "Port $Port is already serving this dashboard; leaving it running."
            exit 0
        }
        $owners = @($existing | Select-Object -ExpandProperty OwningProcess -Unique)
        Write-DashboardLog "Restart requested; stopping the dashboard on port $Port (pid $($owners -join ','))."
        foreach ($owner in $owners) {
            Stop-Process -Id $owner -Force -ErrorAction SilentlyContinue
        }
        $deadline = (Get-Date).AddSeconds(15)
        while ((Get-Date) -lt $deadline) {
            if (-not (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)) { break }
            Start-Sleep -Milliseconds 300
        }
    } else {
        Write-DashboardLog "Port $Port is held by another program (no '$AppId' health marker); refusing to fight over it."
        exit 1
    }
}

if (-not (Test-Path -LiteralPath $NodeExe)) {
    Write-DashboardLog "Node.js not found at $NodeExe"
    exit 1
}

if (-not (Test-Path -LiteralPath $NextBin)) {
    Write-DashboardLog "Next.js not found at $NextBin. Run npm install first."
    exit 1
}

Set-Location -LiteralPath $ProjectRoot

$needsBuild = -not (Test-Path -LiteralPath $BuildId)
if (-not $needsBuild) {
    $buildTime = (Get-Item -LiteralPath $BuildId).LastWriteTimeUtc
    $sourcePaths = @(
        (Join-Path $ProjectRoot "src"),
        (Join-Path $ProjectRoot "package.json"),
        (Join-Path $ProjectRoot "package-lock.json"),
        (Join-Path $ProjectRoot "next.config.ts"),
        (Join-Path $ProjectRoot "postcss.config.mjs"),
        (Join-Path $ProjectRoot "tsconfig.json")
    ) | Where-Object { Test-Path -LiteralPath $_ }
    $latestSource = Get-ChildItem -LiteralPath $sourcePaths -Recurse -File -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTimeUtc -Descending |
        Select-Object -First 1
    if ($latestSource -and $latestSource.LastWriteTimeUtc -gt $buildTime) {
        $needsBuild = $true
        Write-DashboardLog "Source changed since last build ($($latestSource.Name)); rebuilding."
    }
}

if ($needsBuild) {
    Write-DashboardLog "Running npm run build."
    $build = Start-Process -FilePath $NpmCmd -ArgumentList "run", "build" `
        -WorkingDirectory $ProjectRoot -NoNewWindow -Wait -PassThru `
        -RedirectStandardOutput $BuildLogFile -RedirectStandardError $BuildErrorLogFile
    if ($build.ExitCode -ne 0) {
        Write-DashboardLog "Build failed with exit code $($build.ExitCode)."
        exit $build.ExitCode
    }
}

Write-DashboardLog "Starting Router Monitor on http://127.0.0.1:$Port"
$server = Start-Process -FilePath $NodeExe `
    -ArgumentList $NextBin, "start", "-H", "127.0.0.1", "-p", "$Port" `
    -WorkingDirectory $ProjectRoot -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput $ServerLogFile -RedirectStandardError $ServerErrorLogFile
$server.WaitForExit()
exit $server.ExitCode
