$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$logDir = 'D:\dashboard\logs'
$trayDir = 'D:\dashboard\dist\tray\preview'
foreach ($page in @('overview','requests','models','deepseek','command-code')) {
    $a = [System.Drawing.Bitmap]::FromFile([System.IO.Path]::Combine($logDir, 'web-' + $page + '.png'))
    $b = [System.Drawing.Bitmap]::FromFile([System.IO.Path]::Combine($trayDir, $page + '.png'))
    $w = $a.Width; $h = $a.Height
    $out = New-Object System.Drawing.Bitmap -ArgumentList ([int]$w), ([int]($h*2 + 24))
    $g = [System.Drawing.Graphics]::FromImage($out)
    $g.Clear([System.Drawing.Color]::FromArgb(30,30,34))
    $g.DrawImage($a, 0, 0, $w, $h)
    $g.DrawImage($b, 0, $h + 24, $w, $h)
    $font = New-Object System.Drawing.Font -ArgumentList 'Segoe UI', ([float]14), ([System.Drawing.FontStyle]::Bold)
    $brush = New-Object System.Drawing.SolidBrush -ArgumentList ([System.Drawing.Color]::FromArgb(255,120,200,255))
    $g.DrawString('WEB (light 1688x935)', $font, $brush, 8, 3)
    $g.DrawString('TRAY (light 1688x981, page area matched)', $font, $brush, 8, $h + 27)
    $g.Dispose()
    $out.Save([System.IO.Path]::Combine($logDir, 'cmp-' + $page + '.png'), [System.Drawing.Imaging.ImageFormat]::Png)
    $out.Dispose(); $a.Dispose(); $b.Dispose(); $font.Dispose(); $brush.Dispose()
}
Write-Host 'comparisons rebuilt'