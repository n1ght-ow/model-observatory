<#
    Downloads a pinned Microsoft.Web.WebView2 NuGet package and installs the
    assemblies the tray compiles against into tray/lib.

    The version is pinned to match the WebView2 Runtime that ships with Edge on
    this machine (152.0.4191.66 -> SDK 1.0.4191.47). Do not point csc at a copy
    of these DLLs from another product's install directory: those versions are
    not under our control.
#>
param(
    [string]$Version = "1.0.4191.47",
    [switch]$Force
)

$ErrorActionPreference = "Stop"

$ProjectRoot = "D:\dashboard"
$LibDir = Join-Path $ProjectRoot "tray\lib"
$versionFile = Join-Path $LibDir "VERSION.txt"

$required = @(
    "Microsoft.Web.WebView2.Core.dll",
    "Microsoft.Web.WebView2.WinForms.dll",
    "WebView2Loader.dll"
)

$present = $true
foreach ($name in $required) {
    if (-not (Test-Path -LiteralPath (Join-Path $LibDir $name))) { $present = $false }
}
if (Test-Path -LiteralPath $versionFile) {
    if ((Get-Content -LiteralPath $versionFile -Raw).Trim() -ne $Version) { $present = $false }
} else {
    $present = $false
}

if ($present -and -not $Force) {
    Write-Host "tray/lib already has WebView2 $Version"
    exit 0
}

$tmp = Join-Path $env:TEMP ("wv2_" + $Version)
$zip = Join-Path $tmp "pkg.zip"
$url = "https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/$Version/microsoft.web.webview2.$Version.nupkg"

if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Recurse -Force }
New-Item -ItemType Directory -Path $tmp -Force | Out-Null

Write-Host "downloading $url"
Invoke-WebRequest -Uri $url -OutFile $zip -TimeoutSec 300
Expand-Archive -LiteralPath $zip -DestinationPath (Join-Path $tmp "x") -Force
$root = Join-Path $tmp "x"

if (-not (Test-Path -LiteralPath $LibDir)) {
    New-Item -ItemType Directory -Path $LibDir -Force | Out-Null
}

Copy-Item -LiteralPath (Join-Path $root "lib\net462\Microsoft.Web.WebView2.Core.dll")     -Destination $LibDir -Force
Copy-Item -LiteralPath (Join-Path $root "lib\net462\Microsoft.Web.WebView2.WinForms.dll") -Destination $LibDir -Force
Copy-Item -LiteralPath (Join-Path $root "runtimes\win-x64\native\WebView2Loader.dll")    -Destination $LibDir -Force
Set-Content -LiteralPath $versionFile -Value $Version -Encoding ASCII

Get-ChildItem -LiteralPath $LibDir | ForEach-Object {
    Write-Host ("  {0,-42} {1,8:N0} KB" -f $_.Name, ($_.Length / 1KB))
}
Write-Host "installed WebView2 $Version into tray/lib"
