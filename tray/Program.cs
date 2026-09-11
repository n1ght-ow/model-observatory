using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

namespace RouterMonitorTray
{
    internal sealed class PanelForm : Form
    {
        private readonly PanelView view = new PanelView();

        public PanelView View
        {
            get { return view; }
        }

        /// <summary>When true the flyout survives losing focus (pinned by the user).</summary>
        public bool StayOpen;

        /// <summary>
        /// Where the flyout belongs. The panel is anchored to the tray icon, never
        /// dragged: the position is recomputed on every show and re-asserted if
        /// Windows tries to move the window for any other reason.
        /// </summary>
        private Point anchor;
        private bool hasAnchor;

        private const int WM_NCHITTEST = 0x0084;
        private const int WM_SYSCOMMAND = 0x0112;
        private const int WM_WINDOWPOSCHANGING = 0x0046;
        private const int WM_MOVING = 0x0216;
        private const int HTCLIENT = 1;
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

        /// <summary>Pins the flyout to the given screen position.</summary>
        public void AnchorTo(Point position)
        {
            anchor = position;
            hasAnchor = true;
            Location = position;
        }

        protected override void WndProc(ref Message m)
        {
            // A borderless popup must not expose a caption or a resize border, so
            // every hit test reports client area and the move/resize system
            // commands are swallowed (this also blocks Alt+Space, Move).
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
            // Anything that still tries to relocate the window is pulled back to
            // the anchor, so the panel stays put no matter who asks.
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

        public PanelForm(float scale)
        {
            FormBorderStyle = FormBorderStyle.None;
            ShowInTaskbar = false;
            StartPosition = FormStartPosition.Manual;
            TopMost = true;
            KeyPreview = true;
            Text = "Router Monitor";
            BackColor = Theme.Bg;

            int width = (int)Math.Round(PanelView.LogicalWidth * scale);
            int height = (int)Math.Round(PanelView.LogicalHeight * scale);
            ClientSize = new Size(width, height);

            view.Dock = DockStyle.Fill;
            Controls.Add(view);
        }

        protected override CreateParams CreateParams
        {
            get
            {
                CreateParams cp = base.CreateParams;
                cp.ClassStyle |= 0x20000; // CS_DROPSHADOW
                // No caption and no resize frame: with FormBorderStyle.None these
                // are normally already clear, but a fixed popup must never expose
                // them, so they are masked off explicitly.
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
        /// Windows 11 draws the rounded corners and the dark border for us,
        /// which looks sharper than clipping the window with a Region.
        /// </summary>
        private void ApplySystemFrame()
        {
            try
            {
                int round = 2; // DWMWCP_ROUND
                DwmSetWindowAttribute(Handle, 33, ref round, 4);
                int dark = 1;
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

        protected override void OnMouseWheel(MouseEventArgs e)
        {
            base.OnMouseWheel(e);
            view.HandleWheel(e.Delta);
        }

        protected override void OnKeyDown(KeyEventArgs e)
        {
            if (e.KeyCode == Keys.Escape)
            {
                // Escape unwinds the popup stack first: an open Cmd-K menu or a
                // dropdown closes, and only a bare panel hides the flyout.
                if (!view.ClosePopup())
                {
                    Hide();
                }
                e.Handled = true;
                e.SuppressKeyPress = true;
                return;
            }
            base.OnKeyDown(e);
        }

        protected override void OnDeactivate(EventArgs e)
        {
            base.OnDeactivate(e);
            if (!StayOpen)
            {
                Hide();
            }
        }
    }

    internal sealed class TrayContext : ApplicationContext
    {
        private const string MutexName = "RouterMonitorTray.SingleInstance";

        private readonly NotifyIcon notifyIcon;
        private readonly PanelForm panel;
        private readonly ContextMenuStrip menu;
        private ToolStripMenuItem itemAutoStart;
        private ToolStripMenuItem itemPin;
        private readonly Icon trayIcon;
        private readonly Icon panelIcon;
        private readonly float panelScale;
        private readonly System.Windows.Forms.Timer refreshTimer;

        private readonly object gate = new object();
        private Snapshot current;
        private bool refreshing;
        private bool disposed;
        private bool autoStart;
        private string sourceMode = "auto";
        private string lastError;
        private DateTime lastServerStart = DateTime.MinValue;

        public bool PinnedPanel
        {
            get { return itemPin != null && itemPin.Checked; }
        }

        public TrayContext()
        {
            panelScale = FitScale(DetectScale());

            trayIcon = LoadIcon("router-monitor-tray.ico") ?? SystemIcons.Application;
            panelIcon = trayIcon;

            panel = new PanelForm(panelScale);
            panel.View.SetIcon(panelIcon);
            panel.View.OpenWebRequested += OpenWeb;
            panel.View.RefreshRequested += () => RefreshNow();
            panel.View.ReloadRequested += () => RefreshNow();
            panel.View.OpenUrlRequested += OpenUrl;
            panel.View.QuitRequested += Quit;

            menu = BuildMenu();

            notifyIcon = new NotifyIcon();
            notifyIcon.Icon = trayIcon;
            notifyIcon.Text = "Router Monitor";
            notifyIcon.ContextMenuStrip = menu;
            notifyIcon.Visible = true;
            notifyIcon.MouseUp += OnTrayMouseUp;
            notifyIcon.DoubleClick += (sender, args) => OpenWeb();

            autoStart = HasAutoStart();
            itemAutoStart.Checked = autoStart;

            RefreshNow();

            refreshTimer = new System.Windows.Forms.Timer();
            refreshTimer.Interval = 5000;
            refreshTimer.Tick += (sender, args) => RefreshNow();
            refreshTimer.Start();
        }

        private static float DetectScale()
        {
            using (Graphics g = Graphics.FromHwnd(IntPtr.Zero))
            {
                float dpi = g.DpiX;
                if (dpi <= 0f)
                {
                    return 1f;
                }
                return Math.Max(1f, dpi / 96f);
            }
        }

        private static Icon LoadIcon(string fileName)
        {
            try
            {
                string path = Path.Combine(Api.ProjectRoot, "public", fileName);
                if (File.Exists(path))
                {
                    return new Icon(path);
                }
            }
            catch
            {
            }
            return null;
        }

        private ContextMenuStrip BuildMenu()
        {
            ContextMenuStrip strip = new ContextMenuStrip();
            strip.ShowImageMargin = false;

            ToolStripMenuItem open = new ToolStripMenuItem("打开面板");
            open.Font = new Font(open.Font, FontStyle.Bold);
            open.Click += (sender, args) => ShowPanel();
            strip.Items.Add(open);

            ToolStripMenuItem web = new ToolStripMenuItem("打开网页版");
            web.Click += (sender, args) => OpenWeb();
            strip.Items.Add(web);

            ToolStripMenuItem refresh = new ToolStripMenuItem("立即刷新");
            refresh.Click += (sender, args) => RefreshNow();
            strip.Items.Add(refresh);

            strip.Items.Add(new ToolStripSeparator());

            ToolStripMenuItem source = new ToolStripMenuItem("数据源");
            string[] ids = new string[] { "auto", "deepseek", "router" };
            string[] labels = new string[] { "跟随当前配置", "DeepSeek API", "Codex Router API" };
            for (int i = 0; i < ids.Length; i++)
            {
                string id = ids[i];
                ToolStripMenuItem entry = new ToolStripMenuItem(labels[i]);
                entry.Tag = id;
                entry.Checked = id == sourceMode;
                entry.Click += (sender, args) =>
                {
                    sourceMode = id;
                    panel.View.State.Source = id;
                    foreach (ToolStripItem item in ((ToolStripMenuItem)sender).Owner.Items)
                    {
                        ToolStripMenuItem sibling = item as ToolStripMenuItem;
                        if (sibling != null && sibling.Tag is string)
                        {
                            sibling.Checked = (string)sibling.Tag == id;
                        }
                    }
                    RefreshNow();
                };
                source.DropDownItems.Add(entry);
            }
            strip.Items.Add(source);

            ToolStripMenuItem pin = new ToolStripMenuItem("固定面板");
            pin.CheckOnClick = true;
            pin.Click += (sender, args) => panel.StayOpen = pin.Checked;
            strip.Items.Add(pin);
            itemPin = pin;

            ToolStripMenuItem auto = new ToolStripMenuItem("开机自动启动");
            auto.CheckOnClick = true;
            auto.Click += (sender, args) => ToggleAutoStart(auto.Checked);
            strip.Items.Add(auto);
            itemAutoStart = auto;

            strip.Items.Add(new ToolStripSeparator());

            ToolStripMenuItem quit = new ToolStripMenuItem("退出");
            quit.Click += (sender, args) => Quit();
            strip.Items.Add(quit);

            return strip;
        }

        private void OnTrayMouseUp(object sender, MouseEventArgs e)
        {
            if (e.Button == MouseButtons.Left)
            {
                if (panel.Visible)
                {
                    panel.Hide();
                }
                else
                {
                    ShowPanel();
                }
            }
            else if (e.Button == MouseButtons.Right)
            {
                // Refresh the tray tooltip before the menu opens so the numbers
                // on screen match what the user is about to read.
                UpdateTooltip();
            }
        }

        private void ShowPanel()
        {
            Rectangle cursor = new Rectangle(Cursor.Position, new Size(1, 1));
            Screen screen = Screen.FromRectangle(cursor) ?? Screen.PrimaryScreen;
            Rectangle work = screen.WorkingArea;

            int x = cursor.X - panel.Width + (int)(24 * panelScale);
            int y = cursor.Y - panel.Height - (int)(10 * panelScale);

            if (y < work.Top)
            {
                y = cursor.Y + (int)(12 * panelScale);
            }
            x = Math.Max(work.Left + 8, Math.Min(x, work.Right - panel.Width - 8));
            y = Math.Max(work.Top + 8, Math.Min(y, work.Bottom - panel.Height - 8));

            // AnchorTo both moves the flyout and records where it belongs, so the
            // window cannot be dragged away from the tray icon.
            panel.AnchorTo(new Point(x, y));
            panel.Show();
            panel.BringToFront();
            panel.Activate();
            RefreshNow();
        }

        private void OpenUrl(string url)
        {
            try
            {
                Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
            }
            catch (Exception ex)
            {
                lastError = "无法打开链接：" + ex.Message;
                PushState();
            }
        }

        /// <summary>
        /// The panel is a fixed 900x680 CSS-pixel surface; make sure it still
        /// fits the work area on small or heavily scaled displays.
        /// </summary>
        private static float FitScale(float scale)
        {
            try
            {
                Screen screen = Screen.PrimaryScreen;
                if (screen == null)
                {
                    return scale;
                }
                Rectangle work = screen.WorkingArea;
                float fitX = (work.Width - 24f) / PanelView.LogicalWidth;
                float fitY = (work.Height - 24f) / PanelView.LogicalHeight;
                float fit = Math.Min(fitX, fitY);
                if (fit < 0.6f)
                {
                    fit = 0.6f;
                }
                return Math.Min(scale, fit);
            }
            catch
            {
                return scale;
            }
        }

        private void OpenWeb()
        {
            try
            {
                string detail;
                Api.EnsureServer(8000, out detail);
                Process.Start(new ProcessStartInfo(Api.BaseUrl + "/") { UseShellExecute = true });
            }
            catch (Exception ex)
            {
                lastError = "无法打开网页版：" + ex.Message;
                PushState();
            }
        }

        /// <summary>
        /// Kicks off a background read. Result is marshalled back onto the UI
        /// thread because both the tray tooltip and the panel are GDI objects.
        /// </summary>
        private void RefreshNow()
        {
            lock (gate)
            {
                if (refreshing || disposed)
                {
                    return;
                }
                refreshing = true;
            }

            panel.View.UpdateState(current, true, lastError);
            UpdateTooltip();

            // Snapshot the view state on the UI thread: the read itself runs on
            // a worker, and clicks can change the source mid-flight.
            LoadRequest request = new LoadRequest();
            request.Source = panel.View.State.ApiSource;
            request.Days = panel.View.State.Days;
            request.Limit = panel.View.State.Limit;
            request.Provider = panel.View.State.Provider;
            request.Model = panel.View.State.Model;

            ThreadPool.QueueUserWorkItem(delegate
            {
                Snapshot snapshot = null;
                string error = null;
                try
                {
                    if (!Api.ServerUp(2000))
                    {
                        string detail;
                        if (DateTime.Now - lastServerStart > TimeSpan.FromSeconds(30))
                        {
                            lastServerStart = DateTime.Now;
                            Api.EnsureServer(20000, out detail);
                        }
                    }
                    snapshot = Api.Load(request);
                }
                catch (Exception ex)
                {
                    error = ex.Message;
                }

                lock (gate)
                {
                    refreshing = false;
                    if (snapshot != null)
                    {
                        current = snapshot;
                        lastError = null;
                    }
                    else
                    {
                        lastError = error ?? "读取失败";
                    }
                }

                try
                {
                    panel.BeginInvoke((MethodInvoker)delegate { PushState(); });
                }
                catch
                {
                }
            });
        }

        private void PushState()
        {
            if (disposed)
            {
                return;
            }
            panel.View.UpdateState(current, false, lastError);
            UpdateTooltip();
        }

        private void UpdateTooltip()
        {
            Snapshot snapshot = current;
            string text;
            if (snapshot == null)
            {
                text = lastError == null ? "Router Monitor · 正在连接…" : "Router Monitor · 本地服务不可用";
            }
            else
            {
                text = "Router Monitor · " + snapshot.SourceLabel + "\r\n" +
                       "请求 " + Fmt.Int(snapshot.Window.Requests) + " · Tokens " + Fmt.Count(snapshot.Window.Tokens) + "\r\n" +
                       "成功率 " + Fmt.Percent(snapshot.Window.SuccessRate) +
                       (snapshot.Caps.Latency ? " · " + Fmt.Duration(snapshot.Window.AvgMs) : "");
            }
            if (text.Length > 127)
            {
                text = text.Substring(0, 124) + "…";
            }
            try
            {
                notifyIcon.Text = text;
            }
            catch
            {
            }
            if (lastError != null)
            {
                notifyIcon.Icon = trayIcon;
            }
        }

        private static string StartupLinkPath()
        {
            string dir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                @"Microsoft\Windows\Start Menu\Programs\Startup");
            return Path.Combine(dir, "Router Monitor Tray.lnk");
        }

        /// <summary>
        /// Autostart is a shortcut in the Startup folder: registering a logon
        /// scheduled task needs elevation, a Startup shortcut does not.
        /// </summary>
        private static bool HasAutoStart()
        {
            try
            {
                return File.Exists(StartupLinkPath());
            }
            catch
            {
                return false;
            }
        }

        private void ToggleAutoStart(bool enabled)
        {
            try
            {
                string link = StartupLinkPath();
                if (enabled)
                {
                    string dir = Path.GetDirectoryName(link);
                    if (dir != null && !Directory.Exists(dir))
                    {
                        Directory.CreateDirectory(dir);
                    }
                    WriteShortcut(link, Application.ExecutablePath);
                }
                else if (File.Exists(link))
                {
                    File.Delete(link);
                }
                autoStart = enabled;
                itemAutoStart.Checked = enabled;
            }
            catch (Exception ex)
            {
                autoStart = HasAutoStart();
                itemAutoStart.Checked = autoStart;
                lastError = "设置开机启动失败：" + ex.Message;
                PushState();
            }
        }

        /// <summary>Writes a .lnk through the WScript.Shell COM object.</summary>
        private static void WriteShortcut(string linkPath, string target)
        {
            Type shellType = Type.GetTypeFromProgID("WScript.Shell");
            if (shellType == null)
            {
                throw new InvalidOperationException("系统未提供 WScript.Shell，无法创建快捷方式");
            }
            object shell = Activator.CreateInstance(shellType);
            try
            {
                object shortcut = shellType.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod,
                    null, shell, new object[] { linkPath });
                Type type = shortcut.GetType();
                type.InvokeMember("TargetPath", BindingFlags.SetProperty, null, shortcut, new object[] { target });
                type.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, shortcut,
                    new object[] { Api.ProjectRoot });
                type.InvokeMember("Description", BindingFlags.SetProperty, null, shortcut,
                    new object[] { "Router Monitor 系统托盘" });
                string icon = Path.Combine(Api.ProjectRoot, @"public\router-monitor-tray.ico");
                if (File.Exists(icon))
                {
                    type.InvokeMember("IconLocation", BindingFlags.SetProperty, null, shortcut,
                        new object[] { icon + ",0" });
                }
                type.InvokeMember("Save", BindingFlags.InvokeMethod, null, shortcut, null);
            }
            finally
            {
                Marshal.ReleaseComObject(shell);
            }
        }

        private void Quit()
        {
            ExitThread();
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing && !disposed)
            {
                disposed = true;
                if (refreshTimer != null)
                {
                    refreshTimer.Stop();
                    refreshTimer.Dispose();
                }
                if (notifyIcon != null)
                {
                    notifyIcon.Visible = false;
                    notifyIcon.Dispose();
                }
                if (panel != null)
                {
                    panel.Dispose();
                }
                if (menu != null)
                {
                    menu.Dispose();
                }
                if (trayIcon != null)
                {
                    trayIcon.Dispose();
                }
            }
            base.Dispose(disposing);
        }
    }

