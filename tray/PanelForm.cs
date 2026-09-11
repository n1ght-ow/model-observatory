using System;
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

        private const int ScreenMargin = 24;
        private const int WM_NCHITTEST = 0x0084;
        private const int WM_SYSCOMMAND = 0x0112;
        private const int WM_WINDOWPOSCHANGING = 0x0046;
        private const int WM_MOVING = 0x0216;
        private const int HTCLIENT = 1;
        private const int SC_SIZE = 0xF000;
        private const int SC_MOVE = 0xF010;

        private const string BridgeScript =
            "(function(){if(window.__rmBridge){return;}window.__rmBridge=1;" +
            "document.addEventListener('keydown',function(e){" +
            "if(e.key!=='Escape'){return;}" +
            "var open=document.querySelector('[role=\"dialog\"],[role=\"listbox\"],[role=\"menu\"]');" +
            "if(open){return;}" +
            "try{window.chrome.webview.postMessage('rm:close');}catch(err){}" +
            "},true);})();";

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
        private readonly float dpiScale;   // display scale, e.g. 1.5 at 150%
        private readonly float scale;      // physical pixels per CSS pixel
        private readonly double webZoom;   // the ZoomFactor that produces it

        private bool stayOpen;
        private bool webViewReady;
        private bool webViewFailed;
        private bool suspended;
        private bool initStarted;
        private int suspendResult = -1;

        private Point anchor;
        private bool hasAnchor;
        private string startPage = "/";

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

        public bool WebViewFailed
        {
            get { return webViewFailed; }
        }

        public PanelForm()
        {
            dpiScale = DetectDpiScale();
            scale = ComputeScale(dpiScale);
            webZoom = scale / dpiScale;

            FormBorderStyle = FormBorderStyle.None;
            ShowInTaskbar = false;
            StartPosition = FormStartPosition.Manual;
            TopMost = true;
            KeyPreview = true;
            Text = "Router Monitor";
            BackColor = Color.FromArgb(255, 255, 255);

            ClientSize = new Size(
                (int)Math.Round(CssWidth * scale),
                (int)Math.Round(CssHeight * scale));

            webView = new WebView2();
            webView.Dock = DockStyle.Fill;
            webView.DefaultBackgroundColor = Color.White;
            Controls.Add(webView);

            // A single label, shown only while the local server is starting or the
            // first page is still loading. It deliberately imitates nothing.
            loading = new Label();
            loading.Dock = DockStyle.Fill;
            loading.TextAlign = ContentAlignment.MiddleCenter;
            loading.BackColor = Color.FromArgb(255, 255, 255);
            loading.ForeColor = Color.FromArgb(120, 120, 120);
            loading.Font = new Font("Segoe UI", 11f, FontStyle.Regular);
            loading.Text = "正在启动本地服务…";
            Controls.Add(loading);
            loading.BringToFront();
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
        private static float ComputeScale(float dpiScale)
        {
            float fit = dpiScale;
            try
            {
                Screen screen = Screen.PrimaryScreen;
                if (screen != null)
                {
                    Rectangle work = screen.WorkingArea;
                    float fitX = (work.Width - ScreenMargin) / (float)CssWidth;
                    float fitY = (work.Height - ScreenMargin) / (float)CssHeight;
                    fit = Math.Min(fitX, fitY);
                }
            }
            catch
            {
            }

            float value = Math.Min(dpiScale, fit);
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
            hasAnchor = true;
            Location = position;
        }

        protected override void WndProc(ref Message m)
        {
            if (m.Msg == WM_NCHITTEST)
            {
                m.Result = (IntPtr)HTCLIENT;
                return;
            }
            if (m.Msg == WM_SYSCOMMAND)
            {
                int command = m.WParam.ToInt32() & 0xFFF0;
                if (command == SC_MOVE || command == SC_SIZE)
                {
                    m.Result = IntPtr.Zero;
                    return;
                }
            }
            if ((m.Msg == WM_WINDOWPOSCHANGING || m.Msg == WM_MOVING) && hasAnchor && Visible)
            {
                WINDOWPOS pos = (WINDOWPOS)Marshal.PtrToStructure(m.LParam, typeof(WINDOWPOS));
                if (pos.x != anchor.X || pos.y != anchor.Y)
                {
                    pos.x = anchor.X;
                    pos.y = anchor.Y;
                    Marshal.StructureToPtr(pos, m.LParam, false);
                }
            }
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
            PositionNearTray();
            Visible = true;
            BringToFront();
            Activate();
            webView.Focus();
            if (!webViewReady && !initStarted)
            {
                StartInit();
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

        public void Reload()
        {
            if (webViewReady)
            {
                try
                {
                    webView.CoreWebView2.Reload();
                    return;
                }
                catch
                {
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
            catch
            {
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
                SetStatus(@"本地服务启动失败，请检查 logs\dashboard.log");
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
            if (e.IsSuccess)
            {
                if (loading.Visible)
                {
                    loading.Visible = false;
                }
            }
            else
            {
                loading.Visible = true;
                SetStatus("页面加载失败：" + e.WebErrorStatus);
            }
        }

        private void OnWebMessage(object sender, CoreWebView2WebMessageReceivedEventArgs e)
        {
            string message;
            try
            {
                message = e.TryGetWebMessageAsString();
            }
            catch
            {
                return;
            }
            if (message == "rm:close")
            {
                HidePanel();
            }
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
