<#
    Compiles the tray host.

    Deliberately still uses the .NET Framework compiler that ships with Windows,
    so building needs no .NET SDK. The only third-party references are the two
    WebView2 managed assemblies plus their native loader, all pinned in tray/lib
    by scripts/fetch-webview2.ps1.
#>
param(
    [switch]$Run,
    [string]$OutputDir
)

$ErrorActionPreference = "Stop"
$OutputEncoding = [System.Text.Encoding]::UTF8

$ProjectRoot = "D:\dashboard"
$SourceDir = Join-Path $ProjectRoot "tray"
$LibDir = Join-Path $SourceDir "lib"
if (-not $OutputDir) {
    $OutputDir = Join-Path $ProjectRoot "dist\tray"
}
$Csc = "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
$OutExe = Join-Path $OutputDir "RouterMonitorTray.exe"

if (-not (Test-Path -LiteralPath $Csc)) {
    throw "Missing .NET Framework compiler: $Csc"
}

$sources = Get-ChildItem -LiteralPath $SourceDir -Filter *.cs -File | Sort-Object Name
if ($sources.Count -eq 0) {
    throw "No C# sources found in $SourceDir"
}

$webViewAssemblies = @(
    (Join-Path $LibDir "Microsoft.Web.WebView2.Core.dll"),
    (Join-Path $LibDir "Microsoft.Web.WebView2.WinForms.dll")
)
foreach ($assembly in $webViewAssemblies) {
    if (-not (Test-Path -LiteralPath $assembly)) {
        throw "Missing $assembly - run scripts/fetch-webview2.ps1 first"
    }
}
$nativeLoader = Join-Path $LibDir "WebView2Loader.dll"
if (-not (Test-Path -LiteralPath $nativeLoader)) {
    throw "Missing $nativeLoader - run scripts/fetch-webview2.ps1 first"
}

if (-not (Test-Path -LiteralPath $OutputDir)) {
    New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
}

# Replacing a running executable fails with a bare "access denied" from the
# compiler, which says nothing about the cause. Stop the tray first, and say so.
$running = Get-Process -Name "RouterMonitorTray" -ErrorAction SilentlyContinue
if ($running) {
    Write-Host ("stopping the running tray (pid {0}) to replace the executable" -f ($running.Id -join ','))
    $running | Stop-Process -Force
    Start-Sleep -Milliseconds 600
}

# Refresh the tray icon so the executable always embeds the latest art.
$iconScript = Join-Path $ProjectRoot "scripts\generate-tray-icon.py"
if (Test-Path -LiteralPath $iconScript) {
    $python = "C:\Python314\python.exe"
    if (-not (Test-Path -LiteralPath $python)) {
        $found = Get-Command python -ErrorAction SilentlyContinue
        if ($found) { $python = $found.Source }
    }
    if ($python -and (Test-Path -LiteralPath $python)) {
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
    "/r:System.Management.dll",
    # JavaScriptSerializer, for the control channel's JSON envelope. Part of the
    # .NET Framework the build already uses - not a new dependency.
    "/r:System.Web.Extensions.dll"
)
foreach ($assembly in $webViewAssemblies) {
    $arguments += "/r:$assembly"
}
if (Test-Path -LiteralPath $iconPath) {
    $arguments += "/win32icon:$iconPath"
}
if (Test-Path -LiteralPath $manifest) {
    $arguments += "/win32manifest:$manifest"
}
foreach ($source in $sources) {
    $arguments += $source.FullName
}

& $Csc @arguments
if ($LASTEXITCODE -ne 0) {
    throw "Compilation failed with exit code $LASTEXITCODE"
}

# WebView2 needs the native loader (and the managed assemblies) beside the
# executable. Fonts are no longer embedded: the page renders with the web fonts
# it already ships.
Copy-Item -LiteralPath $nativeLoader -Destination $OutputDir -Force
foreach ($assembly in $webViewAssemblies) {
    Copy-Item -LiteralPath $assembly -Destination $OutputDir -Force
}

$size = (Get-Item -LiteralPath $OutExe).Length
Write-Host ("Built {0} ({1:N1} KB)" -f $OutExe, ($size / 1KB))

if ($Run) {
    Start-Process -FilePath $OutExe
}
