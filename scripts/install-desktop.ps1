param([switch]$Start, [switch]$NoBuild)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
if (-not $NoBuild) {
    Push-Location $root
    $previousPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        & npm.cmd run desktop:build
        if ($LASTEXITCODE -ne 0) { throw 'Desktop build failed' }
    } finally { $ErrorActionPreference = $previousPreference; Pop-Location }
}
$version = (Get-Content -LiteralPath (Join-Path $root 'desktop\package.json') -Raw | ConvertFrom-Json).version
$setup = Join-Path $root ('dist\desktop\Model-Observatory-' + $version + '-Setup.exe')
if (-not (Test-Path -LiteralPath $setup)) { throw 'Desktop installer missing. Run npm run desktop:build.' }
$installation = Get-ChildItem 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall' -ErrorAction SilentlyContinue |
    Get-ItemProperty | Where-Object DisplayName -EQ 'Model Observatory' | Select-Object -First 1
$directory = if ($installation.InstallLocation) { $installation.InstallLocation } else { Join-Path $env:LOCALAPPDATA 'Programs\ModelObservatory' }
$exe = Join-Path $directory 'ModelObservatory.exe'
if (Test-Path -LiteralPath $exe) {
    $running = @(Get-Process -Name ModelObservatory -ErrorAction SilentlyContinue | Where-Object Path -EQ $exe)
    $installedVersion = (Get-Item -LiteralPath $exe).VersionInfo.ProductVersion
    if ($running.Count -and [version]$installedVersion -ge [version]'0.2.1') {
        $quit = Start-Process -FilePath $exe -ArgumentList '--quit' -WindowStyle Hidden -PassThru
        if (-not $quit.WaitForExit(15000)) { throw 'Quit request timed out' }
        foreach ($entry in $running) { if (-not $entry.WaitForExit(15000)) { throw 'Application did not exit cleanly' } }
    }
}
# NSIS handles replacing earlier releases that predate the --quit command.
$install = Start-Process -FilePath $setup -ArgumentList '/S' -WindowStyle Hidden -PassThru
if (-not $install.WaitForExit(180000) -or $install.ExitCode -ne 0) { throw 'Desktop installation failed' }
if (-not (Test-Path -LiteralPath $exe)) { throw ('Installed executable not found: ' + $exe) }
Write-Host ('Installed: ' + $exe)
Write-Host 'The source checkout and system Node are not required to run the application.'
if ($Start) { Start-Process -FilePath $exe }
