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
        public const string BaseUrl = "http://127.0.0.1:3000";
        public const int Port = 3000;
        public static readonly string ProjectRoot = @"D:\dashboard";

        private static readonly object Gate = new object();
        private static bool launchRequested;

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
        /// True once the Next.js app answers a real request. A listening socket is
        /// not enough: the server binds before the first route is compiled.
        /// </summary>
        public static bool IsServing(int timeoutMs)
        {
            try
            {
                HttpWebRequest request = (HttpWebRequest)WebRequest.Create(BaseUrl + "/api/sources");
                request.Proxy = null;
                request.Method = "GET";
                request.Timeout = timeoutMs;
                request.ReadWriteTimeout = timeoutMs;
                request.KeepAlive = false;
                request.AllowAutoRedirect = false;
                using (HttpWebResponse response = (HttpWebResponse)request.GetResponse())
                {
                    int code = (int)response.StatusCode;
                    return code >= 200 && code < 500;
                }
            }
            catch (WebException ex)
            {
                // An HTTP error status still proves the app is up and serving.
                HttpWebResponse response = ex.Response as HttpWebResponse;
                if (response != null)
                {
                    int code = (int)response.StatusCode;
                    response.Close();
                    return code >= 200 && code < 500;
                }
                return false;
            }
            catch
            {
                return false;
            }
        }

        /// <summary>
        /// Launches the host script detached. Safe to call repeatedly: the script
        /// itself is idempotent (it exits 0 when the port is already listening) and
        /// this method additionally fires at most once per process, so a long
        /// npm run build can never be started twice.
        /// </summary>
        public static void StartDetached()
        {
            lock (Gate)
            {
                if (launchRequested)
                {
                    return;
                }
                launchRequested = true;
            }

            try
            {
                string script = Path.Combine(ProjectRoot, @"scripts\start-dashboard.ps1");
                if (!File.Exists(script))
                {
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
                psi.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"" + script + "\"";
                psi.UseShellExecute = false;
                psi.CreateNoWindow = true;
                psi.WorkingDirectory = ProjectRoot;
                Process.Start(psi);
                // Deliberately not awaited and not waited on: the script blocks on
                // the server it just started, and it must outlive this call.
            }
            catch
            {
                lock (Gate)
                {
                    launchRequested = false;
                }
            }
        }

        /// <summary>
        /// Makes sure the dashboard answers, starting it when needed. Runs off the
        /// UI thread; every wait is asynchronous.
        /// </summary>
        public static async Task<bool> EnsureAsync(int timeoutMs, Action<string> progress)
        {
            if (IsServing(800))
            {
                return true;
            }

            if (progress != null)
            {
                progress("正在启动本地服务…");
            }
            StartDetached();

            DateTime deadline = DateTime.UtcNow.AddMilliseconds(timeoutMs);
            while (DateTime.UtcNow < deadline)
            {
                await Task.Delay(300).ConfigureAwait(false);
                if (IsServing(1500))
                {
                    return true;
                }
            }
            return false;
        }
    }
}
