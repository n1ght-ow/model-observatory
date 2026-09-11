using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Threading.Tasks;

namespace RouterMonitorTray
{
    /// <summary>
    /// Measurements taken against a live flyout. They are deliberately independent
    /// of who asks: the control channel runs them against the tray that is already
    /// on screen, and the command line runs them against a flyout it opened itself.
    /// Both produce the same "label : value" lines, so a report reads the same
    /// either way.
    /// </summary>
    internal static class Diagnostics
    {
        /// <summary>Label column width used by every report line since the first build.</summary>
        private const int LabelWidth = 16;

        /// <summary>
        /// What the flyout renders and whether its bridge is installed.
        /// `firstContent` is passed in when the caller measured it itself; pass null
        /// to have this method open the panel and time it.
        /// </summary>
        public static async Task<Dictionary<string, object>> ProbeAsync(
            PanelForm panel, string firstContent, string page, int contentTimeoutMs)
        {
            List<string> lines = new List<string>();
            Dictionary<string, object> fields = new Dictionary<string, object>();

            if (!string.IsNullOrEmpty(page))
            {
                panel.ShowPanel();
                await panel.WaitForContentAsync(contentTimeoutMs);
                panel.NavigateTo(page);
                await Task.Delay(1200);
                await panel.WaitForContentAsync(contentTimeoutMs);
            }

            if (firstContent == null)
            {
                if (panel.IsContentReady)
                {
                    firstContent = "n/a (panel already loaded)";
                }
                else
                {
                    Stopwatch clock = Stopwatch.StartNew();
                    panel.ShowPanel();
                    bool ready = await panel.WaitForContentAsync(contentTimeoutMs);
                    firstContent = ready
                        ? clock.ElapsedMilliseconds + " ms"
                        : "timed out after " + contentTimeoutMs + " ms";
                }
            }

            Add(lines, fields, "first content", firstContent);
            Add(lines, fields, "css viewport", await EvalAsync(panel, "window.innerWidth + 'x' + window.innerHeight"));
            Add(lines, fields, "device pixel r", await EvalAsync(panel, "String(window.devicePixelRatio)"));
            Add(lines, fields, "document.title", await EvalAsync(panel, "document.title"));
            Add(lines, fields, "document size", await EvalAsync(panel,
                "document.documentElement.scrollWidth + 'x' + document.documentElement.scrollHeight"));
            Add(lines, fields, "escape bridge", await EvalAsync(panel,
                "window.__rmBridge ? ('v' + window.__rmBridge.version) : '(absent)'"));
            Add(lines, fields, "bridge last", panel.BridgeState);
            Add(lines, fields, "webview2 core", panel.CoreVersion());
            Add(lines, fields, "content ready", panel.IsContentReady ? "yes" : "no");
            Add(lines, fields, "webview failed", panel.WebViewFailed ? "yes" : "no");
            Add(lines, fields, "panel visible", panel.Visible ? "yes" : "no");
            Add(lines, fields, "panel rect", panel.Left + "," + panel.Top + " " + panel.Width + "x" + panel.Height);

            return Result(lines, fields);
        }

        /// <summary>Saves the flyout exactly as it appears on screen.</summary>
        public static async Task<Dictionary<string, object>> ShotAsync(
            PanelForm panel, string path, string page, int contentTimeoutMs)
        {
            List<string> lines = new List<string>();
            Dictionary<string, object> fields = new Dictionary<string, object>();

            if (string.IsNullOrEmpty(path))
            {
                throw new ArgumentException("shot needs a path");
            }

            panel.ShowPanel();
            await panel.WaitForContentAsync(contentTimeoutMs);
            if (!string.IsNullOrEmpty(page))
            {
                panel.NavigateTo(page);
                await Task.Delay(1200);
                await panel.WaitForContentAsync(contentTimeoutMs);
            }
            // Let the compositor settle so a capture is never a half-painted frame.
            await Task.Delay(700);
            panel.CaptureTo(path);

            string full = Path.GetFullPath(path);
            Add(lines, fields, "wrote", full);
            Add(lines, fields, "css viewport", await EvalAsync(panel, "window.innerWidth + 'x' + window.innerHeight"));

            return Result(lines, fields);
        }

