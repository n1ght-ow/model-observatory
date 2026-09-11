$csc = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$out = 'D:\dashboard\dist\tray\ImageDiff.exe'
$src = 'D:\dashboard\tools\ImageDiff.cs'
& $csc /nologo /langversion:5 /target:exe /platform:anycpu /out:$out /reference:System.Drawing.dll $src
if ($LASTEXITCODE -ne 0) { throw 'compile failed' }
Write-Host ('built ' + $out)