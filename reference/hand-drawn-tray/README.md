# Superseded: hand-drawn tray panel, replaced by the WebView2 flyout

This directory replaces `../tray`. It is where the GDI+ re-implementation of the
dashboard used to live: 19 C# files and 9,824 lines that redrew the whole front end
by hand, including

- `PanelView.cs`, `Theme.cs`, `Cards.cs`, `Widgets.cs` — the layout and design tokens
- `Glyph.cs` — lucide icon paths copied by hand
- `Kerning.cs` — a 79 KB base64 table extracted from Geist's GPOS data, because
  GDI+ ignores OpenType kerning and every Latin run measured ~2% wide without it
- `Fonts.cs` plus `tray/fonts/` — four static Geist faces embedded in the executable
- `Api.cs`, `Model.cs` — a JSON client and the metric model behind the drawn pages
- `Page*.cs` — one file per dashboard route
- `Measure.cs` — the scroll-height arithmetic that replaced the browser's layout engine

`tray/` now renders `http://127.0.0.1:3000` in a WebView2 control instead, so all of
the above is unnecessary. See the "System tray app" section of the README.

## Why this still exists

It was left behind as reference rather than deleted. The port has no .NET Framework
compiler in this image, so it can only be built on Windows where
`C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe` is present.

```powershell
# on a machine with the .NET Framework compiler
$csc = "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
& $csc /nologo /target:winexe /platform:anycpu /optimize+ /langversion:5 \
  /out:RouterMonitorTray.exe /r:System.dll /r:System.Drawing.dll \
  /r:System.Windows.Forms.dll /r:System.Web.Extensions.dll /r:System.Core.dll \
  /win32icon:..\public\router-monitor-tray.ico /win32manifest:app.manifest \
  *.cs
```

It shares `app.manifest` and the icons in `../public`, and it read the same JSON API
the WebView2 flyout now displays. Nothing else in the repository depends on it.
