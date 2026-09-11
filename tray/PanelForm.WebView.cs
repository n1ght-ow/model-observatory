using System;
using System.Drawing;
using System.Diagnostics;
using System.Drawing.Imaging;
using System.IO;
using System.Reflection;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace RouterMonitorTray
{
    /// <summary>
    /// The WebView: creation, navigation, script, suspend and resume.
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
        /// <summary>
        /// The WebView2 controller, created against the host window and owned here.
        ///
        /// This used to be a WinForms WebView2 control, which keeps its controller in
        /// the private field _coreWebView2Controller and never exposes it - suspend is
        /// only accepted while the controller reports itself invisible, so the old code
        /// reached into that field by reflection. CreateCoreWebView2ControllerAsync and
        /// CoreWebView2Controller.IsVisible/Bounds/ZoomFactor/RasterizationScale are all
        /// public, so the reflection is gone and the scaling is explicit.
        /// </summary>
        private CoreWebView2Controller controller;

        private bool webViewReady;

        private bool webViewFailed;

        private bool suspended;

        private bool initStarted;

        private int suspendResult = -1;

        private bool recovering;

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

        public bool WebViewFailed
        {
            get { return webViewFailed; }
        }

        /// <summary>
        /// Creates the window handle without showing anything. The control channel
        /// marshals work onto this form's thread, and BeginInvoke needs a handle to
        /// post to - the tray has one from startup, before the panel is ever opened.
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
                controller.CoreWebView2.Navigate(target);
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
                    controller.CoreWebView2.Navigate(target);
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
                return controller.CoreWebView2.Environment.BrowserVersionString;
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
                return await controller.CoreWebView2.ExecuteScriptAsync(script);
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

                controller = await environment.CreateCoreWebView2ControllerAsync(webHost.Handle)
                    .ConfigureAwait(true);
                LogInit("CreateCoreWebView2ControllerAsync ok");

                CoreWebView2 core = controller.CoreWebView2;
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

                ApplyControllerGeometry();
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

        private void OnProcessFailed(object sender, CoreWebView2ProcessFailedEventArgs e)
        {
            webViewFailed = true;
            SetStatus("渲染进程异常，正在重试…");
            try
            {
                controller.CoreWebView2.Reload();
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
                    uri = controller.CoreWebView2.Source;
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
                // Chromium only accepts a suspend while the controller reports itself
                // invisible, and hiding the window is not enough: this control lives
                // inside a form whose visibility changed, not its own.
                webHost.Visible = false;
                controller.IsVisible = false;
                await Task.Delay(120).ConfigureAwait(true);
                bool ok = await controller.CoreWebView2.TrySuspendAsync().ConfigureAwait(true);
                if (!ok)
                {
                    // One retry: the first attempt can land before the compositor
                    // has processed the visibility change.
                    await Task.Delay(150).ConfigureAwait(true);
                    webHost.Visible = false;
                    controller.IsVisible = false;
                    await Task.Delay(120).ConfigureAwait(true);
                    ok = await controller.CoreWebView2.TrySuspendAsync().ConfigureAwait(true);
                }
                suspendResult = ok ? 1 : 0;
            }
            catch
            {
                suspendResult = 0;
            }
        }

        /// <summary>
        /// Makes the controller fill the host window, in physical pixels.
        ///
        /// BoundsMode is pinned to UseRawPixels so Bounds means what the rest of this
        /// class thinks it means: the CSS viewport is then
        /// Bounds.Width / (RasterizationScale * ZoomFactor), which is the arithmetic
        /// PanelForm.Scaling.cs is built around. RasterizationScale is set explicitly
        /// rather than inferred, so the viewport does not move when the controller
        /// changes its own mind about the display scale.
        /// </summary>
        private void ApplyControllerGeometry()
        {
            SyncControllerBounds();
            if (controller == null)
            {
                return;
            }
            try
            {
                controller.BoundsMode = CoreWebView2BoundsMode.UseRawPixels;
                controller.RasterizationScale = dpiScale;
                controller.ZoomFactor = webZoom;
                controller.DefaultBackgroundColor = Color.White;
                // Let Chromium follow the window between monitors, but re-apply the
                // geometry ourselves when it does so the viewport stays pinned.
                controller.ShouldDetectMonitorScaleChanges = true;
            }
            catch (Exception ex)
            {
                LogInit("controller geometry: " + ex.Message);
            }
        }

        /// <summary>
        /// Puts keyboard focus into the page. A Panel cannot take focus itself, so the
        /// controller is asked to move focus into the WebView; without this the form
        /// never becomes active and hides itself again immediately.
        /// </summary>
        internal void FocusContent()
        {
            try
            {
                Activate();
                // Focus the host first: that is what makes this form the active window,
                // so it does not deactivate - and hide - as soon as its caller exits.
                if (webHost != null && webHost.CanFocus)
                {
                    webHost.Focus();
                }
                if (controller != null)
                {
                    controller.MoveFocus(CoreWebView2MoveFocusReason.Programmatic);
                }
            }
            catch (Exception ex)
            {
                LogInit("focus: " + ex.Message);
            }
        }

        /// <summary>
        /// Gives the controller the host window's client rectangle. Called from the
        /// layout path: the controller does not follow its parent window by itself.
        /// </summary>
        internal void SyncControllerBounds()
        {
            if (controller == null || webHost == null)
            {
                return;
            }
            try
            {
                controller.Bounds = new Rectangle(0, 0, webHost.ClientSize.Width, webHost.ClientSize.Height);
            }
            catch (Exception ex)
            {
                LogInit("controller bounds: " + ex.Message);
            }
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
                    controller.CoreWebView2.Resume();
                    suspended = false;
                }
                webHost.Visible = true;
                ApplyControllerGeometry();
                controller.IsVisible = true;
            }
            catch
            {
            }
        }
    }
}