    internal static class Program
    {
        [DllImport("user32.dll")]
        private static extern bool SetProcessDPIAware();

        [DllImport("user32.dll")]
        private static extern bool SetProcessDpiAwarenessContext(IntPtr value);

        // Used by the --check-window self-test.
        [DllImport("user32.dll")]
        private static extern IntPtr SendMessage(IntPtr hwnd, int msg, IntPtr wParam, IntPtr lParam);

        [DllImport("user32.dll")]
        private static extern bool MoveWindow(IntPtr hwnd, int x, int y, int width, int height, bool repaint);

        [DllImport("user32.dll")]
        private static extern int GetWindowLong(IntPtr hwnd, int index);

        private const int DiagnoseHitTest = 0x0084;

        [STAThread]
        private static void Main(string[] args)
        {
            for (int i = 0; i < args.Length; i++)
            {
                if (args[i] == "--url" && i + 1 < args.Length)
                {
                    Api.BaseUrl = args[i + 1];
                }
                else if (args[i] == "--root" && i + 1 < args.Length)
                {
                    Api.ProjectRoot = args[i + 1];
                }
            }

            if (Array.IndexOf(args, "--no-kern") >= 0)
            {
                Kerning.Enabled = false;
            }

            TryEnableDpiAwareness();

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            // Diagnostic: measure strings the way the panel does, so a wrapped
            // paragraph can be compared against the browser's line boxes.
            if (Array.IndexOf(args, "--measure-text") >= 0)
            {
                Fonts.Load();
                using (Bitmap surface = new Bitmap(8, 8))
                using (Graphics g = Graphics.FromImage(surface))
                {
                    for (int i = 0; i < args.Length - 1; i++)
                    {
                        if (args[i] != "--measure-text")
                        {
                            continue;
                        }
                        string probe = args[i + 1];
                        // Sizes and weights the layout actually uses, so a
                        // measurement can be compared with the browser's rects.
                        Console.WriteLine(probe.Length + " chars  " + probe);
                        Console.WriteLine("   12/400 " + Theme.Measure(g, probe, 12f, FontStyle.Regular).ToString("0.0").PadLeft(7) +
                            "   12/500 " + Theme.MeasureW(g, probe, 12f, 500).ToString("0.0").PadLeft(7) +
                            "   14/400 " + Theme.Measure(g, probe, 14f, FontStyle.Regular).ToString("0.0").PadLeft(7));
                        Console.WriteLine("   16/500 " + Theme.MeasureW(g, probe, 16f, 500).ToString("0.0").PadLeft(7) +
                            "   20/600 " + Theme.MeasureW(g, probe, 20f, 600).ToString("0.0").PadLeft(7));
                    }
                }
                return;
            }

            // Diagnostics run before the single-instance lock is taken, so the
            // panel can be rendered while the real tray is already running.
            // Diagnostic: report the typography the panel will actually draw with.
            if (Array.IndexOf(args, "--fonts") >= 0)
            {
                Fonts.Load();
                Console.WriteLine("embedded resources: " +
                    string.Join(", ", Assembly.GetExecutingAssembly().GetManifestResourceNames()));
                FontFamily[] families = Fonts.Families();
                Console.WriteLine("loaded families (" + families.Length + "):");
                for (int i = 0; i < families.Length; i++)
                {
                    Console.WriteLine("  " + families[i].Name);
                }
                Console.WriteLine("Geist probe: " + (Fonts.Find("Geist") == null ? "MISSING" : "ok"));
                Console.WriteLine("Geist Bold probe: " + (Fonts.Find("Geist Bold") == null ? "MISSING" : "ok"));
                return;
            }

            // Diagnostic: prove the flyout is anchored, by asking Windows to move
            // it and reporting where it ends up.
            if (Array.IndexOf(args, "--check-window") >= 0)
            {
                using (PanelForm probe = new PanelForm(1f))
                {
                    probe.AnchorTo(new Point(400, 300));
                    probe.Show();
                    Application.DoEvents();

                    int style = GetWindowLong(probe.Handle, -16);
                    int exStyle = GetWindowLong(probe.Handle, -20);
                    Console.WriteLine("style   : 0x" + style.ToString("X8"));
                    Console.WriteLine("  WS_CAPTION     : " + (((style & 0x00C00000) != 0) ? "PRESENT" : "absent"));
                    Console.WriteLine("  WS_THICKFRAME  : " + (((style & 0x00040000) != 0) ? "PRESENT" : "absent"));
                    Console.WriteLine("  WS_SYSMENU     : " + (((style & 0x00080000) != 0) ? "PRESENT" : "absent"));
                    Console.WriteLine("exstyle : 0x" + exStyle.ToString("X8"));

                    string[] names = new string[] { "top-left", "centre", "top edge", "bottom-right" };
                    int[] px = new int[] { 4, probe.Width / 2, probe.Width / 2, probe.Width - 4 };
                    int[] py = new int[] { 4, probe.Height / 2, 2, probe.Height - 4 };
                    for (int i = 0; i < names.Length; i++)
                    {
                        int packed = (py[i] << 16) | (px[i] & 0xFFFF);
                        IntPtr hit = SendMessage(probe.Handle, DiagnoseHitTest, IntPtr.Zero, (IntPtr)packed);
                        int code = hit.ToInt32();
                        Console.WriteLine("nchittest at " + names[i].PadRight(13) + " -> " +
                            code + (code == 1 ? " (HTCLIENT)" : code == 2 ? " (HTCAPTION!)" : ""));
                    }

                    // Ask Windows to move it, the way a drag would.
                    probe.Location = new Point(900, 700);
                    Application.DoEvents();
                    Console.WriteLine("after Location=(900,700): actual " +
                        probe.Location.X + "," + probe.Location.Y);
                    MoveWindow(probe.Handle, 950, 120, probe.Width, probe.Height, true);
                    Application.DoEvents();
                    Console.WriteLine("after MoveWindow(950,120): actual " +
                        probe.Location.X + "," + probe.Location.Y);

                    bool stuck = probe.Location.X == 400 && probe.Location.Y == 300;
                    Console.WriteLine(stuck
                        ? "RESULT: anchored - the flyout stays where the tray put it"
                        : "RESULT: MOVED - the flyout is draggable");
                    probe.Hide();
                }
                return;
            }

            string renderPath = ArgValue(args, "--render");
            if (renderPath.Length > 0)
            {
                float scale = 1f;
                string scaleArg = ArgValue(args, "--scale");
                if (scaleArg.Length > 0)
                {
                    float.TryParse(scaleArg, System.Globalization.NumberStyles.Float,
                        System.Globalization.CultureInfo.InvariantCulture, out scale);
                }
                float scroll = 0f;
                string scrollArg = ArgValue(args, "--scroll");
                if (scrollArg.Length > 0)
                {
                    float.TryParse(scrollArg, System.Globalization.NumberStyles.Float,
                        System.Globalization.CultureInfo.InvariantCulture, out scroll);
                }
                Environment.ExitCode = RenderPreview(renderPath, scale <= 0f ? 1f : scale,
                    ArgValue(args, "--source"), scroll, ArgValue(args, "--page"), ArgValue(args, "--range"),
                    ArgValue(args, "--theme"), ArgValue(args, "--popup"), ArgValue(args, "--provider"),
                    ArgValue(args, "--model"), ArgValue(args, "--sidebar"), ArgValue(args, "--hover"),
                    ArgValue(args, "--query"), ArgValue(args, "--form"), dumpLayout: args.Length > 0 && Array.IndexOf(args, "--dump-layout") >= 0);
                return;
            }

            bool createdNew;
            using (Mutex mutex = new Mutex(true, "Global\\" + MutexName(), out createdNew))
            {
                if (!createdNew)
                {
                    return;
                }

                Application.Run(new TrayContext());
            }
        }

