using System;
using System.Drawing;

namespace RouterMonitorTray
{
    internal sealed partial class PanelView
    {
        /// <summary>
        /// Recomputes the scrollable height for the current page. Every page
        /// lays its cards out with plain arithmetic, so measuring never needs a
        /// Graphics object and the scrollbar stays exact before the first paint.
        /// </summary>
        private void MeasureContent()
        {
            if (Snap == null)
            {
                contentHeight = 240f;
                return;
            }
            if (State.Page == "requests")
            {
                LayoutRequests();
            }
            else if (State.Page == "models")
            {
                LayoutModels();
            }
            else if (State.Page == "deepseek")
            {
                LayoutDeepSeek();
            }
            else if (State.Page == "command-code")
            {
                LayoutCommandCode();
            }
            else
            {
                LayoutOverview();
            }
            scroll = Clamp(scroll);
        }

        /// <summary>
        /// Dumps the measured layout so the diagnostic renderer can compare it,
        /// number for number, with the browser DOM (see the README).
        /// </summary>
        public string DumpLayout()
        {
            System.Text.StringBuilder text = new System.Text.StringBuilder();
            text.AppendLine("page=" + State.Page + " contentHeight=" + contentHeight.ToString("0.##", Inv)
                + " viewport=" + Viewport.ToString("0.##", Inv));
            text.AppendLine("sidebar=" + SidebarW.ToString("0.##", Inv)
                + " mainX=" + MainX.ToString("0.##", Inv)
                + " pageX=" + PageX.ToString("0.##", Inv)
                + " pageW=" + PageW.ToString("0.##", Inv));
            Dump(text, "stats", ovStats);
            Dump(text, "trendRequests", ovRequests);
            Dump(text, "trendTokens", ovTokens);
            Dump(text, "recent", ovRecent);
            Dump(text, "distribution", ovDistribution);
            Dump(text, "health", ovStatus);
            Dump(text, "topModels", ovTopModels);
            Dump(text, "activity", ovActivity);
            Dump(text, "insights", ovInsights);
            return text.ToString();
        }

        private void Dump(System.Text.StringBuilder text, string name, RectangleF rect)
        {
            if (rect.Width <= 0f && rect.Height <= 0f)
            {
                return;
            }
            // Reported in screen coordinates so they line up with the DOM probe.
            text.AppendLine(name + " x=" + rect.X.ToString("0.##", Inv)
                + " y=" + (rect.Y + ContentTop).ToString("0.##", Inv)
                + " w=" + rect.Width.ToString("0.##", Inv)
                + " h=" + rect.Height.ToString("0.##", Inv));
        }
    }
}
