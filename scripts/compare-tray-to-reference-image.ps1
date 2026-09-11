$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
foreach ($page in @('overview','requests','models','deepseek')) {
    $ref = [System.Drawing.Bitmap]::FromFile('D:\dashboard\reference\' + $page + '.png')
    # The 1:1 renders live in dist\tray\measure, which preview-tray.ps1 does not touch.
    $tray = [System.Drawing.Bitmap]::FromFile('D:\dashboard\dist\tray\measure\' + $page + '.png')
    $w = [int][Math]::Round($ref.Width / 1.5); $h = [int][Math]::Round($ref.Height / 1.5)
    $css = New-Object System.Drawing.Bitmap -ArgumentList $w, $h
    $g = [System.Drawing.Graphics]::FromImage($css)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.DrawImage($ref, 0, 0, $w, $h)
    $g.Dispose()
    $out = New-Object System.Drawing.Bitmap -ArgumentList $w, ($h + [Math]::Min($tray.Height, 981) + 24)
    $g2 = [System.Drawing.Graphics]::FromImage($out)
    $g2.Clear([System.Drawing.Color]::FromArgb(30,30,34))
    $g2.DrawImage($css, 0, 0)
    $g2.DrawImage($tray, 0, $h + 24, $w, [Math]::Min($tray.Height, 981))
    $g2.Dispose()
    $out.Save('D:\dashboard\logs\refcmp-' + $page + '.png', [System.Drawing.Imaging.ImageFormat]::Png)
    $out.Dispose(); $css.Dispose(); $ref.Dispose(); $tray.Dispose()
    Write-Host ('wrote refcmp-' + $page + '.png')
}