        private static string ArgValue(string[] args, string name)
        {
            for (int i = 0; i < args.Length - 1; i++)
            {
                if (args[i] == name)
                {
                    return args[i + 1];
                }
            }
            return "";
        }

        /// <summary>
        /// Renders the flyout to a PNG without showing any window. Used to check
        /// the layout on this machine instead of eyeballing the live tray.
        /// </summary>
        private static int RenderPreview(string path, float scale, string source, float scroll,
            string page, string range, string theme, string popup, string provider, string model,
            string sidebar, string hoverKey, string query, string formMode, bool dumpLayout)
        {
            if (page.Length == 0)
            {
                page = "overview";
            }
            if (range.Length == 0)
            {
                range = "7";
            }
            // "--form" hosts the view in its real window so the renderer also
            // captures child controls (the Cmd-K search field is a real TextBox).
            if (formMode == "host")
            {
                return RenderHost(path, scale, page, range, source, theme, popup, query);
            }

            Snapshot snapshot = null;
            string error = null;
            using (PanelView view = new PanelView())
            {
                view.State.Page = page;
                view.State.Range = range;
                if (source.Length > 0)
                {
                    view.State.Source = source;
                }
                view.State.Provider = provider;
                view.State.Model = model;
                if (sidebar == "collapsed")
                {
                    view.State.SidebarCollapsed = true;
                }
                // The default surface is light (matching the web app), so only an
                // explicit --theme dark flips it. Without this branch the flag was
                // parsed but ignored on the headless path, and every dark preview
                // silently rendered in the light theme.
                if (theme == "dark")
                {
                    view.State.Light = false;
                    Theme.SetDark(true);
                }
                else if (theme == "light")
                {
                    view.State.Light = true;
                    Theme.SetDark(false);
                }

                try
                {
                    string detail;
                    Api.EnsureServer(20000, out detail);
                    LoadRequest request = new LoadRequest();
                    request.Source = view.State.ApiSource;
                    request.Days = view.State.Days;
                    request.Limit = view.State.Limit;
                    request.Provider = view.State.Provider;
                    request.Model = view.State.Model;
                    snapshot = Api.Load(request);
                }
                catch (Exception ex)
                {
                    error = ex.Message;
                }

                try
                {
                    string iconPath = Path.Combine(Api.ProjectRoot, @"public\router-monitor-tray.ico");
                    if (File.Exists(iconPath))
                    {
                        view.SetIcon(new Icon(iconPath));
                    }
                }
                catch
                {
                }
                view.UpdateState(snapshot, false, error);
                view.ScrollTo(scroll);
                view.State.Query = query;
                if (popup.Length > 0)
                {
                    view.OpenPopup(popup);
                    if (query.Length > 0)
                    {
                        // The renderer has no focused TextBox, so seed the filter
                        // directly and let the paint code draw the string.
                        view.CloseInputForRender();
                        view.State.Query = query;
                        view.State.Popup = popup;
                    }
                }
                if (hoverKey.Length > 0)
                {
                    view.ForceHover(hoverKey);
                }
                if (dumpLayout)
                {
                    Console.Write(view.DumpLayout());
                }

                int width = (int)Math.Round(PanelView.LogicalWidth * scale);
                int height = (int)Math.Round(PanelView.LogicalHeight * scale);
                using (Bitmap bitmap = new Bitmap(width, height))
                {
                    view.Size = new Size(width, height);
                    view.DrawToBitmap(bitmap, new Rectangle(0, 0, width, height));
                    string full = Path.GetFullPath(path);
                    Directory.CreateDirectory(Path.GetDirectoryName(full));
                    bitmap.Save(full, System.Drawing.Imaging.ImageFormat.Png);
                    Console.WriteLine("wrote " + full);
                }
            }

            return snapshot != null ? 0 : 1;
        }

