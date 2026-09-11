using System;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace RouterMonitorTray
{
    /// <summary>
    /// The flyout window itself: chrome, dragging, placement and layout.
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
        public const int CssWidth = 1688;

        public const int CssHeight = 935;

        /// <summary>Smallest and largest drawn size the settings are clamped to.</summary>

        private const int ScreenMargin = 24;

        private const int WM_NCHITTEST = 0x0084;

        private const int WM_SYSCOMMAND = 0x0112;

        private const int WM_WINDOWPOSCHANGING = 0x0046;

        private const int WM_MOVING = 0x0216;

        private const int WM_NCLBUTTONDOWN = 0x00A1;

        private const int HTCLIENT = 1;

        private const int HTCAPTION = 2;

        private const int SC_SIZE = 0xF000;

        private const int SC_MOVE = 0xF010;

        [StructLayout(LayoutKind.Sequential)]
        private struct WINDOWPOS
        {
            public IntPtr hwnd;
            public IntPtr hwndInsertAfter;
            public int x;
            public int y;
            public int cx;
            public int cy;
            public uint flags;
        }

        private readonly Label loading;

        /// <summary>
        /// The window the WebView2 controller is parented to.
        ///
        /// A plain Panel cannot take focus, so focusing it did nothing, the form never
        /// became the active window, and it deactivated - hiding itself - the moment the
        /// process that asked for it exited. The WinForms WebView2 control was a
        /// focusable control, which is why this never showed up before.
        /// </summary>
        private sealed class WebHost : Panel
        {
            public WebHost()
            {
                SetStyle(ControlStyles.Selectable, true);
                TabStop = true;
            }
        }

        private readonly Panel dragStrip;

        /// <summary>The window the WebView2 controller is parented to.</summary>
        private readonly WebHost webHost;

        private bool stayOpen;

        private bool userMoved;

        private Point anchor;

        private string startPage = "/";

        [DllImport("user32.dll")]

        private static extern bool ReleaseCapture();

        [DllImport("user32.dll")]

        private static extern IntPtr SendMessage(IntPtr hwnd, int msg, IntPtr wParam, IntPtr lParam);

        /// <summary>Which dashboard route the flyout opens on (used by the evidence tool).</summary>

        public string StartPage
        {
            get { return startPage; }
            set { if (!string.IsNullOrEmpty(value)) { startPage = value; } }
        }

        /// <summary>True once the page has painted at least one successful navigation.</summary>

        public bool StayOpen
        {
            get { return stayOpen; }
            set { stayOpen = value; }
        }

        /// <summary>The last message type the page sent, for the diagnostics report.</summary>

        public event Action<bool> PinnedChanged;

        /// <summary>
        /// Raised when the page cannot be brought up, with something the user can act
        /// on. The label inside the panel is not enough: a tray icon that has quietly
        /// stopped working looks identical to one that is fine.
        /// </summary>
        public event Action<string> ProblemReported;

        /// <summary>
        /// Raised when the page reports a one-line status. The tray owns the
        /// notification-area tooltip, so this is the only way the page can put
        /// anything there.
        /// </summary>
        public event Action<string> StatusReported;

        public void EnsureHandle()
        {
            if (!IsHandleCreated)
            {
                CreateHandle();
            }
        }

        /// <summary>
        /// Waits until the first page has painted. Polls rather than blocks, so it
        /// has to be awaited from the UI thread's own message loop.
        /// </summary>
        public PanelForm()
        {
            TraySettings settings = SettingsStore.Current;
            userScale = (float)settings.userScale;
            dragStripHeight = settings.dragStripHeight;

            dpiScale = DetectDpiScale();
            scale = ComputeScale(dpiScale);
            webZoom = scale / dpiScale;

            FormBorderStyle = FormBorderStyle.None;
            ShowInTaskbar = false;
            StartPosition = FormStartPosition.Manual;
            TopMost = settings.topMost;
            KeyPreview = true;
            Text = "Router Monitor";
            BackColor = Color.FromArgb(255, 255, 255);

            // The drag strip sits above the page rather than over it, so the page
            // keeps its full 1688x935 CSS viewport and nothing is covered.
            ClientSize = new Size(
                (int)Math.Round(CssWidth * scale),
                (int)Math.Round(CssHeight * scale) + dragStripHeight);

            // Positions are assigned explicitly rather than by docking. Docking a
            // Top strip in front of a Fill sibling does not reserve its height (the
            // front-most control lays out last, after Fill has taken everything), and
            // the strip has to be in front or WebView2's own window paints over it.
            dragStrip = new Panel();
            dragStrip.BackColor = Color.FromArgb(255, 255, 255);
            dragStrip.Cursor = Cursors.SizeAll;
            dragStrip.MouseDown += OnDragStripMouseDown;
            dragStrip.MouseMove += OnDragStripMouseMove;
            dragStrip.MouseUp += OnDragStripMouseUp;
            dragStrip.Paint += OnDragStripPaint;

            // A plain child window, not the WinForms WebView2 control: the controller
            // is created and owned here (see PanelForm.WebView.cs), so nothing has to
            // reach into the wrapper's private fields to make suspend and resume work.
            webHost = new WebHost();
            webHost.BackColor = Color.White;

            // A single label, shown only while the local server is starting or the
            // first page is still loading. It deliberately imitates nothing.
            loading = new Label();
            loading.TextAlign = ContentAlignment.MiddleCenter;
            loading.BackColor = Color.FromArgb(255, 255, 255);
            loading.ForeColor = Color.FromArgb(120, 120, 120);
            loading.Font = new Font("Segoe UI", 11f, FontStyle.Regular);
            loading.Text = "正在启动本地服务…";

            Controls.Add(webHost);
            Controls.Add(loading);
            Controls.Add(dragStrip);
            LayoutChildren();
            RestoreSavedPosition();
        }

        protected override void OnLayout(LayoutEventArgs e)
        {
            base.OnLayout(e);
            LayoutChildren();
        }

        /// <summary>
        /// Gives the page exactly CssHeight*scale physical pixels - the strip is added
        /// above that, never taken out of it - so the CSS viewport stays 1688x935 and
        /// the strip covers no content. Z-order puts the strip in front of the page and
        /// the loading label in front of the page but behind the strip.
        /// </summary>
        private void LayoutChildren()
        {
            if (webHost == null || dragStrip == null || loading == null)
            {
                return;
            }
            int w = ClientSize.Width;
            int h = ClientSize.Height;
            int strip = Math.Min(dragStripHeight, h);
            int pageH = Math.Max(0, h - strip);

            dragStrip.Bounds = new Rectangle(0, 0, w, strip);
            webHost.Bounds = new Rectangle(0, strip, w, pageH);
            loading.Bounds = new Rectangle(0, strip, w, pageH);
            // The controller does not follow the window it is parented to; its bounds
            // are set here every time the layout changes.
            SyncControllerBounds();

            loading.BringToFront();
            dragStrip.BringToFront();
        }

        /// <summary>
        /// Starts a window move the way a title bar would. The window has no caption
        /// (WS_CAPTION is masked off), so the default drag path does not exist and it
        /// is synthesised here: capture release plus a non-client hit-test that says
        /// "caption", after which Windows runs its own move loop.
        /// </summary>
        private void OnDragStripMouseDown(object sender, MouseEventArgs e)
        {
            if (e.Button != MouseButtons.Left)
            {
                return;
            }
            userMoved = true;
            ReleaseCapture();
            SendMessage(Handle, WM_NCLBUTTONDOWN, (IntPtr)HTCAPTION, IntPtr.Zero);
        }

        private void OnDragStripMouseMove(object sender, MouseEventArgs e)
        {
            if (dragStrip.Capture)
            {
                return;
            }
            // Keep the grip affordance but never a grab cursor: while the move loop
            // runs, Windows owns the cursor.
            dragStrip.Cursor = Cursors.SizeAll;
        }

        private void OnDragStripMouseUp(object sender, MouseEventArgs e)
        {
            KeepOnScreen();
            SettingsStore.RememberPosition(Left, Top);
        }

        /// <summary>
        /// Draws the grip: three short bars, the usual hint that a strip can be
        /// dragged, plus a hairline under the strip so it reads as window chrome
        /// rather than as part of the page.
        /// </summary>
        private void OnDragStripPaint(object sender, PaintEventArgs e)
        {
            try
            {
                int w = dragStrip.Width;
                int h = dragStrip.Height;
                using (Pen grip = new Pen(Color.FromArgb(110, 120, 120, 120), 2f))
                {
                    int cx = w / 2;
                    int cy = h / 2;
                    for (int i = -1; i <= 1; i++)
                    {
                        int x = cx + (i * 7);
                        e.Graphics.DrawLine(grip, x, cy - 3, x, cy + 3);
                    }
                }
                using (Pen edge = new Pen(Color.FromArgb(28, 0, 0, 0), 1f))
                {
                    e.Graphics.DrawLine(edge, 0, h - 1, w, h - 1);
                }
            }
            catch
            {
            }
        }

        public void AnchorTo(Point position)
        {
            anchor = position;
            Location = position;
        }

        /// <summary>Drawn size as a fraction of the browser's own; the CSS viewport never changes.</summary>

        public void RestoreSavedPosition()
        {
            TraySettings settings = SettingsStore.Current;
            if (!settings.hasPosition)
            {
                return;
            }
            userMoved = true;
            AnchorTo(new Point(settings.windowX, settings.windowY));
        }

        /// <summary>Docks the panel to the tray again and forgets the saved position.</summary>

        public void ForgetPosition()
        {
            userMoved = false;
            SettingsStore.ForgetPosition();
            PositionNearTray();
        }

        /// <summary>
        /// Changes the drawn size without touching the layout: the window and the
        /// ZoomFactor move together so the CSS viewport stays 1688x935. Applied live,
        /// so the menu can change it while the panel is open.
        /// </summary>
        public void ApplyTopMost(bool value)
        {
            TopMost = value;
            SettingsStore.Current.topMost = value;
            SettingsStore.Save();
        }

        /// <summary>
        /// Recomputes the drawn geometry from userScale and dragStripHeight. The CSS
        /// viewport is the invariant here, never the physical size.
        /// </summary>
        private void KeepOnScreen()
        {
            try
            {
                Rectangle target = Screen.FromControl(this).WorkingArea;
                int x = Math.Min(Math.Max(Left, target.Left), target.Right - Width);
                int y = Math.Min(Math.Max(Top, target.Top), target.Bottom - Height);
                if (x != Left || y != Top)
                {
                    Location = new Point(x, y);
                    anchor = Location;
                }
            }
            catch
            {
            }
        }

        protected override void WndProc(ref Message m)
        {
            // Checked before anything else: the hotkey message carries no coordinates or
            // state that the handlers below care about, and it must not fall through to
            // the default handling.
            if (HandleHotkeyMessage(ref m))
            {
                m.Result = IntPtr.Zero;
                return;
            }
            if (m.Msg == WM_NCHITTEST)
            {
                m.Result = (IntPtr)HTCLIENT;
                return;
            }
            // SC_SIZE stays blocked (there is no resize border to grab anyway), but
            // SC_MOVE must be allowed through: the caption-drag started by the strip
            // arrives as exactly this message, and swallowing it was what made the
            // panel refuse to move even after the anchor pull-back was removed.
            if (m.Msg == WM_SYSCOMMAND)
            {
                int command = m.WParam.ToInt32() & 0xFFF0;
                if (command == SC_SIZE)
                {
                    m.Result = IntPtr.Zero;
                    return;
                }
            }
            // The window used to be pinned to its anchor here, which is exactly what
            // made it undraggable. It is now freely movable: the anchor is only the
            // initial placement, and KeepOnScreen stops a drag from losing it off
            // the edge of the desktop.
            base.WndProc(ref m);
        }

        protected override CreateParams CreateParams
        {
            get
            {
                CreateParams cp = base.CreateParams;
                cp.ClassStyle |= 0x20000; // CS_DROPSHADOW
                cp.Style &= ~(int)(0x00C00000 | 0x00040000); // WS_CAPTION | WS_THICKFRAME
                return cp;
            }
        }

        protected override void OnHandleCreated(EventArgs e)
        {
            base.OnHandleCreated(e);
            ApplySystemFrame();
            // A hotkey is registered against a window handle, and the handle may be
            // recreated (a DPI change or a theme change does it), which silently drops
            // the registration. Re-applying here keeps the key alive across that.
            if (!string.IsNullOrEmpty(hotkeySpec))
            {
                ApplyHotkey(hotkeySpec);
            }
        }

        /// <summary>
        /// Windows 11 draws the rounded corners and the border for us, which looks
        /// sharper than clipping the window with a Region.
        /// </summary>
        private void ApplySystemFrame()
        {
            try
            {
                int round = 2; // DWMWCP_ROUND
                DwmSetWindowAttribute(Handle, 33, ref round, 4);
                int dark = 0; // the web app defaults to its light theme
                if (DwmSetWindowAttribute(Handle, 20, ref dark, 4) != 0)
                {
                    DwmSetWindowAttribute(Handle, 19, ref dark, 4);
                }
            }
            catch
            {
            }
        }

        [DllImport("dwmapi.dll")]

        private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attribute, ref int value, int size);

        protected override bool ShowWithoutActivation
        {
            get { return false; }
        }

        protected override void OnKeyDown(KeyEventArgs e)
        {
            if (e.KeyCode == Keys.Escape)
            {
                HidePanel();
                e.Handled = true;
                e.SuppressKeyPress = true;
                return;
            }
            base.OnKeyDown(e);
        }

        protected override void OnDeactivate(EventArgs e)
        {
            base.OnDeactivate(e);
            if (!stayOpen)
            {
                // Logged because "the panel opened and vanished" has no other symptom:
                // losing activation is the only thing that hides it.
                LogInit("panel: deactivated at " + DateTime.Now.ToString("HH:mm:ss.fff") + " -> hiding");
                HidePanel();
            }
        }

        /// <summary>Opens the flyout next to the tray icon and makes sure it has content.</summary>

        public void ShowPanel()
        {
            LogInit("panel: show requested at " + DateTime.Now.ToString("HH:mm:ss.fff") +
                " (ready=" + (webViewReady ? "yes" : "no") + ", content=" + (IsContentReady ? "yes" : "no") + ")");
            // Resume while the window is still hidden: WebView2 requires the
            // webview to be invisible when Resume() runs, otherwise the call is
            // rejected and the page stays frozen.
            RestoreWebView();
            // The pointer may be over a different monitor than last time, and the drawn
            // size depends on its scale.
            RefreshDisplayScale();
            // Only placed automatically until the user has moved it themselves; after
            // that the window keeps whatever position it was dragged to.
            if (userMoved)
            {
                KeepOnScreen();
            }
            else
            {
                PositionNearTray();
            }
            Visible = true;
            BringToFront();
            Activate();
            FocusContent();
            if (!webViewReady && !initStarted)
            {
                StartInit();
            }
            else if (webViewReady && !IsContentReady)
            {
                // The page is up but empty or failed. The usual cause is the local
                // server having gone away while the tray stayed running, and without
                // this the flyout would stay dead until the tray was restarted.
                RecoverServer();
            }
        }

        /// <summary>
        /// Re-checks the local server and reloads the page if it is back. Runs off the
        /// UI thread except for the WebView calls, and refuses to run twice at once:
        /// ShowPanel is called on every open.
        /// </summary>
        public void HidePanel()
        {
            Hide();
            SuspendWebView();
        }

        public void TogglePanel()
        {
            if (Visible)
            {
                HidePanel();
            }
            else
            {
                ShowPanel();
            }
        }

        /// <summary>
        /// Sends the panel to a dashboard route. Only same-dashboard pages are
        /// accepted, so this cannot be used to point the flyout somewhere else.
        /// </summary>
        private void PositionNearTray()
        {
            Rectangle cursor = new Rectangle(Cursor.Position, new Size(1, 1));
            Screen screen = Screen.FromRectangle(cursor);
            if (screen == null)
            {
                screen = Screen.PrimaryScreen;
            }
            Rectangle work = screen.WorkingArea;

            int x = cursor.X - Width + (int)(24 * scale);
            int y = cursor.Y - Height - (int)(10 * scale);
            // Height already includes the drag strip, so the strip - not the page -
            // is what ends up level with the tray icon's row.

            if (y < work.Top)
            {
                y = cursor.Y + (int)(12 * scale);
            }
            x = Math.Max(work.Left + 8, Math.Min(x, work.Right - Width - 8));
            y = Math.Max(work.Top + 8, Math.Min(y, work.Bottom - Height - 8));

            AnchorTo(new Point(x, y));
        }

        private void SetStatus(string text)
        {
            if (InvokeRequired)
            {
                try
                {
                    BeginInvoke((MethodInvoker)delegate { SetStatus(text); });
                }
                catch
                {
                }
                return;
            }
            loading.Text = text;
        }

        /// <summary>
        /// Brings the page up: start the server if needed, create the WebView2 once,
        /// then navigate. Runs entirely off the UI thread except for the WebView2
        /// calls, which must happen on it.
        /// </summary>
        internal static void LogInit(string message)
        {
            try
            {
                string dir = Path.Combine(ServerHost.ProjectRoot, "logs");
                Directory.CreateDirectory(dir);
                File.AppendAllText(Path.Combine(dir, "tray-init.log"),
                    DateTime.Now.ToString("s") + "  " + message + Environment.NewLine);
            }
            catch
            {
            }
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                UnregisterCurrentHotkey();
                try
                {
                    if (webViewReady && controller != null)
                    {
                        controller.CoreWebView2.TrySuspendAsync();
                    }
                }
                catch
                {
                }
                if (controller != null)
                {
                    // CoreWebView2Controller is not IDisposable; Close tears down the
                    // browser and releases the window it was parented to.
                    controller.Close();
                }
            }
            base.Dispose(disposing);
        }
    }
}
