param(
    # Reference screenshots taken at 1.5x DPR; the tray renders at 1x CSS pixels.
    [double]$ReferenceScale = 1.5,
    [string]$ReferenceDir = 'D:\dashboard\reference',
    [string]$OutputDir = 'D:\dashboard\logs',
    [string]$TrayDir = 'D:\dashboard\dist\tray\measure',
    [string]$Exe = 'D:\dashboard\dist\tray\RouterMonitorTray.exe',
    [switch]$NoRender
    )

# Compares the tray against the maintainer's own browser screenshots, which are
# the frozen reference the panel is built from - the live app keeps changing, so
# these are the spec.
#
# Three traps this script exists to avoid:
#
#  * The 1:1 renders go to their own directory. scripts\preview-tray.ps1 renders
#    the same page names at a smaller --scale into dist\tray\preview, so sharing
#    one directory silently corrupts whichever runs second.
#  * The four captures came out at slightly different widths (1671..1691 CSS px),
#    so a page can be globally offset against the tray by up to ~8px through no
#    fault of the layout. ImageDiff searches that offset first and scores at the
#    best alignment, so the number measures layout rather than capture width.
#    What the captures do agree on is the invariant: the card grid starts 102-103
#    CSS px right of the sidebar divider, and the tray draws it at 101.
#  * The requests capture still has Windows' Snipping Tool toast over its
#    bottom-right corner. That rectangle is excluded from the score.
$ErrorActionPreference = 'Stop'

$ImageDiff = 'D:\dashboard\dist\tray\ImageDiff.exe'
if (-not (Test-Path -LiteralPath $ImageDiff)) { throw 'run scripts\build-imagediff.ps1 first' }

$pages = @(
    @{ Name = 'overview'; Ref = 'overview.png'; Mask = $null },
    @{ Name = 'requests'; Ref = 'requests.png'; Mask = '1310,742,1700,940' },
    @{ Name = 'models';   Ref = 'models.png';   Mask = $null },
    @{ Name = 'deepseek'; Ref = 'deepseek.png'; Mask = $null }
)

if (-not $NoRender) {
    if (-not (Test-Path -LiteralPath $Exe)) { throw "build the tray first: scripts\build-tray.ps1" }
    New-Item -ItemType Directory -Force -Path $TrayDir | Out-Null
    foreach ($page in $pages) {
        $target = [System.IO.Path]::Combine($TrayDir, $page.Name + '.png')
        & $Exe --render $target --scale 1.0 --page $page.Name | Out-Null
        if (-not (Test-Path -LiteralPath $target)) { throw "render failed: $target" }
    }
}

foreach ($page in $pages) {
    $refPath = [System.IO.Path]::Combine($ReferenceDir, $page.Ref)
    $trayPath = [System.IO.Path]::Combine($TrayDir, $page.Name + '.png')
    if (-not (Test-Path -LiteralPath $refPath)) { Write-Host ('skip ' + $page.Name + ': missing ' + $refPath); continue }
    if (-not (Test-Path -LiteralPath $trayPath)) { Write-Host ('skip ' + $page.Name + ': missing ' + $trayPath); continue }
    $map = [System.IO.Path]::Combine($OutputDir, 'refdiff-' + $page.Name + '.png')
    $arguments = @($refPath, $trayPath, '--map', $map, '--scale', $ReferenceScale)
    if ($page.Mask) { $arguments += @('--mask', $page.Mask) }
    Write-Host ($page.Name.PadRight(10))
    & $ImageDiff @arguments
}