        /// <summary>Renders the panel the way the user sees it, child controls included.</summary>
        private static int RenderHost(string path, float scale, string page, string range, string source,
            string theme, string popup, string query)
        {
            int result = 1;
            using (PanelForm form = new PanelForm(scale))
            {
                PanelView view = form.View;
                view.State.Page = page;
                view.State.Range = range;
                if (source.Length > 0)
                {
                    view.State.Source = source;
                }
                if (theme == "dark")
                {
                    view.State.Light = false;
                    Theme.SetDark(true);
                }
                try
                {
                    string detail;
                    Api.EnsureServer(20000, out detail);
                    LoadRequest request = new LoadRequest();
                    request.Source = view.State.ApiSource;
                    request.Days = view.State.Days;
                    request.Limit = view.State.Limit;
                    Snapshot snapshot = Api.Load(request);
                    view.UpdateState(snapshot, false, null);
                    result = 0;
                }
                catch (Exception ex)
                {
                    view.UpdateState(null, false, ex.Message);
                }

                try
                {
                    string iconPath = Path.Combine(Api.ProjectRoot, @"publicouter-monitor-tray.ico");
                    if (File.Exists(iconPath))
                    {
                        view.SetIcon(new Icon(iconPath));
                    }
                }
                catch
                {
                }

                // DrawToBitmap of an unshown form renders nothing, and a hosted
                // TextBox only reports Visible once its parent window exists, so
                // the form is realised just off the desktop for the capture.
                form.StartPosition = FormStartPosition.Manual;
                form.Location = new Point(-32000, -32000);
                form.Show();
                Application.DoEvents();
                // The capture must not include the pointer that the offscreen
                // show would otherwise leave over the search field.
                Cursor.Hide();
                Cursor.Position = new Point(-31000, -31000);
                Application.DoEvents();

                IntPtr handle = form.Handle;
                form.CreateControl();
                if (popup.Length > 0)
                {
                    view.OpenPopup(popup);
                }
                view.DiagnosticText = true;
                if (query.Length > 0)
                {
                    view.SetQuery(query);
                }
                view.Refresh();
                Application.DoEvents();

                RectangleF probe = view.CommandInputProbe();
                Console.WriteLine("input visible=" + view.CommandInputVisible +
                    " bounds=" + probe.X.ToString("0") + "," + probe.Y.ToString("0") + " " +
                    probe.Width.ToString("0") + "x" + probe.Height.ToString("0") +
                    " text=" + view.CommandInputText + " handle=" + handle.ToString());

                using (Bitmap bitmap = new Bitmap(form.Width, form.Height))
                {
                    form.DrawToBitmap(bitmap, new Rectangle(0, 0, form.Width, form.Height));
                    string full = Path.GetFullPath(path);
                    Directory.CreateDirectory(Path.GetDirectoryName(full));
                    bitmap.Save(full, System.Drawing.Imaging.ImageFormat.Png);
                    Console.WriteLine("wrote " + full);
                }
                form.Hide();
                Cursor.Show();
            }
            return result;
        }

        private static string MutexName()
        {
            return "RouterMonitorTray.SingleInstance";
        }

        private static void TryEnableDpiAwareness()
        {
            try
            {
                // -4 == DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2
                if (SetProcessDpiAwarenessContext(new IntPtr(-4)))
                {
                    return;
                }
            }
            catch
            {
            }
            try
            {
                SetProcessDPIAware();
            }
            catch
            {
            }
        }
    }
}
