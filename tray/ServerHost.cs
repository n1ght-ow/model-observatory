using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Threading.Tasks;

namespace RouterMonitorTray
{
    /// <summary>
    /// Owns the local Next.js host: a readiness probe plus a fire-and-forget
    /// launch of scripts\start-dashboard.ps1.
    ///
    /// The script ends in $server.WaitForExit(), so it never returns. It must be
    /// started detached and never awaited: a WaitForExit() here would block the
    /// UI thread forever and the tray would appear to freeze with no error.
    /// </summary>
    internal static class ServerHost
    {
        private static int port = 3000;

        /// <summary>
        /// The port the local dashboard answers on. A preference rather than a
        /// constant, because 3000 is a popular port to find already taken.
        /// </summary>
        public static int Port
        {
            get { return port; }
            set { port = value; }
        }

        public static string BaseUrl
        {
            get { return "http://127.0.0.1:" + port; }
        }

        /// <summary>
        /// The repository root: where scripts, logs and node_modules live.
        ///
        /// Derived from where this executable actually is - it is built into
        /// <root>\dist\tray\ - so a copy of the tree works from any path. The
        /// compiled default is only a last resort, and used to be the only answer.
        /// </summary>
        public static readonly string ProjectRoot = ResolveProjectRoot();

        private const string DefaultProjectRoot = @"D:\dashboard";

        private static string ResolveProjectRoot()
        {
            try
            {
                string exe = Process.GetCurrentProcess().MainModule.FileName;
                string dir = Path.GetDirectoryName(exe);
                if (!string.IsNullOrEmpty(dir))
                {
                    // dist\tray -> dist -> root
                    DirectoryInfo dist = Directory.GetParent(dir);
                    if (dist != null && dist.Parent != null)
                    {
                        string candidate = dist.Parent.FullName;
                        if (File.Exists(Path.Combine(candidate, "package.json")))
                        {
                            return candidate;
                        }
                    }
                }
            }
            catch (Exception)
            {
                // Deliberately not logged: LogInit writes under ProjectRoot, which is
                // the thing being resolved here.
            }
            return DefaultProjectRoot;
        }

        private static readonly object Gate = new object();

        /// <summary>True once something is accepting TCP on the port (not necessarily serving yet).</summary>
        public static bool IsListening(int timeoutMs)
        {
            try
            {
                using (TcpClient client = new TcpClient())
                {
                    IAsyncResult ar = client.BeginConnect("127.0.0.1", Port, null, null);
                    bool ok = ar.AsyncWaitHandle.WaitOne(timeoutMs, false);
                    if (!ok)
                    {
                        return false;
                    }
                    client.EndConnect(ar);
                    return true;
                }
            }
            catch
            {
                return false;
            }
        }

        /// <summary>
        /// The application name /api/health reports. Keep in step with APP_ID in
        /// src/app/api/health/route.ts.
        /// </summary>
        public const string AppId = "router-monitor-dashboard";

        /// <summary>
        /// True once *this* dashboard answers. A listening socket proves nothing, and
        /// neither does a status code: any local service on this port can answer 404
        /// to /api/sources, and the tray used to take that as "the dashboard is up"
        /// and navigate to a stranger. Only the identity marker counts.
        /// </summary>
        public static bool IsServing(int timeoutMs)
        {
            string body = Get(HealthUrl, timeoutMs);
            string reason;
            return IsOurHealth(body, out reason);
        }

        /// <summary>Whether a response body is this dashboard's health marker.</summary>
        public static bool IsOurHealth(string body, out string reason)
        {
            reason = null;
            if (string.IsNullOrEmpty(body))
            {
                reason = "no answer from " + HealthUrl;
                return false;
            }
            if (body.IndexOf("\"" + AppId + "\"", StringComparison.OrdinalIgnoreCase) < 0)
            {
                reason = "something else is answering on port " + port + " (no '" + AppId + "' marker)";
                return false;
            }
            return true;
        }

        public static string HealthUrl
        {
            get { return BaseUrl + "/api/health"; }
        }

        /// <summary>GETs a URL and returns the body, or null. Never throws.</summary>
        private static string Get(string url, int timeoutMs)
        {
            try
            {
                HttpWebRequest request = (HttpWebRequest)WebRequest.Create(url);
                request.Proxy = null;
                request.Method = "GET";
                request.Timeout = timeoutMs;
                request.ReadWriteTimeout = timeoutMs;
                request.KeepAlive = false;
                request.AllowAutoRedirect = false;
                using (HttpWebResponse response = (HttpWebResponse)request.GetResponse())
                {
                    if ((int)response.StatusCode < 200 || (int)response.StatusCode >= 300)
                    {
                        response.Close();
                        return null;
                    }
                    using (StreamReader reader = new StreamReader(response.GetResponseStream()))
                    {
                        return reader.ReadToEnd();
                    }
                }
            }
            catch (WebException ex)
            {
                HttpWebResponse response = ex.Response as HttpWebResponse;
                if (response != null)
                {
                    try
                    {
                        using (StreamReader reader = new StreamReader(response.GetResponseStream()))
                        {
                            return reader.ReadToEnd();
                        }
                    }
                    catch
                    {
                    }
                    finally
                    {
                        response.Close();
                    }
                }
                return null;
            }
            catch
            {
                return null;
            }
        }

