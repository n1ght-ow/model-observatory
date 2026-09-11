using Microsoft.Win32;
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.Drawing;
using System.IO;
using System.Management;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using Timer = System.Windows.Forms.Timer;

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
        private readonly ControlServer control;
        private ToolStripMenuItem itemAutoStart;
        private ToolStripMenuItem itemPin;
        private ToolStripMenuItem itemTopMost;
        private ToolStripMenuItem itemSize;
        private ToolStripMenuItem itemHotkey;
        private ToolStripMenuItem itemServer;
        private readonly Timer serverTimer;
        private bool? lastServerServing;
        private string pendingHotkeyWarning;

        /// <summary>The combination the menu restores when the hotkey is re-enabled.</summary>
        private const string DefaultHotkey = "Alt+A";
        private readonly Icon trayIcon;
        private bool disposed;
        private bool autoStart;
        private int shuttingDown;
        private readonly ManualResetEvent shutdownDone = new ManualResetEvent(false);

        public TrayContext(bool startVisible)
        {
            trayIcon = LoadIcon("router-monitor-tray.ico");
            if (trayIcon == null)
            {
                trayIcon = SystemIcons.Application;
            }

            panel = new PanelForm();
            // The control channel answers on another thread and marshals onto this one,
            // so the window handle has to exist from startup - not only once somebody
            // has opened the panel.
            panel.EnsureHandle();
            panel.StayOpen = SettingsStore.Current.stayOpen;
            // The handle exists by now, so the hotkey is live from startup - the panel
            // does not have to be opened once first for the key to work.
            if (!panel.ApplyHotkey(SettingsStore.Current.hotkey))
            {
                pendingHotkeyWarning = panel.HotkeyStatus;
            }
            menu = BuildMenu();
            // The page can pin itself; the menu and the settings file have to agree.
            panel.PinnedChanged += OnPinnedChanged;
            // Same capability, two transports: the control channel's `status` command
            // and the bridge's `status` message both land in ApplyStatus.
            panel.StatusReported += ApplyStatus;
            panel.ProblemReported += delegate(string detail)
            {
                Notify("Router Monitor 无法打开面板", detail, ToolTipIcon.Warning);
            };

            // Keeps the menu's server line honest while the menu is closed.
            serverTimer = new Timer();
            serverTimer.Interval = 60000;
            serverTimer.Tick += delegate { RefreshServerStatus(); };
            serverTimer.Start();

            notifyIcon = new NotifyIcon();
            notifyIcon.Icon = trayIcon;
            notifyIcon.Text = "Router Monitor";
            notifyIcon.ContextMenuStrip = menu;
            notifyIcon.Visible = true;
            notifyIcon.MouseUp += OnTrayMouseUp;
            notifyIcon.DoubleClick += delegate { OpenWeb(); };

            autoStart = HasAutoStart();
            itemAutoStart.Checked = autoStart;

            // The hotkey was applied before the icon existed, so a failure could not be
            // shown then. Say it now rather than letting a dead key look like a live one.
            if (!string.IsNullOrEmpty(pendingHotkeyWarning))
            {
                Notify("全局快捷键未生效", pendingHotkeyWarning, ToolTipIcon.Warning);
                pendingHotkeyWarning = null;
            }

            control = new ControlServer(ControlProtocol.PipeName);
            RegisterControlHandlers();
            control.Start();

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
            catch (Exception ex)
            {
                // Worth a line: a missing icon means the tray shows the generic
                // application icon, which looks like a broken install.
                PanelForm.LogInit("icon: could not load " + fileName + " (" + ex.Message + ")");
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
            TraySettings settings = SettingsStore.Current;

            ToolStripMenuItem pin = new ToolStripMenuItem("固定面板");
            pin.CheckOnClick = true;
            pin.Checked = settings.stayOpen;
            pin.Click += delegate
            {
                panel.StayOpen = pin.Checked;
                settings.stayOpen = pin.Checked;
                SettingsStore.Save();
            };
            strip.Items.Add(pin);
            itemPin = pin;

            ToolStripMenuItem top = new ToolStripMenuItem("窗口置顶");
            top.CheckOnClick = true;
            top.Checked = settings.topMost;
            top.Click += delegate { panel.ApplyTopMost(top.Checked); };
            strip.Items.Add(top);
            itemTopMost = top;

            // One entry per drawn size. The layout is never on this menu, because
            // the layout never changes - only the size it is drawn at.
            ToolStripMenuItem size = new ToolStripMenuItem("面板大小");
            double[] choices = new double[] { 0.70, 0.85, 1.00 };
            for (int i = 0; i < choices.Length; i++)
            {
                double choice = choices[i];
                ToolStripMenuItem entry = new ToolStripMenuItem((int)Math.Round(choice * 100) + "%");
                entry.Tag = choice;
                entry.Click += delegate { ApplyScale(choice); };
                size.DropDownItems.Add(entry);
            }
            strip.Items.Add(size);
            itemSize = size;
            RefreshScaleChecks();

            ToolStripMenuItem reset = new ToolStripMenuItem("重置窗口位置");
            reset.Click += delegate { panel.ForgetPosition(); };
            strip.Items.Add(reset);

            // The global hotkey. Ticked only when it is actually registered, because a
            // tick that does not work is worse than no tick at all.
            ToolStripMenuItem hotkey = new ToolStripMenuItem("全局快捷键 (" + settings.hotkey + ")");
            hotkey.CheckOnClick = true;
            hotkey.Checked = panel.HotkeyStatus.IndexOf("registered", StringComparison.OrdinalIgnoreCase) >= 0;
            hotkey.Click += delegate
            {
                TraySettings live = SettingsStore.Current;
                live.hotkey = hotkey.Checked ? DefaultHotkey : "";
                bool ok = panel.ApplyHotkey(live.hotkey);
                SettingsStore.Save();
                hotkey.Checked = ok && live.hotkey.Length > 0;
                if (!ok && live.hotkey.Length > 0)
                {
                    Notify("快捷键未能注册", panel.HotkeyStatus, ToolTipIcon.Warning);
                }
            };
            strip.Items.Add(hotkey);
            itemHotkey = hotkey;

            strip.Items.Add(new ToolStripSeparator());

            // What the local server is doing, and the one way to fix it from here.
            ToolStripMenuItem server = new ToolStripMenuItem("本地服务：检查中…");
            server.Enabled = false;
            strip.Items.Add(server);
            itemServer = server;

            ToolStripMenuItem restart = new ToolStripMenuItem("重启本地服务");
            restart.Click += delegate { RestartServer(); };
            strip.Items.Add(restart);

            // Opening the menu is what refreshes the status; a background poll would
            // cost a request every few seconds for a line nobody is reading.
            strip.Opening += delegate { RefreshServerStatus(); };

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

        /// <summary>Updates the menu's server line. Runs off the UI thread on purpose.</summary>
        private void RefreshServerStatus()
        {
            if (itemServer == null)
            {
                return;
            }
            Task<string> probe = Task.Factory.StartNew(delegate
            {
                if (ServerHost.IsServing(1500))
                {
                    return "本地服务：运行中";
                }
                if (ServerHost.PortIsTaken())
                {
                    return "本地服务：端口被占用";
                }
                return "本地服务：未运行";
            });
            probe.ContinueWith(delegate(Task<string> task)
            {
                string text = task.IsFaulted ? "本地服务：未知" : task.Result;
                try
                {
                    if (itemServer != null && !itemServer.IsDisposed)
                    {
                        itemServer.Text = text;
                    }
                }
                catch
                {
                }
                // Only on the transition: a balloon every minute would be worse than
                // no balloon at all.
                bool serving = text == "本地服务：运行中";
                if (lastServerServing == true && !serving)
                {
                    Notify("Router Monitor 本地服务已停止", text, ToolTipIcon.Warning);
                }
                lastServerServing = serving;
            });
        }

        /// <summary>Stops our server and starts it again, then reloads the panel.</summary>
        private void RestartServer()
        {
            if (itemServer != null)
            {
                itemServer.Text = "本地服务：正在重启…";
            }
            ServerHost.RestartDetached();
            Task.Factory.StartNew(delegate
            {
                DateTime deadline = DateTime.UtcNow.AddSeconds(180);
                while (DateTime.UtcNow < deadline)
                {
                    if (ServerHost.IsServing(1500))
                    {
                        return true;
                    }
                    System.Threading.Thread.Sleep(500);
                }
                return false;
            }).ContinueWith(delegate(Task<bool> task)
            {
                bool ok = !task.IsFaulted && task.Result;
                try
                {
                    if (ok)
                    {
                        panel.Reload();
                    }
                    else
                    {
                        Notify("本地服务重启失败",
                            ServerHost.LastProblem ?? @"详情见 logs\dashboard.log",
                            ToolTipIcon.Warning);
                    }
                }
                catch (Exception ex)
                {
                    PanelForm.LogInit("restart: " + ex.Message);
                }
            });
        }

        /// <summary>
        /// A balloon, shown only when nobody is looking at the panel. A tray that has
        /// stopped working must not look the same as one that is fine.
        /// </summary>
        internal void Notify(string title, string text, ToolTipIcon icon)
        {
            try
            {
                if (notifyIcon == null || panel == null || panel.Visible)
                {
                    return;
                }
                notifyIcon.BalloonTipTitle = title;
                notifyIcon.BalloonTipText = text;
                notifyIcon.BalloonTipIcon = icon;
                notifyIcon.ShowBalloonTip(8000);
                PanelForm.LogInit("notify: " + title + " - " + text);
            }
            catch (Exception ex)
            {
                PanelForm.LogInit("notify failed: " + ex.Message);
            }
        }

        /// <summary>The page pinned or unpinned the panel; keep the menu and the file in step.</summary>
        private void OnPinnedChanged(bool pinned)
        {
            SettingsStore.Current.stayOpen = pinned;
            SettingsStore.Save();
            if (itemPin != null)
            {
                itemPin.Checked = pinned;
            }
        }

        /// <summary>Applies a drawn size and keeps the menu's ticks honest.</summary>
        private void ApplyScale(double value)
        {
            panel.ApplyUserScale(value);
            RefreshScaleChecks();
        }

        private void RefreshScaleChecks()
        {
            if (itemSize == null)
            {
                return;
            }
            double current = panel.UserScaleValue;
            for (int i = 0; i < itemSize.DropDownItems.Count; i++)
            {
                ToolStripMenuItem entry = itemSize.DropDownItems[i] as ToolStripMenuItem;
                if (entry != null && entry.Tag != null)
                {
                    entry.Checked = Math.Abs(Convert.ToDouble(entry.Tag) - current) < 0.001;
                }
            }
        }

        /// <summary>
        /// Reads or sets the global hotkey. Setting it is the same code path the menu
        /// uses, so a script and a click cannot drift apart.
        /// </summary>
        private ControlResponse HandleHotkey(ControlRequest request)
        {
            string value = ArgString(request, "value", null);
            if (value == null)
            {
                return Complete(OnUi(delegate { return DescribeHotkey(); }), 15000, request.id);
            }
            return Complete(OnUi(delegate
            {
                ApplySetting("hotkey", value);
                return DescribeHotkey();
            }), 15000, request.id);
        }

        private Dictionary<string, object> DescribeHotkey()
        {
            List<string> lines = new List<string>();
            Dictionary<string, object> fields = new Dictionary<string, object>();
            AddLine(lines, fields, "hotkey", panel.HotkeySpec.Length == 0 ? "(disabled)" : panel.HotkeySpec);
            AddLine(lines, fields, "hotkey state", panel.HotkeyStatus);
            Dictionary<string, object> result = new Dictionary<string, object>();
            result["lines"] = lines;
            result["fields"] = fields;
            return result;
        }

        /// <summary>
        /// Reports, or sets, the one line the notification-area tooltip carries.
        /// The tooltip belongs to the tray, so the page can only reach it through here.
        /// </summary>
        private ControlResponse HandleStatus(ControlRequest request)
        {
            string text = ArgString(request, "text", null);
            if (text != null)
            {
                return Complete(OnUi(delegate
                {
                    ApplyStatus(text);
                    return DescribeStatus();
                }), 15000, request.id);
            }
            return Complete(OnUi(delegate { return DescribeStatus(); }), 15000, request.id);
        }

        private Dictionary<string, object> DescribeStatus()
        {
            List<string> lines = new List<string>();
            Dictionary<string, object> fields = new Dictionary<string, object>();
            AddLine(lines, fields, "tooltip", notifyIcon == null ? "(none)" : notifyIcon.Text);
            AddLine(lines, fields, "hotkey", panel.HotkeyStatus);
            Dictionary<string, object> result = new Dictionary<string, object>();
            result["lines"] = lines;
            result["fields"] = fields;
            return result;
        }

        /// <summary>
        /// One line, in the notification area. WinForms caps NotifyIcon.Text at 63
        /// characters and throws above it, so the text is trimmed rather than trusted.
        /// </summary>
        internal void ApplyStatus(string text)
        {
            if (notifyIcon == null)
            {
                return;
            }
            string line = string.IsNullOrEmpty(text) ? "Router Monitor" : text.Trim();
            if (line.Length > 63)
            {
                line = line.Substring(0, 60) + "...";
            }
            try
            {
                notifyIcon.Text = line;
            }
            catch (Exception ex)
            {
                PanelForm.LogInit("status: " + ex.Message);
            }
        }

        /// <summary>
        /// Measures this flyout: visible cost, suspend, hidden cost, warm reopen and
        /// an in-panel interaction. Only the tray that owns the WebView can take these
        /// numbers.
        /// </summary>
        private ControlResponse HandleCycle(ControlRequest request)
        {
            string path = ArgString(request, "path", null);
            string page = ArgString(request, "page", null);
            int holdMs = ArgInt(request, "holdMs", 30000);
            int timeout = ArgInt(request, "timeout", 60000);
            return Complete(OnUiAsync(delegate
            {
                return Diagnostics.CycleAsync(panel, path, page, holdMs, timeout);
            }), holdMs + timeout + 120000, request.id);
        }

        /// <summary>
        /// Runs a script inside the live flyout. This is the only way to see what the
        /// page actually did - a browser cannot be asked to run script in this
        /// WebView, and the diagnostics need it to measure interaction.
        /// </summary>
        private ControlResponse HandleEval(ControlRequest request)
        {
            // Scripts are far too easy to mangle on a command line (spaces, quotes),
            // so a file is the reliable way in and 'script' is the convenience.
            string script = ArgString(request, "script", null);
            string from = ArgString(request, "file", null);
            if (!string.IsNullOrEmpty(from))
            {
                try
                {
                    script = File.ReadAllText(from);
                }
                catch (Exception ex)
                {
                    return ControlResponse.Failure(request.id, "could not read '" + from + "': " + ex.Message);
                }
            }
            if (string.IsNullOrEmpty(script))
            {
                return ControlResponse.Failure(request.id, "eval needs a 'script' or a 'file' argument");
            }
            int timeout = ArgInt(request, "timeout", 20000);
            return Complete(OnUiAsync(delegate
            {
                return EvalResult(script);
            }), timeout + 10000, request.id);
        }

        private async Task<Dictionary<string, object>> EvalResult(string script)
        {
            string value;
            try
            {
                value = Diagnostics.Describe(await panel.RunScriptAsync(script));
                if (value == "null")
                {
                    // WebView2 answers "null" both for a null result and for a script
                    // that threw, and the difference matters when debugging.
                    value = "(null or the script threw - see logs/tray-init.log)";
                }
            }
            catch (Exception ex)
            {
                value = "(error: " + ex.Message + ")";
            }
            List<string> lines = new List<string>();
            Dictionary<string, object> fields = new Dictionary<string, object>();
            AddLine(lines, fields, "result", value);
            Dictionary<string, object> result = new Dictionary<string, object>();
            result["lines"] = lines;
            result["fields"] = fields;
            return result;
        }

        /// <summary>
        /// The settings, and the one place they can be changed while the tray runs.
        /// The menu calls the same method, so `--ctl config` and a click cannot drift.
        /// </summary>
        private ControlResponse HandleConfig(ControlRequest request)
        {
            string key = ArgString(request, "key", null);
            if (string.IsNullOrEmpty(key))
            {
                return Complete(OnUi(delegate { return DescribeSettings(); }), 15000, request.id);
            }
            string value = ArgString(request, "value", null);
            if (value == null)
            {
                return ControlResponse.Failure(request.id, "config needs 'value' alongside 'key'");
            }
            if (string.Equals(key, "port", StringComparison.OrdinalIgnoreCase))
            {
                return ControlResponse.Failure(request.id,
                    "the port is read at startup: edit settings.json and restart");
            }
            return Complete(OnUi(delegate
            {
                ApplySetting(key, value);
                return DescribeSettings();
            }), 15000, request.id);
        }

        /// <summary>Applies one setting live. Runs on the UI thread.</summary>
        private void ApplySetting(string key, string value)
        {
            TraySettings settings = SettingsStore.Current;
            if (string.Equals(key, "stayOpen", StringComparison.OrdinalIgnoreCase))
            {
                bool flag = ParseBool(value);
                settings.stayOpen = flag;
                panel.StayOpen = flag;
                if (itemPin != null)
                {
                    itemPin.Checked = flag;
                }
                SettingsStore.Save();
            }
            else if (string.Equals(key, "topMost", StringComparison.OrdinalIgnoreCase))
            {
                bool flag = ParseBool(value);
                if (itemTopMost != null)
                {
                    itemTopMost.Checked = flag;
                }
                panel.ApplyTopMost(flag);
            }
            else if (string.Equals(key, "userScale", StringComparison.OrdinalIgnoreCase))
            {
                panel.ApplyUserScale(ParseDouble(value, panel.UserScaleValue));
                RefreshScaleChecks();
            }
            else if (string.Equals(key, "dragStripHeight", StringComparison.OrdinalIgnoreCase))
            {
                panel.ApplyDragStripHeight((int)Math.Round(ParseDouble(value, panel.DragStripHeightValue)));
            }
            else if (string.Equals(key, "hotkey", StringComparison.OrdinalIgnoreCase))
            {
                settings.hotkey = value.Trim();
                if (!panel.ApplyHotkey(settings.hotkey))
                {
                    // Reported rather than thrown: the combination may simply be owned by
                    // another program, which is a fact about the machine, not a bug.
                    Notify("快捷键未能注册", panel.HotkeyStatus, ToolTipIcon.Warning);
                }
                SettingsStore.Save();
                if (itemHotkey != null)
                {
                    itemHotkey.Checked = panel.HotkeyStatus.IndexOf("registered", StringComparison.OrdinalIgnoreCase) >= 0;
                }
            }
            else
            {
                throw new ArgumentException("'" + key + "' is not a live setting");
            }
        }

        /// <summary>The settings as they are right now, in the report's usual shape.</summary>
        private Dictionary<string, object> DescribeSettings()
        {
            TraySettings settings = SettingsStore.Current;
            List<string> lines = new List<string>();
            Dictionary<string, object> fields = new Dictionary<string, object>();
            AddLine(lines, fields, "file", SettingsStore.FilePath());
            AddLine(lines, fields, "userScale", panel.UserScaleValue.ToString("0.###", CultureInfo.InvariantCulture));
            AddLine(lines, fields, "dragStripHeight", panel.DragStripHeightValue.ToString(CultureInfo.InvariantCulture));
            AddLine(lines, fields, "stayOpen", settings.stayOpen ? "true" : "false");
            AddLine(lines, fields, "topMost", panel.TopMost ? "true" : "false");
            AddLine(lines, fields, "hasPosition", settings.hasPosition ? "true" : "false");
            AddLine(lines, fields, "position", settings.hasPosition ? settings.windowX + "," + settings.windowY : "(docked to the tray)");
            AddLine(lines, fields, "port", settings.port.ToString(CultureInfo.InvariantCulture));
            AddLine(lines, fields, "hotkey", panel.HotkeySpec.Length == 0 ? "(disabled)" : panel.HotkeySpec);
            AddLine(lines, fields, "hotkey state", panel.HotkeyStatus);
            Dictionary<string, object> result = new Dictionary<string, object>();
            result["lines"] = lines;
            result["fields"] = fields;
            return result;
        }

        private static bool ParseBool(string text)
        {
            string value = text == null ? "" : text.Trim().ToLowerInvariant();
            return value == "true" || value == "1" || value == "yes" || value == "on";
        }

        private static double ParseDouble(string text, double fallback)
        {
            double value;
            if (!string.IsNullOrEmpty(text) && double.TryParse(text, NumberStyles.Float,
                CultureInfo.InvariantCulture, out value))
            {
                return value;
            }
            return fallback;
        }

        private void OpenWeb()
        {
            Program.OpenExternal(ServerHost.BaseUrl + "/");
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
                // The checkbox has to go back to the truth, and the user has to know the
                // preference did not stick - silently ticking it would be a lie.
                PanelForm.LogInit("autostart: " + ex.Message);
                autoStart = HasAutoStart();
                itemAutoStart.Checked = autoStart;
                Notify("开机自动启动设置失败", ex.Message, ToolTipIcon.Warning);
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
            BeginShutdown("menu:quit");
        }

        /// <summary>
        /// The whole control channel in one place. A new tray capability is one row
        /// here; nothing in Main, in the menu or on the command line has to learn
        /// about a command for it to become reachable.
        /// </summary>
        private void RegisterControlHandlers()
        {
            control.Register("ping", HandlePing);
            control.Register("show", HandleShow);
            control.Register("hide", HandleHide);
            control.Register("toggle", HandleToggle);
            control.Register("reload", HandleReload);
            control.Register("probe", HandleProbe);
            control.Register("shot", HandleShot);
            control.Register("eval", HandleEval);
            control.Register("cycle", HandleCycle);
            control.Register("hotkey", HandleHotkey);
            control.Register("status", HandleStatus);
            control.Register("config", HandleConfig);
            control.Register("quit", HandleQuit);
        }

        /// <summary>State of the tray, and the command list, so the channel is discoverable.</summary>
        private ControlResponse HandlePing(ControlRequest request)
        {
            List<string> lines = new List<string>();
            Dictionary<string, object> fields = new Dictionary<string, object>();
            string[] names = control.Commands();

            AddLine(lines, fields, "version", Program.Version());
            AddLine(lines, fields, "pid", Process.GetCurrentProcess().Id.ToString());
            AddLine(lines, fields, "panel visible", panel.Visible ? "yes" : "no");
            AddLine(lines, fields, "webview ready", panel.IsContentReady ? "yes" : "no");
            AddLine(lines, fields, "webview failed", panel.WebViewFailed ? "yes" : "no");
            AddLine(lines, fields, "suspend", panel.SuspendState);
            AddLine(lines, fields, "server serving", ServerHost.IsServing(8000) ? "yes" : "no");
            AddLine(lines, fields, "commands", string.Join(", ", names));

            Dictionary<string, object> result = new Dictionary<string, object>();
            result["lines"] = lines;
            result["fields"] = fields;
            return ControlResponse.Success(request.id, result);
        }

        private ControlResponse HandleShow(ControlRequest request)
        {
            return Complete(OnUi(delegate { panel.ShowPanel(); return PanelState(); }), 15000, request.id);
        }

        private ControlResponse HandleHide(ControlRequest request)
        {
            return Complete(OnUi(delegate { panel.HidePanel(); return PanelState(); }), 15000, request.id);
        }

        private ControlResponse HandleToggle(ControlRequest request)
        {
            return Complete(OnUi(delegate { panel.TogglePanel(); return PanelState(); }), 15000, request.id);
        }

        private ControlResponse HandleReload(ControlRequest request)
        {
            return Complete(OnUi(delegate { panel.Reload(); return PanelState(); }), 15000, request.id);
        }

        /// <summary>What the flyout looks like right now; the answer to every panel command.</summary>
        private Dictionary<string, object> PanelState()
        {
            List<string> lines = new List<string>();
            Dictionary<string, object> fields = new Dictionary<string, object>();
            AddLine(lines, fields, "panel visible", panel.Visible ? "yes" : "no");
            AddLine(lines, fields, "webview ready", panel.IsContentReady ? "yes" : "no");
            Dictionary<string, object> result = new Dictionary<string, object>();
            result["lines"] = lines;
            result["fields"] = fields;
            return result;
        }

        private ControlResponse HandleProbe(ControlRequest request)
        {
            int timeout = ArgInt(request, "timeout", 60000);
            string page = ArgString(request, "page", null);
            return Complete(OnUiAsync(delegate
            {
                return Diagnostics.ProbeAsync(panel, null, page, timeout);
            }), timeout + 30000, request.id);
        }

        private ControlResponse HandleShot(ControlRequest request)
        {
            string path = ArgString(request, "path", null);
            if (string.IsNullOrEmpty(path))
            {
                return ControlResponse.Failure(request.id, "shot needs a 'path' argument");
            }
            int timeout = ArgInt(request, "timeout", 60000);
            string page = ArgString(request, "page", null);
            return Complete(OnUiAsync(delegate
            {
                return Diagnostics.ShotAsync(panel, path, page, timeout);
            }), timeout + 30000, request.id);
        }

        /// <summary>
        /// Answers first and tears down afterwards: the reply has to reach the caller
        /// before the process that would have written it disappears.
        /// </summary>
        private ControlResponse HandleQuit(ControlRequest request)
        {
            BeginShutdown("control:quit");
            return ControlResponse.Success(request.id, null);
        }

        /// <summary>
        /// Tears the tray down the way the menu's Quit does. Safe from any thread and
        /// safe to call twice; the first caller wins.
        /// </summary>
        public void BeginShutdown(string reason)
        {
            if (Interlocked.Exchange(ref shuttingDown, 1) != 0)
            {
                return;
            }
            PanelForm.LogInit("shutdown: " + reason);
            try
            {
                if (panel != null && panel.IsHandleCreated && panel.InvokeRequired)
                {
                    // Coming from the control channel or a session event: let the UI
                    // thread do its own teardown, in its own order.
                    panel.BeginInvoke((MethodInvoker)delegate
                    {
                        Dispose();
                        ExitThread();
                    });
                }
                else
                {
                    Dispose();
                    ExitThread();
                }
            }
            catch (Exception ex)
            {
                PanelForm.LogInit("shutdown failed: " + ex.Message);
            }
        }

        /// <summary>Whether the caller is off the UI thread.</summary>
        public bool InvokeRequired
        {
            get { return panel != null && panel.InvokeRequired; }
        }

        /// <summary>
        /// Blocks until teardown has finished. Only used when the session is ending,
        /// where the caller is on another thread and the process is about to go away.
        /// </summary>
        public bool WaitForShutdown(int timeoutMs)
        {
            return shutdownDone.WaitOne(timeoutMs);
        }

        /// <summary>Runs a synchronous action on the panel's own thread.</summary>
        private Task<Dictionary<string, object>> OnUi(Func<Dictionary<string, object>> work)
        {
            TaskCompletionSource<Dictionary<string, object>> done =
                new TaskCompletionSource<Dictionary<string, object>>();
            try
            {
                panel.BeginInvoke((MethodInvoker)delegate
                {
                    try
                    {
                        done.TrySetResult(work());
                    }
                    catch (Exception ex)
                    {
                        done.TrySetException(ex);
                    }
                });
            }
            catch (Exception ex)
            {
                done.TrySetException(ex);
            }
            return done.Task;
        }

        /// <summary>
        /// Starts an asynchronous action on the panel's thread and lets its message
        /// loop keep running, which is the only way an ExecuteScriptAsync round trip
        /// can ever complete.
        /// </summary>
        private Task<Dictionary<string, object>> OnUiAsync(Func<Task<Dictionary<string, object>>> work)
        {
            TaskCompletionSource<Dictionary<string, object>> done =
                new TaskCompletionSource<Dictionary<string, object>>();
            try
            {
                panel.BeginInvoke((MethodInvoker)delegate
                {
                    Task<Dictionary<string, object>> task;
                    try
                    {
                        task = work();
                    }
                    catch (Exception ex)
                    {
                        done.TrySetException(ex);
                        return;
                    }
                    task.ContinueWith(delegate(Task<Dictionary<string, object>> finished)
                    {
                        if (finished.IsFaulted)
                        {
                            done.TrySetException(finished.Exception.InnerExceptions[0]);
                        }
                        else if (finished.IsCanceled)
                        {
                            done.TrySetCanceled();
                        }
                        else
                        {
                            done.TrySetResult(finished.Result);
                        }
                    });
                });
            }
            catch (Exception ex)
            {
                done.TrySetException(ex);
            }
            return done.Task;
        }

        /// <summary>Waits for UI work off the UI thread, so a stuck panel cannot wedge the channel.</summary>
        private static ControlResponse Complete(Task<Dictionary<string, object>> task, int timeoutMs, string id)
        {
            try
            {
                if (!task.Wait(timeoutMs))
                {
                    return ControlResponse.Failure(id, "the panel did not finish within " + timeoutMs + " ms");
                }
            }
            catch (AggregateException ex)
            {
                return ControlResponse.Failure(id, ex.InnerExceptions[0].Message);
            }
            catch (Exception ex)
            {
                return ControlResponse.Failure(id, ex.Message);
            }
            return ControlResponse.Success(id, task.Result);
        }

        private static void AddLine(List<string> lines, Dictionary<string, object> fields, string label, string value)
        {
            if (value == null)
            {
                value = "(null)";
            }
            lines.Add(label.PadRight(16) + ": " + value);
            fields[label] = value;
        }

        private static string ArgString(ControlRequest request, string name, string fallback)
        {
            object raw;
            if (request.args != null && request.args.TryGetValue(name, out raw) && raw != null)
            {
                return Convert.ToString(raw);
            }
            return fallback;
        }

        private static int ArgInt(ControlRequest request, string name, int fallback)
        {
            string raw = ArgString(request, name, null);
            int value;
            if (!string.IsNullOrEmpty(raw) && int.TryParse(raw, out value))
            {
                return value;
            }
            return fallback;
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
                if (serverTimer != null)
                {
                    serverTimer.Dispose();
                }
                if (trayIcon != null)
                {
                    trayIcon.Dispose();
                }
                shutdownDone.Set();
            }
            base.Dispose(disposing);
        }
    }

    /// <summary>
    /// Entry point, and the client half of the control channel. Every capability
    /// lives in the tray; this process either starts one or talks to the one that is
    /// already running, which is why it has no diagnostic code of its own.
    /// </summary>
    internal static class Program
    {
        [DllImport("user32.dll")]
        private static extern bool SetProcessDPIAware();

        [DllImport("user32.dll")]
        private static extern bool SetProcessDpiAwarenessContext(IntPtr value);

        /// <summary>
        /// Where the crash log goes. Deliberately the same place as the tray log -
        /// a crash used to land in %TEMP% while everything else was in logs\, so
        /// "what happened?" meant knowing to look in two unrelated directories.
        /// </summary>
        private static string CrashLogPath()
        {
            return Path.Combine(ServerHost.ProjectRoot, "logs", "tray-crash.log");
        }

        /// <summary>The crash log from when it lived in %TEMP%, for the uninstaller.
        /// </summary>
        internal static string LegacyCrashLogPath()
        {
            return Path.Combine(Path.GetTempPath(), "RouterMonitorTray-crash.log");
        }

        /// <summary>
        /// Hands a URL to the shell. Only http and https are allowed through: the page
        /// can ask for this, and "the page asked" is not a reason to hand the shell an
        /// arbitrary protocol handler.
        /// </summary>
        internal static void OpenExternal(string url)
        {
            if (string.IsNullOrEmpty(url))
            {
                return;
            }
            string trimmed = url.Trim();
            if (!trimmed.StartsWith("http://", StringComparison.OrdinalIgnoreCase) &&
                !trimmed.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
            {
                PanelForm.LogInit("external: refused non-http url " + trimmed);
                return;
            }
            try
            {
                PanelForm.LogInit("external: opening " + trimmed);
                Process.Start(new ProcessStartInfo(trimmed) { UseShellExecute = true });
            }
            catch (Exception ex)
            {
                PanelForm.LogInit("external: could not open " + trimmed + " (" + ex.Message + ")");
            }
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

        private const string MutexName = "RouterMonitorTray.SingleInstance";

        private static TrayContext context;

        /// <summary>The build this process is, for the control channel's `ping`.</summary>
        internal static string Version()
        {
            try
            {
                Version version = Assembly.GetExecutingAssembly().GetName().Version;
                return version == null ? "(unknown)" : version.ToString();
            }
            catch
            {
                return "(unknown)";
            }
        }

        [STAThread]
        private static int Main(string[] args)
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

            // The port is a preference now, so it has to be known before anything
            // asks whether the dashboard is up.
            ServerHost.Port = SettingsStore.Current.port;

            string report = ArgValue(args, "--report");
            string page = ArgValue(args, "--page");
            int waitMs = ArgInt(ArgValue(args, "--wait"), 60000);
            int holdMs = ArgInt(ArgValue(args, "--hold"), 30000);
            string ctl = ArgValue(args, "--ctl");

            // 1. Generic client: send exactly one command to the tray that is already
            //    running and print its answer. This is what lets a script reach any
            //    capability without this program growing one command line switch per
            //    capability.
            if (!string.IsNullOrEmpty(ctl))
            {
                return ForwardCommand(ctl, ArgPairs(args, "--arg"), report);
            }

            // 2. Diagnostics are measurements of the tray's own WebView, so they are
            //    asked of a tray rather than taken by a second process: standing up a
            //    rival WebView2 on the same user data folder is the documented way to
            //    break both of them. If no tray is running, one is started and the
            //    measurement is taken against it - which also means a diagnostic can
            //    no longer leave a temporary process behind.
            if (mode != null)
            {
                Dictionary<string, object> args2 = new Dictionary<string, object>();
                if (!string.IsNullOrEmpty(output))
                {
                    args2["path"] = output;
                }
                if (!string.IsNullOrEmpty(page))
                {
                    args2["page"] = page;
                }
                if (waitMs != 60000)
                {
                    args2["timeout"] = waitMs;
                }
                args2["holdMs"] = holdMs;
                if (!EnsureInstanceRunning(240000))
                {
                    Console.WriteLine("no tray could be started to measure");
                    WriteReport(report, new string[] { "error           : no tray could be started" });
                    return 2;
                }
                return ForwardCommand(mode, args2, report);
            }

            // 3. Normal start. Exactly one process owns the tray; a second launch asks
            //    the owner to show the panel instead of dying without a word.
            bool created;
            using (Mutex mutex = new Mutex(true, MutexName, out created))
            {
                if (!created)
                {
                    return ForwardCommand("show", null, report);
                }
                TryEnableDpiAwareness();
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);

                context = new TrayContext(HasFlag(args, "--panel"));
                Application.ApplicationExit += delegate { ShutdownContext("ApplicationExit"); };
                try
                {
                    SystemEvents.SessionEnding += OnSessionEnding;
                }
                catch (Exception ex)
                {
                    ReportCrash("SessionEnding hook: " + ex.Message);
                }
                try
                {
                    Application.Run(context);
                }
                finally
                {
                    ShutdownContext("message loop ended");
                }
                GC.KeepAlive(mutex);
            }
            return 0;
        }

        /// <summary>
        /// Starts the tray so that it is nobody's child.
        ///
        /// Process.Start makes it a child of whoever is measuring, and that is not a
        /// detail: PowerShell 7's Start-Process -Wait waits for the whole process tree,
        /// so a diagnostic that spawned the tray would never return, and killing the
        /// caller could take the tray with it. Win32_Process.Create hands the launch to
        /// WMI instead, which is also how install-tray.ps1 starts it.
        /// </summary>
        internal static bool StartFullyDetached(string exePath)
        {
            try
            {
                using (ManagementClass factory = new ManagementClass("Win32_Process"))
                {
                    ManagementBaseObject arguments = factory.GetMethodParameters("Create");
                    arguments["CommandLine"] = "\"" + exePath + "\"";
                    ManagementBaseObject created = factory.InvokeMethod("Create", arguments, null);
                    uint code = Convert.ToUInt32(created["ReturnValue"]);
                    created.Dispose();
                    if (code == 0)
                    {
                        return true;
                    }
                    PanelForm.LogInit("spawn: Win32_Process.Create returned " + code + "; falling back");
                }
            }
            catch (Exception ex)
            {
                PanelForm.LogInit("spawn: " + ex.Message + "; falling back");
            }

            try
            {
                ProcessStartInfo psi = new ProcessStartInfo();
                psi.FileName = exePath;
                psi.UseShellExecute = true;
                psi.WorkingDirectory = ServerHost.ProjectRoot;
                Process.Start(psi);
                return true;
            }
            catch (Exception ex)
            {
                ReportCrash("could not start a tray: " + ex.Message);
                return false;
            }
        }

        /// <summary>
        /// Whether a tray is there *and* its control channel answers. The mutex alone
        /// is not enough: it can outlive a process that is still starting up.
        /// </summary>
        private static bool ChannelAnswers()
        {
            ControlResponse response;
            string error;
            return ControlClient.TrySend("ping", null, 2000, out response, out error) && response.ok;
        }

        /// <summary>
        /// Starts a tray if none is running and waits for its control channel to
        /// answer. A diagnostic needs a tray; it no longer becomes one.
        /// </summary>
        private static bool EnsureInstanceRunning(int timeoutMs)
        {
            if (InstanceRunning() && ChannelAnswers())
            {
                return true;
            }

            if (!StartFullyDetached(Application.ExecutablePath))
            {
                return false;
            }

            DateTime deadline = DateTime.UtcNow.AddMilliseconds(timeoutMs);
            while (DateTime.UtcNow < deadline)
            {
                System.Threading.Thread.Sleep(250);
                if (ChannelAnswers())
                {
                    return true;
                }
            }
            return false;
        }

        /// <summary>
        /// True when another process owns the tray mutex. Probed by trying to create
        /// the mutex and releasing it again immediately.
        /// </summary>
        private static bool InstanceRunning()
        {
            try
            {
                bool created;
                using (Mutex probe = new Mutex(true, MutexName, out created))
                {
                    if (created)
                    {
                        probe.ReleaseMutex();
                        return false;
                    }
                    return true;
                }
            }
            catch (Exception)
            {
                // A mutex that exists but cannot be opened still means somebody is there.
                return true;
            }
        }

        /// <summary>
        /// Sends one command to the running tray. Returns the process exit code:
        /// 0 answered, 2 nobody answered, 3 the tray answered with a failure.
        /// </summary>
        private static int ForwardCommand(string cmd, Dictionary<string, object> args, string report)
        {
            AttachParentConsole();
            ControlResponse response;
            string error;
            if (!ControlClient.TrySend(cmd, args, ControlProtocol.ConnectTimeoutMs, out response, out error))
            {
                string message = "no running tray answered '" + cmd + "': " + error;
                Console.WriteLine(message);
                WriteReport(report, new string[] { "error           : " + message });
                return 2;
            }
            List<string> lines = response.Lines();
            for (int i = 0; i < lines.Count; i++)
            {
                Console.WriteLine(lines[i]);
            }
            WriteReport(report, lines.ToArray());
            return response.ok ? 0 : 3;
        }

        private static void WriteReport(string path, string[] lines)
        {
            if (string.IsNullOrEmpty(path))
            {
                return;
            }
            try
            {
                string full = Path.GetFullPath(path);
                string dir = Path.GetDirectoryName(full);
                if (!string.IsNullOrEmpty(dir))
                {
                    Directory.CreateDirectory(dir);
                }
                File.WriteAllLines(full, lines);
            }
            catch (Exception ex)
            {
                ReportCrash("report: " + ex.Message);
            }
        }

        /// <summary>
        /// A winexe has no console of its own; borrowing the launching console is what
        /// makes `--ctl` usable straight from a shell.
        /// </summary>
        private static void AttachParentConsole()
        {
            try
            {
                AttachConsole(-1); // ATTACH_PARENT_PROCESS
            }
            catch
            {
            }
        }

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool AttachConsole(int processId);

        /// <summary>Logging off or shutting down should close the flyout, not kill it.</summary>
        private static void OnSessionEnding(object sender, SessionEndingEventArgs e)
        {
            ShutdownContext("SessionEnding");
        }

        /// <summary>
        /// Tears down whatever tray this process owns. Safe from any thread and safe
        /// to call more than once.
        /// </summary>
        private static void ShutdownContext(string reason)
        {
            TrayContext current = context;
            context = null;
            if (current == null)
            {
                return;
            }
            current.BeginShutdown(reason);
            if (current.InvokeRequired)
            {
                // The session is ending on another thread: wait for the UI thread's own
                // teardown instead of touching the controls from here.
                current.WaitForShutdown(3000);
                return;
            }
            current.Dispose();
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

        /// <summary>Collects repeated `--arg name=value` pairs into one argument bag.</summary>
        private static Dictionary<string, object> ArgPairs(string[] args, string name)
        {
            Dictionary<string, object> pairs = null;
            for (int i = 0; i < args.Length - 1; i++)
            {
                if (!string.Equals(args[i], name, StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }
                string text = args[i + 1];
                int split = text.IndexOf('=');
                if (split <= 0)
                {
                    continue;
                }
                if (pairs == null)
                {
                    pairs = new Dictionary<string, object>();
                }
                pairs[text.Substring(0, split)] = text.Substring(split + 1);
            }
            return pairs;
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
