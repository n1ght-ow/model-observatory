using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Management;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace RouterMonitorTray
{
    /// <summary>
    /// Tray shell: notification icon, context menu, autostart and the flyout that
    /// renders the web dashboard. All of the original shell behaviour is kept; the
    /// hand-drawn panel that used to live here is gone.
    /// </summary>
    internal sealed class TrayContext : ApplicationContext
    {
        private readonly NotifyIcon notifyIcon;
        private readonly PanelForm panel;
        private readonly ContextMenuStrip menu;
        private ToolStripMenuItem itemAutoStart;
        private ToolStripMenuItem itemPin;
        private readonly Icon trayIcon;
        private bool disposed;
        private bool autoStart;

        public TrayContext(bool startVisible)
        {
            trayIcon = LoadIcon("router-monitor-tray.ico");
            if (trayIcon == null)
            {
                trayIcon = SystemIcons.Application;
            }

            panel = new PanelForm();
            menu = BuildMenu();

            notifyIcon = new NotifyIcon();
            notifyIcon.Icon = trayIcon;
            notifyIcon.Text = "Router Monitor";
            notifyIcon.ContextMenuStrip = menu;
            notifyIcon.Visible = true;
            notifyIcon.MouseUp += OnTrayMouseUp;
            notifyIcon.DoubleClick += delegate { OpenWeb(); };

            autoStart = HasAutoStart();
            itemAutoStart.Checked = autoStart;

            if (startVisible)
            {
                panel.ShowPanel();
            }
        }

        private static Icon LoadIcon(string fileName)
        {
            try
            {
                string path = Path.Combine(ServerHost.ProjectRoot, "public", fileName);
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
            open.Click += delegate { panel.ShowPanel(); };
            strip.Items.Add(open);

            ToolStripMenuItem web = new ToolStripMenuItem("打开网页版");
            web.Click += delegate { OpenWeb(); };
            strip.Items.Add(web);

            ToolStripMenuItem refresh = new ToolStripMenuItem("立即刷新");
            refresh.Click += delegate { panel.Reload(); };
            strip.Items.Add(refresh);

            strip.Items.Add(new ToolStripSeparator());

            // The data-source switcher used to live here because the hand-drawn
            // panel could not host one. The real page has its own switcher in the
            // header, so the tray no longer duplicates it.
            ToolStripMenuItem pin = new ToolStripMenuItem("固定面板");
            pin.CheckOnClick = true;
            pin.Click += delegate { panel.StayOpen = pin.Checked; };
            strip.Items.Add(pin);
            itemPin = pin;

            ToolStripMenuItem auto = new ToolStripMenuItem("开机自动启动");
            auto.CheckOnClick = true;
            auto.Click += delegate { ToggleAutoStart(auto.Checked); };
            strip.Items.Add(auto);
            itemAutoStart = auto;

            strip.Items.Add(new ToolStripSeparator());

            ToolStripMenuItem quit = new ToolStripMenuItem("退出");
            quit.Click += delegate { Quit(); };
            strip.Items.Add(quit);

            return strip;
        }

        private void OnTrayMouseUp(object sender, MouseEventArgs e)
        {
            if (e.Button == MouseButtons.Left)
            {
                panel.TogglePanel();
            }
        }

        private void OpenWeb()
        {
            try
            {
                Process.Start(new ProcessStartInfo(ServerHost.BaseUrl + "/") { UseShellExecute = true });
            }
            catch
            {
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
            catch
            {
                autoStart = HasAutoStart();
                itemAutoStart.Checked = autoStart;
            }
        }

        /// <summary>Writes a .lnk through the WScript.Shell COM object.</summary>
        private static void WriteShortcut(string linkPath, string target)
        {
            Type shellType = Type.GetTypeFromProgID("WScript.Shell");
            if (shellType == null)
            {
                throw new InvalidOperationException("no WScript.Shell");
            }
            object shell = Activator.CreateInstance(shellType);
            try
            {
                object shortcut = shellType.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod,
                    null, shell, new object[] { linkPath });
                Type type = shortcut.GetType();
                type.InvokeMember("TargetPath", BindingFlags.SetProperty, null, shortcut, new object[] { target });
                type.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, shortcut,
                    new object[] { ServerHost.ProjectRoot });
                type.InvokeMember("Description", BindingFlags.SetProperty, null, shortcut,
                    new object[] { "Router Monitor 系统托盘" });
                string icon = Path.Combine(ServerHost.ProjectRoot, @"public\router-monitor-tray.ico");
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

    /// <summary>
    /// Headless driver used to collect evidence: it opens the real flyout, waits
    /// for the page, then prints diagnostics or saves a screenshot. It exists so
    /// the measurements in the README can be reproduced with one command.
    /// </summary>
    internal sealed class CliContext : ApplicationContext
    {
        private readonly PanelForm panel;
        private readonly string mode;
        private readonly string output;
        private readonly string page;
        private readonly string reportPath;
        private readonly int waitMs;
        private readonly int holdMs;
        private readonly System.Windows.Forms.Timer timer;
        private readonly Stopwatch clock = new Stopwatch();
        private readonly List<string> lines = new List<string>();
        private int elapsed;
        private bool done;
        private bool reported;
        private long hiddenAtMs;
        private double lastWvCpuMs = -1;

        public CliContext(string mode, string output, string reportPath, string page, int waitMs, int holdMs)
        {
            this.mode = mode;
            this.output = output;
            this.reportPath = reportPath;
            this.page = page;
            this.waitMs = waitMs;
            this.holdMs = holdMs;

            panel = new PanelForm();
            Say("mode            : " + mode);
            Say("display scale   : " + panel.DpiScale.ToString("0.###"));
            Say("css-per-px scale: " + panel.CssScale.ToString("0.###"));
            Say("webview zoom    : " + panel.WebZoomFactor.ToString("0.###"));
            Say("panel client px : " + panel.ClientSize.Width + "x" + panel.ClientSize.Height);

            if (!string.IsNullOrEmpty(page))
            {
                panel.StartPage = page;
            }

            timer = new System.Windows.Forms.Timer();
            timer.Interval = 50;
            timer.Tick += OnTick;
            timer.Start();

            clock.Start();
            panel.ShowPanel();
            Say("shown at        : 0 ms");
        }

        private void Say(string line)
        {
            lines.Add(line);
            Console.WriteLine(line);
            if (string.IsNullOrEmpty(reportPath))
            {
                return;
            }
            // Appended immediately: if the app dies mid-run the log still shows
            // how far it got.
            try
            {
                string full = Path.GetFullPath(reportPath);
                string dir = Path.GetDirectoryName(full);
                if (!string.IsNullOrEmpty(dir))
                {
                    Directory.CreateDirectory(dir);
                }
                File.AppendAllText(full, line + Environment.NewLine);
            }
            catch
            {
            }
        }

        private void OnTick(object sender, EventArgs e)
        {
            elapsed += 50;

            if (!reported && panel.IsContentReady)
            {
                reported = true;
                Say("first content   : " + clock.ElapsedMilliseconds + " ms");

                // Navigation completing is not the same as being usable: measure
                // how long the React tree takes to actually render and hydrate.
                // Only meaningful in probe mode, which stays on the Overview page;
                // the cycle mode navigates to Requests, which has no charts.
                if (mode != "probe")
                {
                    return;
                }
                long start = clock.ElapsedMilliseconds;
                string marker = "";
                while (clock.ElapsedMilliseconds - start < 20000)
                {
                    Application.DoEvents();
                    Thread.Sleep(10);
                    marker = Eval("(function(){var svg=document.querySelectorAll('svg.recharts-surface');" +
                        "var main=document.querySelector('main');" +
                        "if(!main){return '';}" +
                        "return String(svg.length)+'|'+String(document.querySelectorAll('button').length)+'|'+" +
                        "String(!!(window.next&&window.next.router));})()");
                    if (marker.Length > 0)
                    {
                        string[] parts = marker.Split('|');
                        int charts;
                        int buttons;
                        if (parts.Length == 3 && int.TryParse(parts[0], out charts) && int.TryParse(parts[1], out buttons)
                            && charts > 0 && buttons > 5)
                        {
                            break;
                        }
                    }
                }
                Say("hydrated        : " + (clock.ElapsedMilliseconds - start) + " ms after first content (charts=" + marker + ")");
            }

            if (done)
            {
                return;
            }
            if (!reported && elapsed < waitMs)
            {
                return;
            }
            if (!reported)
            {
                Say("timeout waiting for content");
            }
            done = true;
            timer.Stop();

            try
            {
                if (mode == "cycle")
                {
                    RunCycle();
                }
                else if (mode == "shot")
                {
                    Settle();
                    panel.CaptureTo(output);
                    Say("wrote           : " + Path.GetFullPath(output));
                }
                else
                {
                    Probe();
                }
            }
            catch (Exception ex)
            {
                Say("error           : " + ex.Message);
            }
            WriteReport();
            ExitThread();
        }

        private void Settle()
        {
            // Let the compositor settle so a capture is never a half-painted frame.
            Application.DoEvents();
            Thread.Sleep(700);
            Application.DoEvents();
        }

        /// <summary>
        /// Runs a script and waits for it without deadlocking: ExecuteScriptAsync
        /// completes on the UI thread, so the message loop has to keep pumping.
        /// </summary>
        private string Eval(string script)
        {
            Task<string> task = panel.RunScriptAsync(script);
            int guard = 0;
            while (!task.IsCompleted && guard < 3000)
            {
                Application.DoEvents();
                Thread.Sleep(10);
                guard++;
            }
            if (!task.IsCompleted)
            {
                return "(timeout)";
            }
            return Describe(task.Result);
        }

        private void Probe()
        {
            Say("css viewport    : " + Eval("window.innerWidth + 'x' + window.innerHeight"));
            Say("device pixel r  : " + Eval("String(window.devicePixelRatio)"));
            Say("document.title  : " + Eval("document.title"));
            Say("document size   : " + Eval("document.documentElement.scrollWidth + 'x' + document.documentElement.scrollHeight"));
            Say("escape bridge   : " + Eval("String(window.__rmBridge)"));
            Say("webview2 core   : " + panel.CoreVersion());
            Say("content ready   : " + (panel.IsContentReady ? "yes" : "no"));
            Say("webview failed  : " + (panel.WebViewFailed ? "yes" : "no"));
        }

        /// <summary>
        /// Opens, hides and reopens the flyout so the warm reopen latency and the
        /// suspend behaviour can be measured without driving the tray icon.
        /// </summary>
        private void RunCycle()
        {
            Settle();

            // Visible phase: the panel is on screen and the page is live.
            Sample("visible");
            for (int i = 0; i < 12; i++)
            {
                Pump(500);
                Sample("visible");
            }
            if (!string.IsNullOrEmpty(output))
            {
                panel.CaptureTo(output);
                Say("shot open       : " + Path.GetFullPath(output));
            }

            MeasureInteraction();

            Say("suspend before  : " + panel.SuspendState);
            hiddenAtMs = clock.ElapsedMilliseconds;
            panel.HidePanel();
            Application.DoEvents();

            // Hidden phase: this is what the tray costs while nobody is looking.
            Pump(500);
            Sample("hidden");
            int held = 500;
            while (held < holdMs)
            {
                Pump(500);
                held += 500;
                Sample("hidden");
            }

            Say("hidden at       : " + hiddenAtMs + " ms");
            Say("suspend hidden  : " + panel.SuspendState);

            long reopenedAtMs = clock.ElapsedMilliseconds;
            panel.ShowPanel();
            Application.DoEvents();

            // Honest warm-reopen measure: round-trip a script into the resumed
            // renderer, which only answers once Chromium is actually running again.
            string alive = "(no reply)";
            while (clock.ElapsedMilliseconds - reopenedAtMs < 30000)
            {
                Application.DoEvents();
                alive = Eval("String(document.querySelectorAll('svg.recharts-surface').length)");
                if (alive != "(timeout)" && alive != "(null)")
                {
                    break;
                }
                Thread.Sleep(10);
            }
            long reopenMs = clock.ElapsedMilliseconds - reopenedAtMs;
            Say("reopen latency  : " + reopenMs + " ms (script round-trip into the resumed renderer)");
            Say("reopen charts   : " + alive);
            Say("suspend after   : " + panel.SuspendState);
            Sample("reopened");

            Settle();
            if (!string.IsNullOrEmpty(output))
            {
                string second = Path.ChangeExtension(output, null) + "-reopened.png";
                panel.CaptureTo(second);
                Say("shot reopened   : " + Path.GetFullPath(second));
            }
        }

        /// <summary>
        /// Times a real in-panel interaction: it clicks the Requests link exactly
        /// as a user would and waits for the route to change. This is the number
        /// that says whether clicking anything in the flyout feels slow.
        /// </summary>
        private void MeasureInteraction()
        {
            string clicked = Eval("(function(){var a=document.querySelector('a[href=\"/requests\"]');" +
                "if(!a){return 'no-link';}a.click();return 'clicked';})()");
            Say("nav click       : " + clicked);

            long start = clock.ElapsedMilliseconds;
            string path = "";
            while (clock.ElapsedMilliseconds - start < 15000)
            {
                Application.DoEvents();
                Thread.Sleep(10);
                path = Eval("location.pathname");
                if (path == "/requests")
                {
                    break;
                }
            }
            Say("route change    : " + path + " after " + (clock.ElapsedMilliseconds - start) + " ms");

            // A second interaction inside the loaded page: switch the range chip.
            long chipStart = clock.ElapsedMilliseconds;
            Eval("(function(){var b=document.querySelectorAll('button');" +
                "for(var i=0;i<b.length;i++){if(b[i].textContent.trim()==='7d'){b[i].click();return 'clicked';}}" +
                "return 'no-chip';})()");
            Pump(1200);
            Say("range chip      : responded in " + (clock.ElapsedMilliseconds - chipStart) + " ms (incl. 1200 ms settle)");
        }

        private void Pump(int ms)
        {
            int waited = 0;
            while (waited < ms)
            {
                Application.DoEvents();
                Thread.Sleep(10);
                waited += 10;
            }
        }

        /// <summary>
        /// Records what the tray, Chromium and (indirectly) Node cost at this
        /// instant. The CPU column is a delta since the previous sample, which is
        /// what shows whether a hidden panel still burns cycles.
        /// </summary>
        /// <summary>
        /// Records what this tray costs right now. Only Chromium processes
        /// descended from this process are counted: other applications ship their
        /// own WebView2 and must not be blamed on this one.
        /// </summary>
        private void Sample(string phase)
        {
            int[] pids = OwnBrowserProcesses();
            long workingSet = 0;
            long committed = 0;
            double cpu = 0;
            for (int i = 0; i < pids.Length; i++)
            {
                try
                {
                    using (Process browser = Process.GetProcessById(pids[i]))
                    {
                        workingSet += browser.WorkingSet64;
                        committed += browser.PrivateMemorySize64;
                        cpu += browser.TotalProcessorTime.TotalMilliseconds;
                    }
                }
                catch
                {
                }
            }

            double delta = lastWvCpuMs < 0 ? 0 : cpu - lastWvCpuMs;
            lastWvCpuMs = cpu;

            Process self = Process.GetCurrentProcess();
            Say(string.Format(
                "sample {0,-8} wv2Count={1,-3} wv2Mem={2,7:N1}MB wv2Committed={3,7:N1}MB wv2CpuDelta={4,6:N0}ms trayMem={5,6:N1}MB",
                phase, pids.Length, workingSet / 1048576.0, committed / 1048576.0,
                delta, self.WorkingSet64 / 1048576.0));
        }

        /// <summary>
        /// Finds the msedgewebview2 processes that belong to this host by walking
        /// the parent chain up to our own pid.
        /// </summary>
        private static int[] OwnBrowserProcesses()
        {
            int selfPid = Process.GetCurrentProcess().Id;
            List<int> found = new List<int>();
            try
            {
                Dictionary<int, int> parents = new Dictionary<int, int>();
                List<int> browsers = new List<int>();

                ManagementObjectSearcher searcher = new ManagementObjectSearcher(
                    "SELECT ProcessId, ParentProcessId, Name FROM Win32_Process WHERE Name='msedgewebview2.exe'");
                foreach (ManagementBaseObject item in searcher.Get())
                {
                    int pid = Convert.ToInt32(item["ProcessId"]);
                    int parent = Convert.ToInt32(item["ParentProcessId"]);
                    browsers.Add(pid);
                    parents[pid] = parent;
                    item.Dispose();
                }
                searcher.Dispose();

                ManagementObjectSearcher all = new ManagementObjectSearcher(
                    "SELECT ProcessId, ParentProcessId FROM Win32_Process");
                Dictionary<int, int> chain = new Dictionary<int, int>(parents);
                foreach (ManagementBaseObject item in all.Get())
                {
                    int pid = Convert.ToInt32(item["ProcessId"]);
                    int parent = Convert.ToInt32(item["ParentProcessId"]);
                    if (!chain.ContainsKey(pid))
                    {
                        chain[pid] = parent;
                    }
                    item.Dispose();
                }
                all.Dispose();

                for (int i = 0; i < browsers.Count; i++)
                {
                    int current = browsers[i];
                    for (int depth = 0; depth < 12; depth++)
                    {
                        int parent;
                        if (!chain.TryGetValue(current, out parent) || parent == 0)
                        {
                            break;
                        }
                        if (parent == selfPid)
                        {
                            found.Add(browsers[i]);
                            break;
                        }
                        current = parent;
                    }
                }
            }
            catch
            {
            }
            return found.ToArray();
        }

        private void WriteReport()
        {
            if (string.IsNullOrEmpty(reportPath))
            {
                return;
            }
            try
            {
                string full = Path.GetFullPath(reportPath);
                string dir = Path.GetDirectoryName(full);
                if (!string.IsNullOrEmpty(dir))
                {
                    Directory.CreateDirectory(dir);
                }
                File.WriteAllLines(full, lines.ToArray());
            }
            catch
            {
            }
        }

        private static string Describe(string raw)
        {
            if (raw == null)
            {
                return "(null)";
            }
            string text = raw.Trim();
            if (text.Length >= 2 && text[0] == '"' && text[text.Length - 1] == '"')
            {
                text = text.Substring(1, text.Length - 2);
            }
            return text;
        }
    }

    internal static class Program
    {
        [DllImport("user32.dll")]
        private static extern bool SetProcessDPIAware();

        [DllImport("user32.dll")]
        private static extern bool SetProcessDpiAwarenessContext(IntPtr value);

        private static string CrashLogPath()
        {
            return Path.Combine(Path.GetTempPath(), "RouterMonitorTray-crash.log");
        }

        internal static void ReportCrash(object detail)
        {
            try
            {
                File.AppendAllText(CrashLogPath(),
                    DateTime.Now.ToString("s") + "  " + detail + Environment.NewLine);
            }
            catch
            {
            }
        }

        private static void Guarded(Action body)
        {
            try
            {
                body();
            }
            catch (Exception ex)
            {
                ReportCrash(ex.ToString());
                throw;
            }
        }

        [STAThread]
        private static void Main(string[] args)
        {
            AppDomain.CurrentDomain.UnhandledException += delegate(object sender, UnhandledExceptionEventArgs e)
            {
                ReportCrash("AppDomain: " + e.ExceptionObject);
            };
            Application.ThreadException += delegate(object sender, ThreadExceptionEventArgs e)
            {
                ReportCrash("ThreadException: " + e.Exception);
            };

            // Evidence modes: they drive the real flyout and write a report file,
            // because a winexe has no console to print to on its own.
            string mode = null;
            string output = null;
            string shot = ArgValue(args, "--shot");
            string cycle = ArgValue(args, "--cycle");
            if (cycle != null && cycle.StartsWith("-"))
            {
                cycle = null; // --cycle was passed without a value
            }
            if (HasFlag(args, "--probe"))
            {
                mode = "probe";
            }
            else if (cycle != null || HasFlag(args, "--cycle"))
            {
                mode = "cycle";
                output = cycle;
            }
            else if (shot != null)
            {
                mode = "shot";
                output = shot;
            }

            if (mode != null)
            {
                Guarded(delegate
                {
                    TryEnableDpiAwareness();
                    Application.EnableVisualStyles();
                    Application.SetCompatibleTextRenderingDefault(false);
                    Application.Run(new CliContext(mode, output, ArgValue(args, "--report"),
                        ArgValue(args, "--page"), ArgInt(ArgValue(args, "--wait"), 60000),
                        ArgInt(ArgValue(args, "--hold"), 30000)));
                });
                return;
            }

            // Single instance: a second launch just exits.
            bool created;
            using (Mutex mutex = new Mutex(true, "RouterMonitorTray.SingleInstance", out created))
            {
                if (!created)
                {
                    return;
                }
                TryEnableDpiAwareness();
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                Application.Run(new TrayContext(HasFlag(args, "--panel")));
                GC.KeepAlive(mutex);
            }
        }

        private static bool HasFlag(string[] args, string name)
        {
            for (int i = 0; i < args.Length; i++)
            {
                if (string.Equals(args[i], name, StringComparison.OrdinalIgnoreCase))
                {
                    return true;
                }
            }
            return false;
        }

        private static string ArgValue(string[] args, string name)
        {
            for (int i = 0; i < args.Length - 1; i++)
            {
                if (string.Equals(args[i], name, StringComparison.OrdinalIgnoreCase))
                {
                    return args[i + 1];
                }
            }
            return null;
        }

        private static int ArgInt(string raw, int fallback)
        {
            int value;
            if (!string.IsNullOrEmpty(raw) && int.TryParse(raw, out value))
            {
                return value;
            }
            return fallback;
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