        /// <summary>
        /// Opens, hides and reopens the flyout so the warm reopen latency and the
        /// suspend behaviour can be measured without driving the tray icon. This is
        /// the one measurement that only the tray can take: it is about the WebView
        /// the tray owns.
        /// </summary>
        public static async Task<Dictionary<string, object>> CycleAsync(
            PanelForm panel, string output, string page, int holdMs, int contentTimeoutMs)
        {
            List<string> lines = new List<string>();
            Dictionary<string, object> fields = new Dictionary<string, object>();
            ProcessSampler sampler = new ProcessSampler();
            Stopwatch clock = Stopwatch.StartNew();

            panel.ShowPanel();
            if (!string.IsNullOrEmpty(page))
            {
                panel.NavigateTo(page);
            }
            await panel.WaitForContentAsync(contentTimeoutMs);
            await SettleAsync();

            Add(lines, fields, "mode", "cycle");
            Add(lines, fields, "display scale", panel.DpiScale.ToString("0.###"));
            Add(lines, fields, "css-per-px scale", panel.CssScale.ToString("0.###"));
            Add(lines, fields, "webview zoom", panel.WebZoomFactor.ToString("0.###"));
            Add(lines, fields, "panel client px", panel.ClientSize.Width + "x" + panel.ClientSize.Height);

            // Visible phase: the panel is on screen and the page is live.
            Say(lines, sampler.Sample("visible"));
            for (int i = 0; i < 12; i++)
            {
                await Task.Delay(500);
                Say(lines, sampler.Sample("visible"));
            }
            if (!string.IsNullOrEmpty(output))
            {
                panel.CaptureTo(output);
                Add(lines, fields, "shot open", Path.GetFullPath(output));
            }

            await MeasureInteractionAsync(panel, lines, fields);

            Add(lines, fields, "suspend before", panel.SuspendState);
            long hiddenAtMs = clock.ElapsedMilliseconds;
            panel.HidePanel();

            // Hidden phase: this is what the tray costs while nobody is looking.
            await Task.Delay(500);
            Say(lines, sampler.Sample("hidden"));
            int held = 500;
            while (held < holdMs)
            {
                await Task.Delay(500);
                held += 500;
                Say(lines, sampler.Sample("hidden"));
            }

            Add(lines, fields, "hidden at", hiddenAtMs + " ms");
            Add(lines, fields, "suspend hidden", panel.SuspendState);

            long reopenedAtMs = clock.ElapsedMilliseconds;
            panel.ShowPanel();

            // Honest warm-reopen measure: round-trip a script into the resumed
            // renderer, which only answers once Chromium is actually running again.
            string alive = "(no reply)";
            while (clock.ElapsedMilliseconds - reopenedAtMs < 30000)
            {
                alive = await EvalAsync(panel, "String(document.querySelectorAll('svg.recharts-surface').length)");
                if (alive != "(timeout)" && alive != "(null)")
                {
                    break;
                }
                await Task.Delay(10);
            }
            Add(lines, fields, "reopen latency", (clock.ElapsedMilliseconds - reopenedAtMs) +
                " ms (script round-trip into the resumed renderer)");
            Add(lines, fields, "reopen charts", alive);
            Add(lines, fields, "suspend after", panel.SuspendState);
            Say(lines, sampler.Sample("reopened"));

            await SettleAsync();
            if (!string.IsNullOrEmpty(output))
            {
                string second = Path.ChangeExtension(output, null) + "-reopened.png";
                panel.CaptureTo(second);
                Add(lines, fields, "shot reopened", Path.GetFullPath(second));
            }

            return Result(lines, fields);
        }

        /// <summary>
        /// Times a real in-panel interaction: it clicks the Requests link exactly as a
        /// user would and waits for the route to change. This is the number that says
        /// whether clicking anything in the flyout feels slow.
        /// </summary>
        private static async Task MeasureInteractionAsync(
            PanelForm panel, List<string> lines, Dictionary<string, object> fields)
        {
            Stopwatch clock = Stopwatch.StartNew();
            string clicked = await EvalAsync(panel,
                "(function(){var a=document.querySelector('a[href=\"/requests\"]');" +
                "if(!a){return 'no-link';}a.click();return 'clicked';})()");
            Add(lines, fields, "nav click", clicked);

            long start = clock.ElapsedMilliseconds;
            string path = "";
            while (clock.ElapsedMilliseconds - start < 15000)
            {
                path = await EvalAsync(panel, "location.pathname");
                if (path == "/requests")
                {
                    break;
                }
                await Task.Delay(10);
            }
            Add(lines, fields, "route change", path + " after " + (clock.ElapsedMilliseconds - start) + " ms");

            // A second interaction inside the loaded page: switch the range chip.
            long chipStart = clock.ElapsedMilliseconds;
            await EvalAsync(panel, "(function(){var b=document.querySelectorAll('button');" +
                "for(var i=0;i<b.length;i++){if(b[i].textContent.trim()==='7d'){b[i].click();return 'clicked';}}" +
                "return 'no-chip';})()");
            await Task.Delay(1200);
            Add(lines, fields, "range chip", "responded in " + (clock.ElapsedMilliseconds - chipStart) +
                " ms (incl. 1200 ms settle)");
        }

        /// <summary>Lets the compositor settle so a capture is never a half-painted frame.</summary>
        private static async Task SettleAsync()
        {
            await Task.Delay(700);
        }

        private static void Say(List<string> lines, string line)
        {
            lines.Add(line);
        }

        /// <summary>Runs a script in the page and normalises the JSON encoded answer.</summary>
        public static async Task<string> EvalAsync(PanelForm panel, string script)
        {
            try
            {
                return Describe(await panel.RunScriptAsync(script));
            }
            catch (Exception ex)
            {
                return "(error: " + ex.Message + ")";
            }
        }

        /// <summary>Strips the JSON string quoting ExecuteScriptAsync wraps results in.</summary>
        public static string Describe(string raw)
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

        /// <summary>Formats one report line and records the same value for assertions.</summary>
        private static void Add(List<string> lines, Dictionary<string, object> fields, string label, string value)
        {
            if (value == null)
            {
                value = "(null)";
            }
            lines.Add(label.PadRight(LabelWidth) + ": " + value);
            fields[label] = value;
        }

        private static Dictionary<string, object> Result(List<string> lines, Dictionary<string, object> fields)
        {
            Dictionary<string, object> result = new Dictionary<string, object>();
            result["lines"] = lines;
            result["fields"] = fields;
            return result;
        }
    }
}
