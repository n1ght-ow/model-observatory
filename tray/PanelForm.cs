using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace RouterMonitorTray
{
    /// <summary>
    /// The tray flyout. It is a bare borderless window whose only child is a
    /// WebView2 control pointed at the local dashboard, so what the flyout shows
    /// is literally the web app - there is no drawing code here at all.
    ///
    /// The CSS viewport is pinned to the size the reference screenshots were
    /// captured at (1688x935) by pairing the control size with ZoomFactor, so the
    /// page never falls back to its responsive layout.
    /// </summary>
    internal sealed class PanelForm : Form
    {
        public const int CssWidth = 1688;
        public const int CssHeight = 935;

        /// <summary>Smallest and largest drawn size the settings are clamped to.</summary>
        private const double MinUserScale = 0.5;
        private const double MaxUserScale = 2.0;

        /// <summary>
        /// Bounds for the grip strip above the page, in physical pixels. At 150%
        /// display scaling 20 is ~13 logical pixels, close to a normal title bar.
        /// </summary>
        private const int MinDragStripHeight = 0;
        private const int MaxDragStripHeight = 60;

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

        /// <summary>
        /// The one place the page and the tray speak to each other. Every message is
        /// a versioned envelope - `{v:1,type:...}` - so the page can tell what it is
        /// running inside, and so a new message type is a new `case` on both sides
        /// rather than a new magic string. This is v1.
        /// </summary>
        private const string BridgeScript =
            "(function(){if(window.__rmBridge){return;}" +
            "var post=function(m){try{window.chrome.webview.postMessage(JSON.stringify(m));}catch(e){}};" +
            "var listen=function(fn){try{window.chrome.webview.addEventListener('message',function(e){" +
            "var m=e.data;if(typeof m==='string'){try{m=JSON.parse(m);}catch(err){return;}}" +
            "if(m&&m.v===1){fn(m);}});}catch(e){}};" +
            "window.__rmBridge={version:1,post:post,listen:listen," +
            "close:function(){post({v:1,type:'close'});}," +
            "openExternal:function(url){post({v:1,type:'openExternal',url:String(url)});}," +
            "setPinned:function(on){post({v:1,type:'pin',pinned:!!on});}," +
            "ready:function(){post({v:1,type:'ready'});}};" +
            "document.addEventListener('keydown',function(e){" +
            "if(e.key!=='Escape'){return;}" +
            "var open=document.querySelector('[role=\"dialog\"],[role=\"listbox\"],[role=\"menu\"]');" +
            "if(open){return;}" +
            "window.__rmBridge.close();" +
            "},true);" +
            "post({v:1,type:'bridge'});})();";

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

        private readonly WebView2 webView;
        private readonly Label loading;
        private readonly Panel dragStrip;
        private readonly float dpiScale;   // display scale, e.g. 1.5 at 150%
        private float userScale;           // drawn size as a fraction of the browser's own
        private float scale;               // physical pixels per CSS pixel
        private double webZoom;            // the ZoomFactor that produces it
        private int dragStripHeight;       // grip strip height, in physical pixels

        private bool stayOpen;
        private bool webViewReady;
        private bool webViewFailed;
        private bool suspended;
        private bool initStarted;
        private bool userMoved;
        private int suspendResult = -1;
        private string bridgeLastMessage = "(none)";
        private string lastDashboardUri;
        private bool cancelledNavigation;
        private bool recovering;

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
        public bool IsContentReady
        {
            get { return webViewReady && !loading.Visible; }
        }

        /// <summary>Whether Chromium actually accepted the suspend request.</summary>
        public string SuspendState
        {
            get
            {
                if (suspendResult < 0)
                {
                    return "not-attempted";
                }
                return suspendResult == 1 ? "suspended" : "refused";
            }
        }

        /// <summary>When true the flyout survives losing focus (pinned by the user).</summary>
        public bool StayOpen
        {
            get { return stayOpen; }
            set { stayOpen = value; }
        }

        /// <summary>The last message type the page sent, for the diagnostics report.</summary>
        public string BridgeState
        {
            get { return bridgeLastMessage; }
        }

        /// <summary>
        /// Raised when the page pins or unpins the panel, so the tray menu and the
        /// settings file can follow a decision that was made inside the page.
        /// </summary>
        public event Action<bool> PinnedChanged;

        /// <summary>
        /// Raised when the page cannot be brought up, with something the user can act
        /// on. The label inside the panel is not enough: a tray icon that has quietly
        /// stopped working looks identical to one that is fine.
        /// </summary>
        public event Action<string> ProblemReported;

        public bool WebViewFailed
        {
            get { return webViewFailed; }
        }

        /// <summary>
        /// Creates the window handle without showing anything. The control channel
        /// marshals work onto this form's thread, and BeginInvoke needs a handle to
        /// post to - the tray has one from startup, before the panel is ever opened.
        /// </summary>
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
        public async Task<bool> WaitForContentAsync(int timeoutMs)
        {
            Stopwatch clock = Stopwatch.StartNew();
            while (clock.ElapsedMilliseconds < timeoutMs)
            {
                if (IsContentReady)
                {
                    return true;
                }
                await Task.Delay(100);
            }
            return IsContentReady;
        }

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

            webView = new WebView2();
            webView.DefaultBackgroundColor = Color.White;

            // A single label, shown only while the local server is starting or the
            // first page is still loading. It deliberately imitates nothing.
            loading = new Label();
            loading.TextAlign = ContentAlignment.MiddleCenter;
            loading.BackColor = Color.FromArgb(255, 255, 255);
            loading.ForeColor = Color.FromArgb(120, 120, 120);
            loading.Font = new Font("Segoe UI", 11f, FontStyle.Regular);
            loading.Text = "正在启动本地服务…";

            Controls.Add(webView);
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
            if (webView == null || dragStrip == null || loading == null)
            {
                return;
            }
            int w = ClientSize.Width;
            int h = ClientSize.Height;
            int strip = Math.Min(dragStripHeight, h);
            int pageH = Math.Max(0, h - strip);

            dragStrip.Bounds = new Rectangle(0, 0, w, strip);
            webView.Bounds = new Rectangle(0, strip, w, pageH);
            loading.Bounds = new Rectangle(0, strip, w, pageH);

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

        private static float DetectDpiScale()
        {
            float dpi = 96f;
            try
            {
                using (Graphics g = Graphics.FromHwnd(IntPtr.Zero))
                {
                    if (g.DpiX > 0f)
                    {
                        dpi = g.DpiX;
                    }
                }
            }
            catch
            {
            }
            float value = dpi / 96f;
            return value < 1f ? 1f : value;
        }

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
                Screen screen = Screen.PrimaryScreen;
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

        public void AnchorTo(Point position)
        {
            anchor = position;
            Location = position;
        }

        /// <summary>Drawn size as a fraction of the browser's own; the CSS viewport never changes.</summary>
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
        private void Rescale()
        {
            scale = ComputeScale(dpiScale);
            webZoom = scale / dpiScale;
            if (webViewReady)
            {
                try
                {
                    webView.ZoomFactor = webZoom;
                }
                catch (Exception ex)
                {
                    LogInit("zoom: " + ex.Message);
                }
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
                HidePanel();
            }
        }

        /// <summary>Opens the flyout next to the tray icon and makes sure it has content.</summary>
        public void ShowPanel()
        {
            // Resume while the window is still hidden: WebView2 requires the
            // webview to be invisible when Resume() runs, otherwise the call is
            // rejected and the page stays frozen.
            RestoreWebView();
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
            webView.Focus();
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
        private async void RecoverServer()
        {
            if (recovering)
            {
                return;
            }
            recovering = true;
            try
            {
                loading.Visible = true;
                SetStatus("正在重新连接本地服务…");
                bool serving = await ServerHost.EnsureAsync(240000, SetStatus).ConfigureAwait(true);
                if (serving)
                {
                    loading.Visible = false;
                    Reload();
                }
                else
                {
                    string detail = ServerHost.LastProblem;
                    SetStatus("本地服务不可用" + (string.IsNullOrEmpty(detail) ? "" : "：" + detail));
                    if (ProblemReported != null)
                    {
                        ProblemReported(string.IsNullOrEmpty(detail)
                            ? @"本地服务不可用，详情见 logs\dashboard.log"
                            : detail);
                    }
                }
            }
            catch (Exception ex)
            {
                LogInit("recover: " + ex.Message);
            }
            finally
            {
                recovering = false;
            }
        }

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
        public void NavigateTo(string route)
        {
            if (string.IsNullOrEmpty(route) || !webViewReady)
            {
                return;
            }
            string target = ServerHost.BaseUrl + (route.StartsWith("/") ? route : "/" + route);
            if (!IsDashboard(target))
            {
                LogInit("navigate: refused " + Truncate(target));
                return;
            }
            try
            {
                webView.CoreWebView2.Navigate(target);
            }
            catch (Exception ex)
            {
                LogInit("navigate: " + ex.Message);
            }
        }

        /// <summary>
        /// Reloads the dashboard route the panel is on. Deliberately not
        /// CoreWebView2.Reload(), which reloads the *current* URL - if the panel had
        /// somehow ended up on an API response, that reloaded the API response and
        /// there was no way back.
        /// </summary>
        public void Reload()
        {
            if (webViewReady)
            {
                try
                {
                    string target = string.IsNullOrEmpty(lastDashboardUri)
                        ? ServerHost.BaseUrl + startPage
                        : lastDashboardUri;
                    webView.CoreWebView2.Navigate(target);
                    return;
                }
                catch (Exception ex)
                {
                    LogInit("reload: " + ex.Message);
                }
            }
            StartInit();
        }

        public string CoreVersion()
        {
            if (!webViewReady)
            {
                return "(not initialised)";
            }
            try
            {
                return webView.CoreWebView2.Environment.BrowserVersionString;
            }
            catch
            {
                return "(unknown)";
            }
        }

        /// <summary>Runs JavaScript in the page and returns the result (used by --probe).</summary>
        public async Task<string> RunScriptAsync(string script)
        {
            if (!webViewReady)
            {
                return null;
            }
            try
            {
                return await webView.CoreWebView2.ExecuteScriptAsync(script);
            }
            catch (Exception ex)
            {
                LogInit("ExecuteScriptAsync failed: " + ex.Message);
                return null;
            }
        }

        /// <summary>Saves a screenshot of the flyout exactly as it appears on screen.</summary>
        public void CaptureTo(string path)
        {
            Rectangle bounds = Bounds;
            using (Bitmap bitmap = new Bitmap(bounds.Width, bounds.Height))
            {
                using (Graphics g = Graphics.FromImage(bitmap))
                {
                    g.CopyFromScreen(bounds.Location, Point.Empty, bounds.Size);
                }
                string full = Path.GetFullPath(path);
                string dir = Path.GetDirectoryName(full);
                if (!string.IsNullOrEmpty(dir))
                {
                    Directory.CreateDirectory(dir);
                }
                bitmap.Save(full, ImageFormat.Png);
            }
        }

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
        private async void StartInit()
        {
            if (initStarted)
            {
                return;
            }
            initStarted = true;

            bool serving = await ServerHost.EnsureAsync(240000, SetStatus).ConfigureAwait(true);
            if (!serving)
            {
                // Not sticky: the host may still be building, so opening the panel
                // again retries instead of staying dead until a restart.
                initStarted = false;
                webViewFailed = true;
                string detail = ServerHost.LastProblem;
                SetStatus("本地服务启动失败" + (string.IsNullOrEmpty(detail) ? "" : "：" + detail));
                if (ProblemReported != null)
                {
                    ProblemReported(string.IsNullOrEmpty(detail)
                        ? @"本地服务启动失败，详情见 logs\dashboard.log"
                        : detail);
                }
                return;
            }

            SetStatus("正在加载页面…");
            bool ok = await InitWebViewAsync().ConfigureAwait(true);
            if (!ok)
            {
                // Also not sticky. A profile lock left behind by a force-killed
                // previous run, or an Edge update in progress, must not brick the
                // flyout for the rest of the session.
                initStarted = false;
                webViewFailed = true;
                SetStatus("无法初始化 WebView2，正在重试…（详情见 logs\tray-init.log）");
                await Task.Delay(2500).ConfigureAwait(true);
                StartInit();
            }
        }

        private async Task<bool> InitWebViewAsync()
        {
            if (webViewReady)
            {
                return true;
            }
            try
            {
                string userData = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    @"RouterMonitorTray\WebView2");
                Directory.CreateDirectory(userData);
                LogInit("CreateAsync userData=" + userData);

                CoreWebView2Environment environment =
                    await CoreWebView2Environment.CreateAsync(null, userData, null).ConfigureAwait(true);
                LogInit("CreateAsync ok, browser=" + environment.BrowserVersionString);
                await webView.EnsureCoreWebView2Async(environment).ConfigureAwait(true);
                LogInit("EnsureCoreWebView2Async ok");

                CoreWebView2 core = webView.CoreWebView2;
                core.Settings.AreDefaultContextMenusEnabled = false;
                core.Settings.IsStatusBarEnabled = false;
                core.Settings.AreBrowserAcceleratorKeysEnabled = false;
                core.Settings.IsZoomControlEnabled = false;
                core.Settings.IsPinchZoomEnabled = false;
                core.Settings.IsSwipeNavigationEnabled = false;
                core.Settings.AreDevToolsEnabled = false;
                core.Settings.IsPasswordAutosaveEnabled = false;
                core.Settings.IsGeneralAutofillEnabled = false;

                core.WebMessageReceived += OnWebMessage;
                core.NavigationStarting += OnNavigationStarting;
                core.NewWindowRequested += OnNewWindowRequested;
                core.NavigationCompleted += OnNavigationCompleted;
                core.ProcessFailed += OnProcessFailed;
                await core.AddScriptToExecuteOnDocumentCreatedAsync(BridgeScript).ConfigureAwait(true);

                webView.ZoomFactor = webZoom;
                webViewReady = true;
                core.Navigate(ServerHost.BaseUrl + startPage);
                LogInit("navigated to " + ServerHost.BaseUrl + startPage);
                return true;
            }
            catch (Exception ex)
            {
                LogInit("FAILED: " + ex);
                return false;
            }
        }

        /// <summary>Appends a line to logs\tray-init.log; never throws.</summary>
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

        private void OnProcessFailed(object sender, CoreWebView2ProcessFailedEventArgs e)
        {
            webViewFailed = true;
            SetStatus("渲染进程异常，正在重试…");
            try
            {
                webView.CoreWebView2.Reload();
            }
            catch
            {
            }
        }

        private void OnNavigationCompleted(object sender, CoreWebView2NavigationCompletedEventArgs e)
        {
            if (cancelledNavigation && !e.IsSuccess)
            {
                cancelledNavigation = false;
                return;
            }
            cancelledNavigation = false;
            if (e.IsSuccess)
            {
                if (loading.Visible)
                {
                    loading.Visible = false;
                }
                string uri = null;
                try
                {
                    uri = webView.CoreWebView2.Source;
                }
                catch
                {
                }
                if (IsDashboard(uri))
                {
                    // Remembered so "reload" means "reload this page", not "reload
                    // whatever URL we happen to be on".
                    lastDashboardUri = uri;
                }
            }
            else
            {
                loading.Visible = true;
                SetStatus("页面加载失败：" + e.WebErrorStatus);
            }
        }

        /// <summary>
        /// Page to tray. Unknown types are logged and ignored rather than fatal: the
        /// page may be newer than the tray, and a dashboard that will not open because
        /// it said something unexpected is a worse failure than a dropped message.
        /// </summary>
        private void OnWebMessage(object sender, CoreWebView2WebMessageReceivedEventArgs e)
        {
            string raw;
            try
            {
                raw = e.TryGetWebMessageAsString();
            }
            catch (Exception ex)
            {
                LogInit("bridge: unreadable message (" + ex.Message + ")");
                return;
            }
            if (string.IsNullOrEmpty(raw))
            {
                return;
            }

            string type = raw;
            string url = null;
            bool pinned = false;
            bool wellFormed = false;

            if (raw[0] == '{')
            {
                try
                {
                    Dictionary<string, object> envelope =
                        ControlProtocol.Serializer.Deserialize<Dictionary<string, object>>(raw);
                    type = Field(envelope, "type");
                    url = Field(envelope, "url");
                    pinned = Flag(envelope, "pinned");
                    wellFormed = Field(envelope, "v") == "1";
                }
                catch (Exception ex)
                {
                    LogInit("bridge: bad envelope (" + ex.Message + "): " + Truncate(raw));
                    return;
                }
            }
            else if (raw != "rm:close")
            {
                wellFormed = false;
            }
            else
            {
                // The pre-v1 magic string, kept working so an older cached page cannot
                // wedge the flyout.
                type = "close";
            }

            if (!wellFormed && raw[0] == '{')
            {
                LogInit("bridge: unsupported version in " + Truncate(raw));
                return;
            }

            bridgeLastMessage = type;
            switch (type)
            {
                case "bridge":
                case "ready":
                    // The page is up and knows where it is; tell it what the tray thinks.
                    PublishState();
                    break;
                case "close":
                    HidePanel();
                    break;
                case "openExternal":
                    Program.OpenExternal(url);
                    break;
                case "pin":
                    StayOpen = pinned;
                    if (PinnedChanged != null)
                    {
                        PinnedChanged(pinned);
                    }
                    PublishState();
                    break;
                default:
                    LogInit("bridge: unknown type '" + type + "'");
                    break;
            }
        }

        /// <summary>Tells the page what the tray currently is, over the same protocol.</summary>
        private void PublishState()
        {
            if (!webViewReady)
            {
                return;
            }
            try
            {
                Dictionary<string, object> state = new Dictionary<string, object>();
                state["v"] = 1;
                state["type"] = "state";
                state["pinned"] = stayOpen;
                webView.CoreWebView2.PostWebMessageAsJson(ControlProtocol.Encode(state));
            }
            catch (Exception ex)
            {
                LogInit("bridge: could not publish state (" + ex.Message + ")");
            }
        }

        private static string Field(Dictionary<string, object> map, string key)
        {
            object raw;
            if (map != null && map.TryGetValue(key, out raw) && raw != null)
            {
                return Convert.ToString(raw);
            }
            return null;
        }

        /// <summary>
        /// Reads a JSON boolean. Convert.ToString on a bool gives "True", so comparing
        /// the text against "true" silently answers false for every value.
        /// </summary>
        private static bool Flag(Dictionary<string, object> map, string key)
        {
            object raw;
            if (map == null || !map.TryGetValue(key, out raw) || raw == null)
            {
                return false;
            }
            if (raw is bool)
            {
                return (bool)raw;
            }
            string text = Convert.ToString(raw).Trim();
            return string.Equals(text, "true", StringComparison.OrdinalIgnoreCase) || text == "1";
        }

        private static string Truncate(string text)
        {
            if (text == null)
            {
                return "(null)";
            }
            return text.Length <= 200 ? text : text.Substring(0, 200) + "...";
        }

        /// <summary>
        /// The flyout has no address bar and no back button, so a navigation away from
        /// the dashboard is a one way trip - clicking one of the "JSON" links used to
        /// strand the panel on a bare API response. Anything that is not our own origin
        /// is cancelled here and handed to the real browser instead.
        /// </summary>
        private void OnNavigationStarting(object sender, CoreWebView2NavigationStartingEventArgs e)
        {
            if (IsDashboard(e.Uri))
            {
                return;
            }
            e.Cancel = true;
            // Cancelling still produces a NavigationCompleted with a failure status,
            // and that would put the "page failed to load" label on screen for a
            // navigation the user never wanted in the first place.
            cancelledNavigation = true;
            if (IsWeb(e.Uri))
            {
                LogInit("navigation: blocked " + Truncate(e.Uri) + " (opening it externally)");
                Program.OpenExternal(e.Uri);
            }
            else
            {
                // about:blank and friends are the engine's own business, not the user's.
                LogInit("navigation: refused " + Truncate(e.Uri));
            }
        }

        private static bool IsWeb(string uri)
        {
            if (string.IsNullOrEmpty(uri))
            {
                return false;
            }
            return uri.StartsWith("http://", StringComparison.OrdinalIgnoreCase) ||
                uri.StartsWith("https://", StringComparison.OrdinalIgnoreCase);
        }

        /// <summary>
        /// A target="_blank" link with nobody listening gets a WebView2 popup window,
        /// which has no chrome and cannot be closed from the page. Handing it to the
        /// system browser is what the user meant by "open this".
        /// </summary>
        private void OnNewWindowRequested(object sender, CoreWebView2NewWindowRequestedEventArgs e)
        {
            e.Handled = true;
            if (IsWeb(e.Uri))
            {
                LogInit("navigation: new window " + Truncate(e.Uri) + " (opening it externally)");
                Program.OpenExternal(e.Uri);
            }
            else
            {
                LogInit("navigation: refused new window " + Truncate(e.Uri));
            }
        }

        /// <summary>
        /// Whether a URL is a page the flyout can be left sitting on. Same origin is
        /// not enough: the dashboard's own JSON endpoints live there too, and a bare
        /// API response has no chrome to navigate back with - that is exactly how the
        /// panel used to get stranded.
        /// </summary>
        private static bool IsDashboard(string uri)
        {
            if (string.IsNullOrEmpty(uri))
            {
                return false;
            }
            if (!uri.StartsWith(ServerHost.BaseUrl, StringComparison.OrdinalIgnoreCase))
            {
                return false;
            }
            string path = uri.Substring(ServerHost.BaseUrl.Length);
            return !path.StartsWith("/api/", StringComparison.OrdinalIgnoreCase);
        }

        /// <summary>
        /// Hiding suspends the WebView instead of destroying it: the page keeps its
        /// state and reopening is a warm resume measured in milliseconds. Node and
        /// the WebView processes both stay alive, which is what keeps clicks snappy.
        /// </summary>
        private void SuspendWebView()
        {
            if (!webViewReady || suspended)
            {
                return;
            }
            suspended = true;
            BeginSuspend();
        }

        private async void BeginSuspend()
        {
            try
            {
                // Chromium only accepts a suspend while the controller reports
                // itself invisible, and hiding the window is not enough: the
                // control lives inside a form whose visibility changed, not its own.
                SetControllerVisible(false);
                await Task.Delay(120).ConfigureAwait(true);
                bool ok = await webView.CoreWebView2.TrySuspendAsync().ConfigureAwait(true);
                if (!ok)
                {
                    // One retry: the first attempt can land before the compositor
                    // has processed the visibility change.
                    await Task.Delay(150).ConfigureAwait(true);
                    SetControllerVisible(false);
                    await Task.Delay(120).ConfigureAwait(true);
                    ok = await webView.CoreWebView2.TrySuspendAsync().ConfigureAwait(true);
                }
                suspendResult = ok ? 1 : 0;
            }
            catch
            {
                suspendResult = 0;
            }
        }

        /// <summary>
        /// The WinForms control does not expose CoreWebView2Controller publicly, so
        /// the controller is reached by reflection. Missing members are ignored:
        /// the control's own VisibleChanged handling is the primary mechanism.
        /// </summary>
        private void SetControllerVisible(bool visible)
        {
            try
            {
                object controller = FindController();
                if (controller == null)
                {
                    return;
                }
                PropertyInfo isVisible = controller.GetType().GetProperty("IsVisible");
                if (isVisible != null)
                {
                    isVisible.SetValue(controller, visible, null);
                }
            }
            catch
            {
            }
        }

        /// <summary>
        /// The WinForms wrapper keeps its CoreWebView2Controller in the private
        /// field _coreWebView2Controller and never exposes it. Suspend is only
        /// accepted while the controller is invisible, so that field is the one
        /// thing this host has to reach into.
        /// </summary>
        private object FindController()
        {
            Type type = typeof(WebView2);
            FieldInfo field = type.GetField("_coreWebView2Controller",
                BindingFlags.Instance | BindingFlags.NonPublic | BindingFlags.Public);
            if (field != null)
            {
                object value = field.GetValue(webView);
                if (value != null)
                {
                    return value;
                }
            }
            PropertyInfo property = type.GetProperty("CoreWebView2Controller",
                BindingFlags.Instance | BindingFlags.NonPublic | BindingFlags.Public);
            if (property != null)
            {
                return property.GetValue(webView, null);
            }
            return null;
        }

        private void RestoreWebView()
        {
            if (!webViewReady)
            {
                return;
            }
            try
            {
                if (suspended)
                {
                    webView.CoreWebView2.Resume();
                    suspended = false;
                }
                SetControllerVisible(true);
            }
            catch
            {
            }
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                try
                {
                    if (webViewReady)
                    {
                        webView.CoreWebView2.TrySuspendAsync();
                    }
                }
                catch
                {
                }
                if (webView != null)
                {
                    webView.Dispose();
                }
            }
            base.Dispose(disposing);
        }
    }
}