        /// <summary>True when a socket is accepted on the port, whoever owns it.</summary>
        public static bool PortIsTaken()
        {
            return IsListening(400);
        }

        /// <summary>Anti-hammer gap between launch attempts.</summary>
        private const int LaunchCooldownMs = 5000;

        private static DateTime lastLaunchUtc = DateTime.MinValue;

        /// <summary>
        /// The script process from the last launch. It ends in $server.WaitForExit(),
        /// so while it is alive a build or the server itself is in progress and a
        /// second launch would only start a duplicate build. Once it has exited
        /// without the dashboard answering, the attempt failed and retrying is
        /// exactly what should happen - which is what the old one-shot flag made
        /// impossible.
        /// </summary>
        private static Process launchProcess;

        /// <summary>Why the last attempt did not produce a serving dashboard, or null.</summary>
        public static string LastProblem { get; private set; }

        /// <summary>
        /// Launches the host script detached.
        ///
        /// The old version latched a "requested" flag that only cleared if Process.Start
        /// threw, so a script that ran and failed (a broken build, a missing Node) left
        /// the tray waiting 240 seconds and never trying again for the life of the
        /// process. Attempts are now rate limited instead of one-shot: a long
        /// npm run build still cannot be started twice, but opening the panel again
        /// really does retry.
        /// </summary>
        public static void StartDetached()
        {
            StartDetached(null);
        }

        /// <summary>Launches the host script, optionally asking it to restart a live server.</summary>
        public static void StartDetached(string extraArguments)
        {
            lock (Gate)
            {
                if (launchProcess != null)
                {
                    bool alive;
                    try
                    {
                        alive = !launchProcess.HasExited;
                    }
                    catch (Exception)
                    {
                        alive = false;
                    }
                    if (alive)
                    {
                        return;
                    }
                    launchProcess = null;
                }
                if (DateTime.UtcNow - lastLaunchUtc < TimeSpan.FromMilliseconds(LaunchCooldownMs))
                {
                    return;
                }
                lastLaunchUtc = DateTime.UtcNow;
            }

            string script = Path.Combine(ProjectRoot, @"scripts\start-dashboard.ps1");
            try
            {
                if (!File.Exists(script))
                {
                    LastProblem = "missing " + script;
                    PanelForm.LogInit("server: " + LastProblem);
                    return;
                }

                string system = Environment.GetFolderPath(Environment.SpecialFolder.System);
                string shell = Path.Combine(system, @"WindowsPowerShell\v1.0\powershell.exe");
                if (!File.Exists(shell))
                {
                    shell = "powershell.exe";
                }

                ProcessStartInfo psi = new ProcessStartInfo();
                psi.FileName = shell;
                psi.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"" + script + "\" -Port " + port +
                    (string.IsNullOrEmpty(extraArguments) ? "" : " " + extraArguments);
                psi.UseShellExecute = false;
                psi.CreateNoWindow = true;
                psi.WorkingDirectory = ProjectRoot;
                Process started = Process.Start(psi);
                lock (Gate)
                {
                    launchProcess = started;
                }
                // Deliberately not awaited and not waited on: the script blocks on
                // the server it just started, and it must outlive this call.
            }
            catch (Exception ex)
            {
                // Let the next attempt happen immediately: nothing was launched.
                lock (Gate)
                {
                    lastLaunchUtc = DateTime.MinValue;
                }
                LastProblem = "could not run " + script + ": " + ex.Message;
                PanelForm.LogInit("server: " + LastProblem);
            }
        }

        /// <summary>
        /// Stops whatever is serving on the port and starts it again. Only called for
        /// our own server: the script refuses to touch a port it does not own.
        /// </summary>
        public static void RestartDetached()
        {
            lock (Gate)
            {
                lastLaunchUtc = DateTime.MinValue;
                launchProcess = null;
            }
            LastProblem = null;
            StartDetached("-Restart");
        }

        /// <summary>
        /// Makes sure the dashboard answers, starting it when needed. Runs off the
        /// UI thread; every wait is asynchronous.
        /// </summary>
        public static async Task<bool> EnsureAsync(int timeoutMs, Action<string> progress)
        {
            if (IsServing(1500))
            {
                LastProblem = null;
                return true;
            }

            if (progress != null)
            {
                progress(PortIsTaken() ? "端口被占用，正在确认…" : "正在启动本地服务…");
            }
            StartDetached();

            DateTime start = DateTime.UtcNow;
            DateTime deadline = start.AddMilliseconds(timeoutMs);
            while (DateTime.UtcNow < deadline)
            {
                await Task.Delay(300).ConfigureAwait(false);
                if (IsServing(1500))
                {
                    LastProblem = null;
                    return true;
                }
                // A stranger on the port will not move, and waiting four minutes to
                // say so helps nobody.
                if (DateTime.UtcNow - start > TimeSpan.FromSeconds(20) && PortIsTaken())
                {
                    string reason;
                    IsOurHealth(Get(HealthUrl, 1500), out reason);
                    LastProblem = reason ?? ("port " + port + " is taken by another program");
                    PanelForm.LogInit("server: " + LastProblem);
                    return false;
                }
            }

            if (LastProblem == null)
            {
                LastProblem = "the dashboard did not answer within " + (timeoutMs / 1000) + " s";
            }
            PanelForm.LogInit("server: " + LastProblem);
            return false;
        }
    }
}
