param(
    [double]$Scale = 0.6,
    [string]$OutputDir,
    [string]$Source = "",
    [string]$Range = "7"
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$ProjectRoot = "D:\dashboard"
$Exe = Join-Path $ProjectRoot "dist\tray\RouterMonitorTray.exe"
if (-not $OutputDir) { $OutputDir = Join-Path $ProjectRoot "dist\tray\preview" }
if (-not (Test-Path -LiteralPath $Exe)) { throw "build the tray first: scripts\build-tray.ps1" }
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

# Every page the flyout can show. Scroll offsets are clamped by the renderer.
$shots = @(
    @{ Name = "overview";   Page = "overview"; Scroll = 0;    Caption = "Overview - stat cards, both trend charts" },
    @{ Name = "requests";   Page = "requests"; Scroll = 0;    Caption = "Requests - filter card and the live log" },
    @{ Name = "models";     Page = "models";   Scroll = 0;    Caption = "Models - switch model and the usage table" },
    @{ Name = "deepseek";   Page = "deepseek"; Scroll = 0;    Caption = "DeepSeek - account, balance, native usage" }
)

$files = @()
foreach ($shot in $shots) {
    $target = Join-Path $OutputDir ("{0}.png" -f $shot.Name)
    $arguments = @("--render", $target, "--scale", $Scale, "--page", $shot.Page,
        "--scroll", $shot.Scroll, "--range", $Range)
    if ($Source) { $arguments += @("--source", $Source) }
    & $Exe @arguments | Out-Null
    if (-not (Test-Path -LiteralPath $target)) { throw "render failed: $target" }
    $files += $target
    Write-Host ("rendered {0}" -f $target)
}

# Stitch the pages into one contact sheet.
$images = $files | ForEach-Object { [System.Drawing.Image]::FromFile($_) }
$gap = 18
$caption = 34
$width = [int](($images | Measure-Object -Property Width -Sum).Sum + $gap * ($images.Count + 1))
$height = [int](($images | Measure-Object -Property Height -Maximum).Maximum + $caption + $gap)
$sheet = New-Object System.Drawing.Bitmap($width, $height)
$graphics = [System.Drawing.Graphics]::FromImage($sheet)
$graphics.Clear([System.Drawing.Color]::FromArgb(24, 24, 27))
$graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
$font = New-Object System.Drawing.Font("Segoe UI", 12, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
$brush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(200, 200, 205))

$x = $gap
for ($i = 0; $i -lt $images.Count; $i++) {
    $graphics.DrawString($shots[$i].Caption, $font, $brush, $x, 10)
    $graphics.DrawImage($images[$i], $x, $caption)
    $x += $images[$i].Width + $gap
}
$graphics.Dispose()
$sheetPath = Join-Path $OutputDir "panel.png"
$sheet.Save($sheetPath, [System.Drawing.Imaging.ImageFormat]::Png)
$sheet.Dispose()
foreach ($image in $images) { $image.Dispose() }
$font.Dispose()
$brush.Dispose()

$size = (Get-Item -LiteralPath $sheetPath).Length
Write-Host ("contact sheet: {0} ({1} KB)" -f $sheetPath, [Math]::Round($size / 1KB, 1))
