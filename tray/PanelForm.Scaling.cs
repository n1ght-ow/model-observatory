using System;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace RouterMonitorTray
{
    /// <summary>
    /// Display scale, the drawn size, and the ZoomFactor that keeps the CSS viewport fixed.
    ///
    /// PanelForm is split across partial files by responsibility, so a new tray
    /// capability is a region in the right file rather than a search through one
    /// 1,400 line class:
    ///
    ///   PanelForm.cs          window chrome, dragging, placement, layout
    ///   PanelForm.Scaling.cs  display scale, drawn size, ZoomFactor
    ///   PanelForm.WebView.cs  the WebView lifecycle
    ///   PanelForm.Bridge.cs   the page/tray protocol and navigation guards
    /// </summary>
    internal sealed partial class PanelForm : Form
    {
        private const double MinUserScale = 0.5;

        private const double MaxUserScale = 2.0;

        /// <summary>
        /// Bounds for the grip strip above the page, in physical pixels. At 150%
        /// display scaling 20 is ~13 logical pixels, close to a normal title bar.
        /// </summary>
        private const int MinDragStripHeight = 0;

        private const int MaxDragStripHeight = 60;

        private float dpiScale;            // display scale, e.g. 1.5 at 150%; re-read per open

        private float userScale;           // drawn size as a fraction of the browser's own

        private float scale;               // physical pixels per CSS pixel

        private double webZoom;            // the ZoomFactor that produces it

        private int dragStripHeight;       // grip strip, physical pixels - deliberately NOT scaled, see README

        /// <summary>
        /// The display the flyout is about to appear on: the one under the pointer, which
        /// is where PositionNearTray puts it. ComputeScale and PositionNearTray have to
        /// agree on this or the size is computed for one monitor and the position for
        /// another.
        /// </summary>
        private static Screen TargetScreen()
        {
            try
            {
                Screen screen = Screen.FromPoint(Cursor.Position);
                if (screen != null)
                {
                    return screen;
                }
            }
            catch
            {
            }
            return Screen.PrimaryScreen;
        }

        /// <summary>
        /// The display scale of the screen the flyout is about to open on.
        ///
        /// Read per call rather than cached in the constructor: the panel can be opened
        /// on a different monitor than last time, and one reading taken at construction
        /// is what made the drawn size wrong there. The old code also asked
        /// Graphics.FromHwnd(IntPtr.Zero), which reports the *primary* monitor's DPI -
        /// the wrong answer on a mixed-DPI desktop.
        /// </summary>
        private static float DetectDpiScale()
        {
            return DpiScaleAt(Cursor.Position);
        }

        private static float DpiScaleAt(Point point)
        {
            float dpi = 0f;
            try
            {
                IntPtr monitor = MonitorFromPoint(new POINT { x = point.X, y = point.Y }, MONITOR_DEFAULTTONEAREST);
                uint dpiX;
                uint dpiY;
                if (monitor != IntPtr.Zero && GetDpiForMonitor(monitor, MDT_EFFECTIVE_DPI, out dpiX, out dpiY) == 0 && dpiX > 0)
                {
                    dpi = dpiX;
                }
            }
            catch
            {
            }
            if (dpi <= 0f)
            {
                // GetDpiForMonitor needs Windows 8.1. On anything older, fall back to
                // the primary monitor's scale, which is what this always used to be.
                try
                {
                    using (Graphics g = Graphics.FromHwnd(IntPtr.Zero))
                    {
                        dpi = g.DpiX;
                    }
                }
                catch
                {
                }
            }
            if (dpi <= 0f)
            {
                dpi = 96f;
            }
            float value = dpi / 96f;
            return value < 1f ? 1f : value;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct POINT
        {
            public int x;
            public int y;
        }

        private const int MDT_EFFECTIVE_DPI = 0;
        private const uint MONITOR_DEFAULTTONEAREST = 2;

        [DllImport("user32.dll")]
        private static extern IntPtr MonitorFromPoint(POINT point, uint flags);

        [DllImport("shcore.dll")]
        private static extern int GetDpiForMonitor(IntPtr monitor, int dpiType, out uint dpiX, out uint dpiY);

        /// <summary>
        /// Physical pixels per CSS pixel.
        ///
        /// WebView2 already scales web content by the display scale, so a ZoomFactor
        /// of 1 renders at exactly the size the browser would: on this machine
        /// (2560x1600 at 150%) that is 1688*1.5 = 2532 physical pixels wide, and the
        /// CSS viewport WebView2 reports is 1688 - the same number the reference
        /// screenshots were taken at. The flyout only shrinks - never the layout -
        /// when the scaled panel would not fit the work area, by lowering both the
        /// window size and ZoomFactor together so the CSS viewport stays 1688x935.
        /// </summary>
        private float ComputeScale(float dpi)
        {
            // Take the user's fraction of the browser's own size, then give up size
            // (never the layout) if that still would not fit the work area.
            float fit = dpi;
            try
            {
                Screen screen = TargetScreen();
                if (screen != null)
                {
                    Rectangle work = screen.WorkingArea;
                    float fitX = (work.Width - ScreenMargin) / (float)CssWidth;
                    float fitY = (work.Height - ScreenMargin - dragStripHeight) / (float)CssHeight;
                    fit = Math.Min(fitX, fitY);
                }
            }
            catch
            {
            }

            float value = Math.Min(dpi * userScale, fit);
            if (value < 0.25f)
            {
                value = 0.25f;
            }
            if (value > 5f)
            {
                value = 5f;
            }
            return value;
        }

        /// <summary>Physically rendered pixels per CSS pixel (the browser's DPR).</summary>

        public float CssScale
        {
            get { return scale; }
        }

        public double WebZoomFactor
        {
            get { return webZoom; }
        }

        public float DpiScale
        {
            get { return dpiScale; }
        }

        public double UserScaleValue
        {
            get { return userScale; }
        }

        /// <summary>The height of the strip above the page, in physical pixels.</summary>

        public int DragStripHeightValue
        {
            get { return dragStripHeight; }
        }

        /// <summary>Puts the panel back where the user last left it, if they ever moved it.</summary>

        public void ApplyUserScale(double value)
        {
            if (value < MinUserScale)
            {
                value = MinUserScale;
            }
            if (value > MaxUserScale)
            {
                value = MaxUserScale;
            }
            userScale = (float)value;
            SettingsStore.Current.userScale = userScale;
            Rescale();
            SettingsStore.Save();
        }

        /// <summary>Changes the height of the grip strip above the page, live.</summary>

        public void ApplyDragStripHeight(int value)
        {
            if (value < MinDragStripHeight)
            {
                value = MinDragStripHeight;
            }
            if (value > MaxDragStripHeight)
            {
                value = MaxDragStripHeight;
            }
            dragStripHeight = value;
            SettingsStore.Current.dragStripHeight = value;
            Rescale();
            SettingsStore.Save();
        }

        /// <summary>Turns always-on-top on or off, live.</summary>

        /// <summary>
        /// Re-reads the display scale of the screen under the pointer and, if it changed,
        /// recomputes the drawn size. Called when the panel is opened, because "the
        /// screen under the pointer" is not a property of this process - the panel can be
        /// summoned from a different monitor than the one it was built for.
        /// </summary>
        internal void RefreshDisplayScale()
        {
            float detected = DetectDpiScale();
            if (Math.Abs(detected - dpiScale) < 0.001f)
            {
                return;
            }
            LogInit("display scale changed: " + dpiScale.ToString("0.###") + " -> " + detected.ToString("0.###"));
            dpiScale = detected;
            Rescale();
        }

        private void Rescale()
        {
            scale = ComputeScale(dpiScale);
            webZoom = scale / dpiScale;
            if (webViewReady)
            {
                // RasterizationScale as well as ZoomFactor: the CSS viewport is
                // Bounds.Width / (RasterizationScale * ZoomFactor), so both terms belong
                // to the same calculation.
                ApplyControllerGeometry();
            }
            ClientSize = new Size(
                (int)Math.Round(CssWidth * scale),
                (int)Math.Round(CssHeight * scale) + dragStripHeight);
            LayoutChildren();
            if (userMoved)
            {
                KeepOnScreen();
            }
            else
            {
                PositionNearTray();
            }
        }

        /// <summary>
        /// Pulls a window that has ended up off the desktop back into view. Moving is
        /// free, but dragging the panel somewhere unreachable would strand it: it has
        /// no taskbar entry to restore it from.
        /// </summary>
    }
}
