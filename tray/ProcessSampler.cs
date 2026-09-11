using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Management;

namespace RouterMonitorTray
{
    /// <summary>
    /// What the flyout costs: how many Chromium processes it owns, how much memory
    /// they hold and how much CPU they burn between two samples.
    ///
    /// Only processes descended from this one are counted. Other applications ship
    /// their own WebView2 and must never be blamed on this tray.
    /// </summary>
    internal sealed class ProcessSampler
    {
        private double lastCpuMs = -1;
        private Dictionary<int, int> parentOf;

        /// <summary>Process ids of the msedgewebview2 processes belonging to this tray.</summary>
        public int[] OwnBrowserProcesses()
        {
            int selfPid = Process.GetCurrentProcess().Id;
            List<int> found = new List<int>();
            try
            {
                if (parentOf == null)
                {
                    parentOf = ReadParentMap();
                }
                // The cached map carries no names, so which of these are browsers is
                // asked separately - but only once per sample, not twice.
                List<int> browsers = new List<int>();
                ManagementObjectSearcher searcher = new ManagementObjectSearcher(
                    "SELECT ProcessId FROM Win32_Process WHERE Name='msedgewebview2.exe'");
                foreach (ManagementBaseObject item in searcher.Get())
                {
                    browsers.Add(Convert.ToInt32(item["ProcessId"]));
                    item.Dispose();
                }
                searcher.Dispose();

                for (int i = 0; i < browsers.Count; i++)
                {
                    int current = browsers[i];
                    for (int depth = 0; depth < 12; depth++)
                    {
                        int parent;
                        if (!parentOf.TryGetValue(current, out parent) || parent == 0)
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
            catch (Exception ex)
            {
                PanelForm.LogInit("sample: " + ex.Message);
            }
            return found.ToArray();
        }

        /// <summary>
        /// One full parent map. The old version built two: a browser-only map and then
        /// every process on the machine, every 500 ms. One pass is enough and it is
        /// cached for the life of a sampling run.
        /// </summary>
        private static Dictionary<int, int> ReadParentMap()
        {
            Dictionary<int, int> map = new Dictionary<int, int>();
            ManagementObjectSearcher searcher = new ManagementObjectSearcher(
                "SELECT ProcessId, ParentProcessId FROM Win32_Process");
            foreach (ManagementBaseObject item in searcher.Get())
            {
                try
                {
                    map[Convert.ToInt32(item["ProcessId"])] = Convert.ToInt32(item["ParentProcessId"]);
                }
                catch (Exception)
                {
                }
                item.Dispose();
            }
            searcher.Dispose();
            return map;
        }

        /// <summary>Forgets the cached process tree, so the next sample re-reads it.</summary>
        public void Invalidate()
        {
            parentOf = null;
        }

        /// <summary>
        /// Records what this tray costs right now. The CPU column is a delta since the
        /// previous sample, which is what shows whether a hidden panel still burns
        /// cycles.
        /// </summary>
        public string Sample(string phase)
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
                catch (Exception)
                {
                }
            }

            double delta = lastCpuMs < 0 ? 0 : cpu - lastCpuMs;
            lastCpuMs = cpu;

            double trayMb;
            using (Process self = Process.GetCurrentProcess())
            {
                trayMb = self.WorkingSet64 / 1048576.0;
            }

            return string.Format(
                "sample {0,-8} wv2Count={1,-3} wv2Mem={2,7:N1}MB wv2Committed={3,7:N1}MB wv2CpuDelta={4,6:N0}ms trayMem={5,6:N1}MB",
                phase, pids.Length, workingSet / 1048576.0, committed / 1048576.0, delta, trayMb);
        }
    }
}
