param(
    [switch]$Run,
    [string]$OutputDir
)

$ErrorActionPreference = "Stop"
$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$ProjectRoot = "D:\dashboard"
$SourceDir = Join-Path $ProjectRoot "tray"
if (-not $OutputDir) {
    $OutputDir = Join-Path $ProjectRoot "dist\tray"
}
$Csc = "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
$OutExe = Join-Path $OutputDir "RouterMonitorTray.exe"

if (-not (Test-Path -LiteralPath $Csc)) {
    throw "鎵句笉鍒?.NET Framework 缂栬瘧鍣細$Csc"
}

$sources = Get-ChildItem -LiteralPath $SourceDir -Filter *.cs -File | Sort-Object Name
if ($sources.Count -eq 0) {
    throw "娌℃湁鎵惧埌鎵樼洏绋嬪簭婧愪唬鐮侊細$SourceDir"
}

if (-not (Test-Path -LiteralPath $OutputDir)) {
    New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
}

# Refresh the tray icon first so the executable always embeds the latest art.
$iconScript = Join-Path $ProjectRoot "scripts\generate-tray-icon.py"
if (Test-Path -LiteralPath $iconScript) {
    $python = "C:\Python314\python.exe"
    if (-not (Test-Path -LiteralPath $python)) {
        $python = (Get-Command python -ErrorAction SilentlyContinue).Source
    }
    if ($python) {
        & $python $iconScript | Out-Null
    }
}

$iconPath = Join-Path $ProjectRoot "public\router-monitor-tray.ico"
$manifest = Join-Path $SourceDir "app.manifest"

$arguments = @(
    "/nologo",
    "/target:winexe",
    "/platform:anycpu",
    "/optimize+",
    "/langversion:5",
    "/out:$OutExe",
    "/r:System.dll",
    "/r:System.Drawing.dll",
    "/r:System.Windows.Forms.dll",
    "/r:System.Web.Extensions.dll",
    "/r:System.Core.dll"
)
if (Test-Path -LiteralPath $iconPath) {
    $arguments += "/win32icon:$iconPath"
}
if (Test-Path -LiteralPath $manifest) {
    $arguments += "/win32manifest:$manifest"
}
foreach ($source in $sources) {
    $arguments += $source.FullName
}

# The panel draws in Geist, the web font. Embed the static instances generated
# by scripts\generate-tray-fonts.py so the exe carries its own typography.
$fontDir = Join-Path $ProjectRoot (Join-Path "tray" "fonts")
if (Test-Path -LiteralPath $fontDir) {
    foreach ($font in Get-ChildItem -LiteralPath $fontDir -Filter *.ttf -File | Sort-Object Name) {
        $arguments += "/resource:$($font.FullName),$($font.Name)"
    }
}

& $Csc @arguments
if ($LASTEXITCODE -ne 0) {
    throw "缂栬瘧澶辫触锛岄€€鍑虹爜 $LASTEXITCODE"
}

$size = (Get-Item -LiteralPath $OutExe).Length
Write-Host "宸茬敓鎴?$OutExe ($([math]::Round($size / 1KB, 1)) KB)"

if ($Run) {
    Start-Process -FilePath $OutExe
}
