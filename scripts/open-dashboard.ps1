param(
    [int]$Port = 3000,
    [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"

$ProjectRoot = "D:\dashboard"
$Starter = Join-Path $ProjectRoot "scripts\start-dashboard.ps1"
$Url = "http://127.0.0.1:$Port/"

function Test-Dashboard {
    try {
        $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 3
        return $response.StatusCode -eq 200
    } catch {
        return $false
    }
}

if (-not (Test-Dashboard)) {
    $listening = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    if (-not $listening) {
        # The dashboard host starts on demand. It deliberately has no logon
        # task: the tray is what auto-starts, and it boots the host when the
        # page is actually opened (see README, "Auto-start").
        if (Test-Path -LiteralPath $Starter) {
            Start-Process -FilePath "C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe" `
                -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", `
                    "-File", $Starter, "-Port", "$Port" `
                -WindowStyle Hidden
        }
    }

    $deadline = (Get-Date).AddSeconds(30)
    while ((Get-Date) -lt $deadline -and -not (Test-Dashboard)) {
        Start-Sleep -Milliseconds 700
    }
}

if (-not $NoBrowser) {
    Start-Process $Url
}
