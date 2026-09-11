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
            PanelForm panel, string firstContent, int contentTimeoutMs)
        {
            List<string> lines = new List<string>();
            Dictionary<string, object> fields = new Dictionary<string, object>();

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
            Add(lines, fields, "escape bridge", await EvalAsync(panel, "String(window.__rmBridge)"));
            Add(lines, fields, "webview2 core", panel.CoreVersion());
            Add(lines, fields, "content ready", panel.IsContentReady ? "yes" : "no");
            Add(lines, fields, "webview failed", panel.WebViewFailed ? "yes" : "no");
            Add(lines, fields, "panel visible", panel.Visible ? "yes" : "no");
            Add(lines, fields, "panel rect", panel.Left + "," + panel.Top + " " + panel.Width + "x" + panel.Height);

            return Result(lines, fields);
        }

        /// <summary>Saves the flyout exactly as it appears on screen.</summary>
        public static async Task<Dictionary<string, object>> ShotAsync(
            PanelForm panel, string path, int contentTimeoutMs)
        {
            List<string> lines = new List<string>();
            Dictionary<string, object> fields = new Dictionary<string, object>();

            if (string.IsNullOrEmpty(path))
            {
                throw new ArgumentException("shot needs a path");
            }

            panel.ShowPanel();
            await panel.WaitForContentAsync(contentTimeoutMs);
            // Let the compositor settle so a capture is never a half-painted frame.
            await Task.Delay(700);
            panel.CaptureTo(path);

            string full = Path.GetFullPath(path);
            Add(lines, fields, "wrote", full);
            Add(lines, fields, "css viewport", await EvalAsync(panel, "window.innerWidth + 'x' + window.innerHeight"));

            return Result(lines, fields);
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
