using System;
using System.Collections.Generic;
using System.Drawing;
using System.Globalization;

namespace RouterMonitorTray
{
    /// <summary>The Overview page: MetricStatGrid, both trend cards, the request
    /// table, the model distribution donut, source health, top models, activity
    /// and the usage insights block.</summary>
    internal sealed partial class PanelView
    {
        private RectangleF ovStats;
        private RectangleF ovRequests;
        private RectangleF ovTokens;
        private RectangleF ovRecent;
        private RectangleF ovCmdLimits;
        private RectangleF ovDistribution;
        private RectangleF ovStatus;
        private RectangleF ovStatusCard;
        private RectangleF ovTopModels;
        private RectangleF ovActivity;
        private RectangleF ovInsights;
        private int ovRecentRows;
        private int ovStatusRows;

        // Card rectangles measured on the live page at the reference viewport;
        // the grid's rows are gap-px, so each row is one pixel taller than its
        // cards. Rectangle order follows the page, not the source file.
        private const float OvTrendH = 374f;
        private const float OvRecentH = 773f;     // header 95 + head 40 + 12 x 53
        private const float OvHealthH = 402f;
        /// <summary>Natural height of the health card inside its taller grid row.</summary>
        private const float OvHealthCardH = 402f;
        private const float OvTopModelsH = 479f;
        private const float OvActivityH = 479f;
        private const float OvInsightsH = 473f;

        private void LayoutOverview()
        {
            // p-6 (24) + the h1 block (52) + the page's gap-4, then the grid
            // container's own p-px on both axes: measured cards start one pixel
            // inside the page content box (h1 at 80, cards at x=281 y=149).
            float y = Mx.PagePad + Mx.PageHeaderH + Mx.CardGap + 1f;
            float gridX = PageX + 1f;
            float gridW = PageW - 2f;
            // The browser rounds each half to 567 while the pair still totals the
            // grid width, so the right card takes whatever the left leaves.
            float col2 = (float)Math.Ceiling((gridW - 1f) / 2f);
            float col2b = gridW - 1f - col2;

            ovStats = new RectangleF(gridX, y, gridW, Mx.StatH);
            y += Mx.StatH + 1f;

            ovRequests = new RectangleF(gridX, y, col2, OvTrendH);
            ovTokens = new RectangleF(gridX + col2 + 1f, y, col2b, OvTrendH);
            y += OvTrendH + 1f;

            // Row 3: the request log beside the Command Code credit windows.
            ovRecentRows = Snap == null ? 0 : Math.Min(Snap.Recent.Count, 12);
            ovRecent = new RectangleF(gridX, y, col2, OvRecentH);
            ovCmdLimits = new RectangleF(gridX + col2 + 1f, y, col2b, OvRecentH);
            y += OvRecentH + 1f;

            // Row 4: the model distribution moved down here, beside Router health.
            ovDistribution = new RectangleF(gridX, y, col2, OvHealthH);
            ovStatusRows = Snap == null ? 0 : Math.Min(Snap.WindowProviders.Count, 5);
            ovStatus = new RectangleF(gridX + col2 + 1f, y, col2b, OvHealthH);
            y += OvHealthH + 1f;

            // Row 5: Top models on the left, Activity on the right.
            ovTopModels = new RectangleF(gridX, y, col2, OvTopModelsH);
            ovActivity = new RectangleF(gridX + col2 + 1f, y, col2b, OvActivityH);
            y += OvTopModelsH + 1f;

            ovInsights = new RectangleF(gridX, y, gridW, OvInsightsH);
            y += OvInsightsH;

            contentHeight = y + Mx.PagePad;
        }

        private int DistributionRows()
        {
            if (Snap == null) return 0;
            return Math.Min(Snap.WindowModels.Count, 5);
        }

        private int TopModelRows()
        {
            if (Snap == null) return 0;
            return Math.Min(Snap.WindowModels.Count, 6);
        }

        private void DrawOverviewPage(Graphics g)
        {
            string description = Snap.Source == "router"
                ? "Usage, latency, and token trends from Codex Router API."
                : "Usage, tokens, and cost trends from the native DeepSeek API.";
            PageHeader(g, "Overview", description, true, true);

            GridRow(g, ovStats, 4);
            DrawOverviewStats(g);

            GridPair(g, ovRequests, ovTokens);
            DrawTrendRequests(g);
            DrawTrendTokens(g);

            GridPair(g, ovRecent, ovCmdLimits);
            DrawRecentCompact(g);
            DrawCommandCodeLimits(g);

            // Row 4: model distribution beside Router health.
            GridPair(g, ovDistribution, ovStatus);
            DrawDistribution(g);
            DrawSourceStatus(g);

            GridPair(g, ovTopModels, ovActivity);
            DrawTopModels(g);
            DrawActivity(g);

            GridOutline(g, ovInsights);
            DrawUsageInsights(g);
        }

        /// <summary>
        /// A row of equal flush cells. Cell widths come from the grid's inner
        /// width divided by the column count, rounded the way the browser rounds
        /// them (1134 / 4 -> 283,283,283,283 with a 1px gap between).
        /// </summary>
        private void GridRow(Graphics g, RectangleF row, int columns)
        {
            Cards.Line(g, row.X, row.Y - 1f, row.Width, Theme.Border);
            Cards.Line(g, row.X, row.Bottom, row.Width, Theme.Border);
            Cards.VLine(g, row.X, row.Y - 1f, row.Height + 1f, Theme.Border);
            Cards.VLine(g, row.Right, row.Y - 1f, row.Height + 1f, Theme.Border);
            float inner = row.Width - (columns - 1);
            float cell = (float)Math.Round(inner / columns);
            float x = row.X;
            for (int i = 1; i < columns; i++)
            {
                x += cell + 1f;
                Cards.VLine(g, x - 1f, row.Y - 1f, row.Height + 1f, Theme.Border);
            }
        }

        /// <summary>
        /// A two-up row: one outer box and a single shared rule in the gap, which
        /// is what the grid's `gap-px` produces. Outlining both cards separately
        /// would double the middle rule.
        /// </summary>
        private void GridPair(Graphics g, RectangleF left, RectangleF right)
        {
            RectangleF row = new RectangleF(left.X, left.Y, right.Right - left.X, left.Height);
            Cards.Line(g, row.X, row.Y - 1f, row.Width, Theme.Border);
            Cards.Line(g, row.X, row.Bottom, row.Width, Theme.Border);
            Cards.VLine(g, row.X, row.Y - 1f, row.Height + 1f, Theme.Border);
            Cards.VLine(g, row.Right, row.Y - 1f, row.Height + 1f, Theme.Border);
            Cards.VLine(g, left.Right, row.Y - 1f, row.Height + 1f, Theme.Border);
        }

        /// <summary>
        /// A card that spans the whole grid: its top rule sits one pixel above the
        /// card (the grid's `p-px`) and its bottom rule is shared with the next
        /// row — measured as rules at 148/302/677 for cards at 149/303/678.
        /// </summary>
        private void GridOutline(Graphics g, RectangleF card)
        {
            Cards.Line(g, card.X, card.Y - 1f, card.Width, Theme.Border);
            Cards.Line(g, card.X, card.Bottom, card.Width, Theme.Border);
            Cards.VLine(g, card.X - 1f, card.Y - 1f, card.Height + 1f, Theme.Border);
            Cards.VLine(g, card.Right, card.Y - 1f, card.Height + 1f, Theme.Border);
        }

        private string PeriodLabel()
        {
            if (Snap == null) return "";
            if (Snap.Window.AllTime) return "all time";
            if (Snap.Window.Days == 1) return "last 24 hours";
            return "last " + Snap.Window.Days + " days";
        }

        private double[] DailySeries(string kind)
        {
            double[] values = new double[Snap.Daily.Count];
            for (int i = 0; i < Snap.Daily.Count; i++)
            {
                DailyRow row = Snap.Daily[i];
                if (kind == "requests") values[i] = row.Requests;
                else if (kind == "tokens") values[i] = row.Tokens;
                else if (kind == "success") values[i] = row.Requests <= 0 ? 0 : (row.Success / row.Requests) * 100.0;
                else if (kind == "cost") values[i] = row.Cost;
                else values[i] = row.AvgMs;
            }
            return values;
        }

        private void DrawOverviewStats(Graphics g)
        {
            Totals window = Snap.Window;
            float cell = (ovStats.Width - 3f) / 4f;
            string period = PeriodLabel();

            string latency = window.AvgMs > 0 ? Fmt.Int(window.AvgMs) + " ms" : "\u2014";
            string latencyFooter = window.AvgFirstTokenMs > 0
                ? "first token " + Fmt.Int(window.AvgFirstTokenMs) + " ms"
                : "latency not available in session log";

            RectangleF[] cells = new RectangleF[4];
            for (int i = 0; i < 4; i++)
            {
                cells[i] = new RectangleF(ovStats.X + i * (cell + 1f), ovStats.Y, cell, ovStats.Height);
            }

            Widgets.StatCard(g, cells[0], "Requests", Fmt.Int(window.Requests), window.DeltaRequests,
                period, DailySeries("requests"));
            Widgets.StatCard(g, cells[1], "Tokens", Theme.Compact(window.Tokens), window.DeltaTokens,
                period, DailySeries("tokens"));
            Widgets.StatCard(g, cells[2], "Success rate", window.SuccessRate.ToString("0.0", Inv) + "%",
                window.DeltaSuccessRatePp, Fmt.Int(Snap.TotalsAll.Failed) + " failed all-time",
                DailySeries("success"));
            Widgets.StatCard(g, cells[3], "Avg latency", latency, window.DeltaLatency, latencyFooter,
                DailySeries("latency"));
        }

        private void TrendCardHeader(Graphics g, RectangleF card, string title, double delta)
        {
            // These titles are the default leading-snug variant, so they need the
            // 1px less half-leading that Cards.Header also applies.
            Theme.Text(g, title, Mx.CardTitle, FontStyle.Regular, Theme.Fg, card.X + Mx.CardPad,
                card.Y + Mx.CardPad - 1f);
            float width = Theme.Measure(g, title, Mx.CardTitle, FontStyle.Regular);
            if (Math.Abs(delta) >= 0.05)
            {
                Widgets.DeltaBadge(g, card.X + Mx.CardPad + width + 8f, card.Y + Mx.CardPad - 1f, delta, "%");
            }
        }

        private void DrawTrendRequests(Graphics g)
        {
            RectangleF card = ovRequests;
            TrendCardHeader(g, card, "Requests per day", Snap.Window.DeltaRequests);
            // Measured: this card's header is space-y-2, so its description sits
            // at +46 like the other text-base headers, not the usual +42.
            Theme.Text(g, "API calls, " + PeriodLabel() + ".", Mx.Body, FontStyle.Regular, Theme.Muted,
                card.X + Mx.CardPad, card.Y + 46f);

            // This card's header carries no border-b: the only line across it is
            // the chart's own top grid stroke, at card.y + 71.
            RectangleF plot = Widgets.TrendPlot(card, 0f);
            if (Snap.Daily.Count == 0)
            {
                Theme.Text(g, "No requests in this window.", Mx.Body, FontStyle.Regular, Theme.Muted,
                    plot.X, plot.Y + 20f);
                return;
            }
            int hoverBar = BarHoverIndex(plot, Snap.Daily.Count);
            Widgets.RequestsChart(g, plot, card, Snap.Daily, hoverBar);
            Widgets.ChartTooltip(g, plot, Snap.Daily, hoverBar, false);
        }

        private int BarHoverIndex(RectangleF plot, int count)
        {
            if (count <= 0)
            {
                return -1;
            }
            PointF content = new PointF(ContentMouse.X, ContentMouse.Y);
            if (content.X < plot.X || content.X > plot.Right || content.Y < plot.Y - 6f || content.Y > plot.Bottom + 6f)
            {
                return -1;
            }
            float slot = plot.Width / count;
            int index = (int)((content.X - plot.X) / slot);
            if (index < 0) index = 0;
            if (index >= count) index = count - 1;
            return index;
        }

        private void DrawTrendTokens(Graphics g)
        {
            RectangleF card = ovTokens;
            TrendCardHeader(g, card, "Tokens and success", Snap.Window.DeltaTokens);
            Theme.Text(g, "Daily tokens with successful calls, " + PeriodLabel() + ".", Mx.Body, FontStyle.Regular,
                Theme.Muted, card.X + Mx.CardPad, card.Y + 46f);

            // This card's header wraps its title row in space-y-2, which is 4px
            // taller than the Requests card's plain flex row.
            RectangleF plot = Widgets.TrendPlot(card, 4f);
            if (Snap.Daily.Count < 2)
            {
                Theme.Text(g, "Not enough data for a trend yet.", Mx.Body, FontStyle.Regular, Theme.Muted,
                    plot.X, plot.Y + 20f);
                return;
            }
            Widgets.TokensChart(g, plot, card, Snap.Daily);
        }

        private void DrawRecentCompact(Graphics g)
        {
            RectangleF card = ovRecent;
            // CardTitle className="text-base" -> the 24px line-height variant, which
            // makes this header 81 not 79. Take the returned content top rather than
            // pinning 79: the 2px difference shifted every row of the table.
            float contentTop = Cards.Header(g, card, "Recent requests",
                Snap.Source == "router" ? "Latest calls through Codex Router API." : "Latest calls through the native DeepSeek API.",
                true, Mx.TitleLineBase);
            if (ovRecentRows == 0)
            {
                Cards.Empty(g, new RectangleF(card.X, contentTop, card.Width, card.Bottom - contentTop), "activity",
                    "No requests", "No calls were recorded for this source yet.");
                return;
            }
            RectangleF table = new RectangleF(card.X, contentTop, card.Width, card.Bottom - contentTop);
            Widgets.RequestsTable(g, table, Snap.Recent, 0, ovRecentRows, "", false, null, hover);
        }

/// <summary>
        /// The Overview's compact Command Code limits card: one paced window per
        /// block, each a label row with a tone-coloured percentage badge and the
        /// credits used against the cap, a 6px progress bar, then a footer row
        /// pairing the credits left with the reset time.
        ///
        /// Measured on the live card at x=973 y=678: content starts at card.Y+81
        /// with a further py-4, rows pitch 74px (20 + 8 + 6 + 8 + 16) with a 16px
        /// gap between them, and the bar spans the content width.
        /// </summary>
        private void DrawCommandCodeLimits(Graphics g)
        {
            RectangleF card = ovCmdLimits;
            CommandCodeInfo info = Snap == null || Snap.CommandCode == null
                ? new CommandCodeInfo()
                : Snap.CommandCode;
            List<CommandWindow> windows = info.Windows;

            Cards.Header(g, card, "Command Code limits",
                "Rolling 5-hour, weekly and monthly credit windows from api.commandcode.ai.", true,
                Mx.TitleLineBase);
            Cards.Badge(g, card.X + Mx.CardPad +
                Theme.MeasureW(g, "Command Code limits", Mx.CardTitle, 500) + 8f,
                card.Y + Mx.CardPad,
                info.Online ? "live" : "unreachable",
                info.Online ? BadgeKind.Secondary : BadgeKind.Destructive);

            float left = card.X + 24f;
            float right = card.Right - 24f;
            float width = right - left;
            float y = card.Y + Mx.FlushHeaderRuledH + 16f;

            if (windows.Count == 0)
            {
                Theme.Text(g, info.Error.Length > 0
                        ? info.Error
                        : "No Command Code windows were reported by the billing API.",
                    Mx.Body, FontStyle.Regular, Theme.Muted, left, y);
            }

            for (int i = 0; i < windows.Count; i++)
            {
                CommandWindow window = windows[i];
                bool unlimited = window.Cap <= 0;

                // Row 1: label, percentage badge on the left; credits on the right.
                Theme.TextW(g, window.Label, Mx.Body, 500, Theme.Fg, left, y + 2f);
                float labelWidth = Theme.MeasureW(g, window.Label, Mx.Body, 500);
                string pct = unlimited ? "no cap" : window.UsedPct.ToString("0.0", Inv) + "%";
                Cards.Badge(g, left + labelWidth + 8f, y, pct, BadgeKind.Outline, null, ToneColor(window.UsedPct));
                string amount = Fmt.Money("USD", window.Used) +
                    (unlimited ? "" : " / " + Fmt.Money("USD", window.Cap)) + " credits";
                Theme.TextTRight(g, amount, Mx.Small, FontStyle.Regular, Theme.Muted, right, y + 4f);

                // Row 2: the h-1.5 track with its tone-coloured fill.
                RectangleF track = new RectangleF(left, y + 28f, width, 6f);
                Theme.Fill(g, track, 3f, Theme.Secondary);
                float pctValue = (float)Math.Min(Math.Max(window.UsedPct, 0), 100);
                if (pctValue > 0.5f)
                {
                    Theme.Fill(g, new RectangleF(track.X, track.Y, track.Width * pctValue / 100f, track.Height),
                        3f, ToneColor(window.UsedPct));
                }

                // Row 3: credits left, and the reset time.
                Theme.TextT(g, unlimited ? "unlimited credits" : Fmt.Money("USD", window.Remaining) + " credits left",
                    Mx.Small, FontStyle.Regular, Theme.Muted, left, y + 42f);
                Theme.TextTRight(g, ResetLabel(window), Mx.Small, FontStyle.Regular, Theme.Muted, right, y + 42f);

                y += 74f;
            }

            if (windows.Count > 0 && info.Usage != null)
            {
                CommandUsage usage = info.Usage;
                Theme.TextT(g, Fmt.Int(usage.TotalCount) + " requests \u00b7 " +
                    usage.SuccessRate.ToString("0.0", Inv) + "% success \u00b7 " +
                    Fmt.Money("USD", usage.TotalCost) + " spent all-time",
                    Mx.Small, FontStyle.Regular, Theme.Muted, left, y + 4f);
            }

            float footerY = card.Bottom - Mx.FooterH;
            Cards.TileFooter(g, card, footerY);
            Theme.TextT(g, "Checked " + (info.HasFetchedAt ? Fmt.AccountTime(info.FetchedAt) : "\u2014") +
                (info.LatencyMs > 0 ? " \u00b7 " + Fmt.Int(info.LatencyMs) + " ms" : ""),
                Mx.Small, FontStyle.Regular, Theme.Muted, left,
                Theme.CenterY(g, footerY, card.Bottom, Mx.Small, FontStyle.Regular));

            float jsonWidth = Cards.ButtonWidth(g, "JSON", "refresh");
            RectangleF json = new RectangleF(card.Right - Mx.CardPad - jsonWidth, footerY + 8f, jsonWidth, Mx.BtnSmH);
            Cards.Button(g, json, "JSON", BtnKind.Ghost, "refresh", hover == "json:cc-overview");
            Hit("json:cc-overview", json);
        }

        private void DrawDistribution(Graphics g)
        {
            RectangleF card = ovDistribution;
            Cards.Header(g, card, "Model distribution", WindowPhrase("Token share by model"), true);

            List<ModelRow> routes = new List<ModelRow>(Snap.WindowModels);
            routes.Sort(delegate (ModelRow a, ModelRow b) { return b.Tokens.CompareTo(a.Tokens); });
            if (routes.Count > 5)
            {
                routes.RemoveRange(5, routes.Count - 5);
            }
            double total = 0;
            for (int i = 0; i < routes.Count; i++)
            {
                total += routes[i].Tokens;
            }
            if (routes.Count == 0 || total <= 0)
            {
                Theme.Text(g, "No token usage recorded in this range.", Mx.Body, FontStyle.Regular, Theme.Muted,
                    card.X + Mx.CardPad, card.Y + 95f);
                return;
            }

            double[] values = new double[routes.Count];
            for (int i = 0; i < routes.Count; i++)
            {
                values[i] = routes[i].Tokens;
            }
            Color[] colors = Cards.ChartColors();

            // Measured off the reference: the ChartContainer is aspect-square
            // h-40 w-40 (160px) holding a Pie of outerRadius 70, i.e. a 140px
            // ring centred in it; the list is five text-sm rows (20px) with a
            // gap-2 (8px) pitch of 28, dots size-2.5, and the whole row has
            // items-center against a gap-4 (16px) between the two columns.
            const float Container = 160f;
            const float Outer = 140f;
            const float RowH = 20f;
            const float RowGap = 8f;
            // This card's CardContent is px-6 (24), unlike the header's px-4.
            const float ContentPad = 24f;
            float contentTop = card.Y + 94f;
            float rowsH = routes.Count * RowH + (routes.Count - 1) * RowGap;
            float block = Math.Max(Container, rowsH);
            float donutX = card.X + ContentPad + (Container - Outer) / 2f;
            float donutY = contentTop + (block - Outer) / 2f;
            Cards.Donut(g, new RectangleF(donutX, donutY, Outer, Outer), values, colors);

            float listX = card.X + ContentPad + Container + 16f;
            float listRight = card.Right - Mx.CardPad;
            float y = contentTop + (block - rowsH) / 2f;
            for (int i = 0; i < routes.Count; i++)
            {
                ModelRow route = routes[i];
                float rowMid = y + RowH / 2f;
                Theme.Fill(g, new RectangleF(listX, rowMid - 5f, 10f, 10f), 5f, colors[i % colors.Length]);
                string share = Theme.Compact(route.Tokens) + " \u00b7 " + Cards.Share(route.Tokens, total);
                float shareWidth = Theme.MeasureT(g, share, Mx.Small, FontStyle.Regular);
                float providerWidth = Theme.Measure(g, route.Provider, Mx.Small, FontStyle.Regular);
                float metaX = listRight - shareWidth;
                float nameWidth = metaX - (listX + 18f) - providerWidth - 16f;
                // The legend name is plain text-sm (the table's model cell is the
                // only place that uses font-medium).
                Theme.Text(g, Theme.Fit(g, Fmt.Model(route.Model), Mx.Body, FontStyle.Regular, nameWidth), Mx.Body,
                    FontStyle.Regular, Theme.Fg, listX + 18f, y + 1f);
                Theme.TextRight(g, route.Provider, Mx.Small, FontStyle.Regular, Theme.Muted, metaX - 8f, y + 3f);
                Theme.TextTRight(g, share, Mx.Small, FontStyle.Regular, Theme.Muted, listRight, y + 3f);
                y += RowH + RowGap;
            }
        }

        private string WindowPhrase(string prefix)
        {
            if (Snap.Window.AllTime) return prefix + ".";
            if (Snap.Window.Days == 1) return prefix + " in the last 24 hours.";
            return prefix + " in the last " + Snap.Window.Days + " days.";
        }

        private void DrawSourceStatus(Graphics g)
        {
            RectangleF card = ovStatusCard.Width > 0f ? ovStatusCard : ovStatus;
            bool isRouter = Snap.Source == "router";
            bool online = Snap.Status == "live";
            string title = isRouter ? "Router health" : "DeepSeek API";
            string badge = Theme.StatusText(Snap.Status, isRouter);
            bool bad = isRouter && !online;

            Theme.Text(g, title, Mx.CardTitle, FontStyle.Regular, Theme.Fg, card.X + Mx.CardPad, card.Y + Mx.CardPad);
            float titleWidth = Theme.Measure(g, title, Mx.CardTitle, FontStyle.Regular);
            float badgeX = card.X + Mx.CardPad + titleWidth + 8f;
            float badgeW = Cards.BadgeWidth(g, badge, bad ? "circle-alert" : "circle-check");
            Cards.Badge(g, badgeX, card.Y + Mx.CardPad, badge, bad ? BadgeKind.Destructive : BadgeKind.Secondary,
                bad ? "circle-alert" : "circle-check", bad ? Theme.Destructive : Theme.Emerald);

            string description = isRouter
                ? (string.IsNullOrEmpty(Snap.StatusDetail) ? "Codex Router on 127.0.0.1:4202." : Snap.StatusDetail)
                : "Native DeepSeek API requests, synced from the active Codex profile.";
            Theme.Text(g, Theme.Fit(g, description, Mx.Body, FontStyle.Regular, card.Width - Mx.CardPad * 2f),
                Mx.Body, FontStyle.Regular, Theme.Muted, card.X + Mx.CardPad, card.Y + 44f);
            Cards.Line(g, card.X, card.Y + 81f, card.Width, Theme.Border);

            float y = card.Y + 95f;
            for (int i = 0; i < ovStatusRows; i++)
            {
                ProviderRow provider = Snap.WindowProviders[i];
                Theme.Text(g, Theme.Fit(g, provider.Provider, Mx.Body, FontStyle.Regular, card.Width - 140f), Mx.Body,
                    FontStyle.Regular, Theme.Fg, card.X + Mx.CardPad, y);
                Theme.Text(g, Fmt.Int(provider.Requests) + " requests \u00b7 " +
                    provider.ErrorRate.ToString("0.0", Inv) + "% failed", Mx.Small, FontStyle.Regular, Theme.Muted,
                    card.X + Mx.CardPad, y + 19f);

                string tokens = provider.Tokens >= 1000000
                    ? (provider.Tokens / 1000000.0).ToString("0.0", Inv) + "M"
                    : (provider.Tokens / 1000.0).ToString("0.0", Inv) + "K";
                float width = Cards.BadgeWidth(g, tokens, null);
                Cards.Badge(g, card.Right - Mx.CardPad - width, y + 2f, tokens, BadgeKind.Outline);
                y += 44f;
            }
            if (ovStatusRows == 0)
            {
                Theme.Text(g, "No provider usage in this window.", Mx.Body, FontStyle.Regular, Theme.Muted,
                    card.X + Mx.CardPad, y);
            }

            float footerY = card.Bottom - 45f;
            Cards.Line(g, card.X, footerY, card.Width, Theme.Border);
            Theme.Text(g, Snap.TotalsAll.Models + " models \u00b7 " + Snap.TotalsAll.Providers + " providers", Mx.Small,
                FontStyle.Regular, Theme.Muted, card.X + Mx.CardPad,
                Theme.CenterY(g, footerY, card.Bottom, Mx.Small, FontStyle.Regular));

            float jsonWidth = Cards.ButtonWidth(g, "JSON", "refresh");
            RectangleF json = new RectangleF(card.Right - Mx.CardPad - jsonWidth, footerY + 8f, jsonWidth, Mx.BtnSmH);
            Cards.Button(g, json, "JSON", BtnKind.Ghost, "refresh", hover == "json:" + Snap.Source);
            Hit("json:" + Snap.Source, json);
        }

        private void DrawTopModels(Graphics g)
        {
            RectangleF card = ovTopModels;
            Cards.Header(g, card, "Top models",
                Snap.Window.AllTime ? "Busiest models by request count."
                    : (Snap.Window.Days == 1 ? "Busiest models by request count in the last 24 hours."
                        : "Busiest models by request count in the last " + Snap.Window.Days + " days."), false);

            List<ModelRow> models = new List<ModelRow>(Snap.WindowModels);
            if (models.Count == 0)
            {
                Theme.Text(g, "No model usage in this window.", Mx.Body, FontStyle.Regular, Theme.Muted,
                    card.X + Mx.CardPad, card.Y + 95f);
                return;
            }
            if (models.Count > 6)
            {
                models.RemoveRange(6, models.Count - 6);
            }
            double max = 1;
            for (int i = 0; i < models.Count; i++)
            {
                if (models[i].Requests > max) max = models[i].Requests;
            }

            float y = card.Y + 79f + Mx.CardPad;
            for (int i = 0; i < models.Count; i++)
            {
                ModelRow model = models[i];
                string meta = Fmt.Int(model.Requests) + " req \u00b7 " + Theme.Compact(model.Tokens) + " tok";
                float metaWidth = Theme.Measure(g, meta, Mx.Small, FontStyle.Regular);
                float metaX = card.Right - Mx.CardPad - metaWidth;

                if (model.ErrorRate > 0)
                {
                    string error = model.ErrorRate.ToString("0.0", Inv) + "% failed";
                    float errorWidth = Cards.BadgeWidth(g, error, null);
                    Cards.Badge(g, metaX - 8f - errorWidth, y - 2f, error, BadgeKind.Outline);
                    metaX = metaX - 8f - errorWidth - 8f;
                }
                Theme.Text(g, Theme.Fit(g, Fmt.Model(model.Model), Mx.Body, FontStyle.Regular, metaX - card.X - Mx.CardPad - 8f),
                    Mx.Body, FontStyle.Regular, Theme.Fg, card.X + Mx.CardPad, y);
                Theme.TextRight(g, meta, Mx.Small, FontStyle.Regular, Theme.Muted, card.Right - Mx.CardPad, y + 1f);

                RectangleF track = new RectangleF(card.X + Mx.CardPad, y + 22f, card.Width - Mx.CardPad * 2f, 6f);
                Theme.Fill(g, track, 3f, Theme.Secondary);
                float filled = (float)(model.Requests / max) * track.Width;
                if (filled > 0.5f)
                {
                    Theme.Fill(g, new RectangleF(track.X, track.Y, Math.Max(3f, filled), track.Height), 3f, Theme.Primary);
                }
                y += 50f;
            }
        }

        private void DrawActivity(Graphics g)
        {
            RectangleF card = ovActivity;
            Cards.Header(g, card, "Activity",
                Snap.Source == "router" ? "Newest calls in the Codex Router log." : "Newest calls through the native DeepSeek API.",
                true);

            int rows = Math.Min(Snap.Recent.Count, 6);
            if (rows == 0)
            {
                Theme.Text(g, "No requests recorded yet.", Mx.Body, FontStyle.Regular, Theme.Muted,
                    card.X + Mx.CardPad, card.Y + 95f);
                return;
            }
            float y = card.Y + 79f;
            for (int i = 0; i < rows; i++)
            {
                RecentRow row = Snap.Recent[i];
                if (i > 0)
                {
                    Cards.Line(g, card.X, y, card.Width, Theme.Border);
                }
                // The web wraps the icon in a size-10 flex box; the glyph inside
                // is size-4, centred, with no background of its own.
                RectangleF chip = new RectangleF(card.X + Mx.CardPad, y + 12f, 40f, 40f);
                string glyph = !row.HasStatus ? "circle-check" : (row.Status >= 200 && row.Status < 300 ? "circle-check"
                    : (row.Status == 0 ? "circle-slash" : "circle-alert"));
                Color color = !row.HasStatus || (row.Status >= 200 && row.Status < 300) ? Theme.Fg
                    : (row.Status == 0 ? Theme.Muted : Theme.Fg);
                Glyph.Draw(g, glyph, new RectangleF(chip.X + 12f, chip.Y + 12f, 16f, 16f), color, 1.6f);

                Theme.Text(g, Theme.Fit(g, Fmt.Model(row.Model), Mx.Body, FontStyle.Regular, card.Width - 80f), Mx.Body,
                    FontStyle.Regular, Theme.Fg, chip.Right + Mx.CardPad, y + 16f);
                string meta = (row.HasTime ? Theme.RelativeTime(row.At, DateTime.Now) : "\u2014") + " \u00b7 " +
                    row.Provider + " \u00b7 " + Theme.Compact(row.Tokens) + " tokens";
                Theme.Text(g, Theme.Fit(g, meta, Mx.Small, FontStyle.Regular, card.Width - 80f), Mx.Small,
                    FontStyle.Regular, Theme.Muted, chip.Right + Mx.CardPad, y + 36f);
                y += 64f;
            }
        }

        private void DrawUsageInsights(Graphics g)
        {
            RectangleF card = ovInsights;
            Cards.Header(g, card, "Usage insights", "When you code, over " + PeriodPhrase() + ".", true);

            Insights insights = Snap.Insights;
            float gridTop = card.Y + 95f;
            float inner = card.Width - Mx.CardPad * 2f;
            float cell = (inner - 3f) / 4f;
            string[] labels = new string[] { "Peak hour", "Current streak", "Active days", "Busiest day" };
            string[] glyphs = new string[] { "clock", "flame", "calendar", "zap" };
            string[] values = new string[]
            {
                insights.HasPeakHour && insights.PeakHour >= 0 ? Fmt.Hour12(insights.PeakHour) : "\u2014",
                Fmt.Int(insights.CurrentStreak) + "d",
                Fmt.Int(insights.ActiveDays),
                string.IsNullOrEmpty(insights.BusiestDay) ? "\u2014" : Fmt.DayMonth(insights.BusiestDay)
            };
            string[] hints = new string[]
            {
                insights.HasPeakHour && insights.PeakHour >= 0 ? Fmt.Int(insights.PeakHourRequests) + " requests" : "No requests in range",
                Fmt.Int(insights.LongestStreak) + "d longest",
                "of " + Fmt.Int(Snap.Daily.Count) + " in range",
                Fmt.Int(insights.BusiestDayRequests) + " requests"
            };

            for (int i = 0; i < 4; i++)
            {
                RectangleF box = new RectangleF(card.X + Mx.CardPad + i * (cell + 1f), gridTop, cell, 78f);
                if (i > 0)
                {
                    Cards.VLine(g, box.X - 0.5f, box.Y, box.Height, Theme.Border);
                }
                Glyph.Draw(g, glyphs[i], new RectangleF(box.X + 12f, box.Y + 12f, 13f, 13f), Theme.Muted, 1.5f);
                Theme.Text(g, labels[i], Mx.Small, FontStyle.Regular, Theme.Muted, box.X + 30f, box.Y + 12f);
                Theme.Text(g, values[i], 18f, FontStyle.Bold, Theme.Fg, box.X + 12f, box.Y + 32f);
                Theme.Text(g, hints[i], Mx.Small, FontStyle.Regular, Theme.Muted, box.X + 12f, box.Y + 56f);
            }

            // Requests by hour.
            float hourY = gridTop + 78f + 24f;
            Theme.Text(g, "Requests by hour", Mx.Body, FontStyle.Regular, Theme.Fg, card.X + Mx.CardPad, hourY);
            string peak = insights.HasPeakHour && insights.PeakHour >= 0 ? Fmt.Hour12(insights.PeakHour) : "\u2014";
            Theme.TextRight(g, "Local time \u00b7 peak " + peak, Mx.Small, FontStyle.Regular, Theme.Muted,
                card.Right - Mx.CardPad, hourY + 2f);

            float barsTop = hourY + 24f;
            float barsH = 96f;
            int hours = insights.Hourly.Count > 0 ? insights.Hourly.Count : 24;
            double maxHour = 1;
            for (int i = 0; i < insights.Hourly.Count; i++)
            {
                if (insights.Hourly[i].Requests > maxHour) maxHour = insights.Hourly[i].Requests;
            }
            float slot = (card.Width - Mx.CardPad * 2f) / hours;
            for (int i = 0; i < hours; i++)
            {
                double value = i < insights.Hourly.Count ? insights.Hourly[i].Requests : 0;
                float height = (float)Math.Max(3.0, value / maxHour * barsH);
                float x = card.X + Mx.CardPad + slot * i;
                Theme.Fill(g, new RectangleF(x + 1f, barsTop + barsH - height, Math.Max(2f, slot - 2f), height),
                    2f, Theme.Alpha(Theme.Chart1, 180));
            }
            float axisY = barsTop + barsH + 6f;
            string[] axis = new string[] { "12 AM", "6 AM", "12 PM", "6 PM", "11 PM" };
            for (int i = 0; i < axis.Length; i++)
            {
                float x = card.X + Mx.CardPad + (card.Width - Mx.CardPad * 2f) * i / (axis.Length - 1f);
                if (i == 0) Theme.Text(g, axis[i], Mx.Small, FontStyle.Regular, Theme.Muted, x, axisY);
                else if (i == axis.Length - 1) Theme.TextRight(g, axis[i], Mx.Small, FontStyle.Regular, Theme.Muted, x, axisY);
                else Theme.TextCenter(g, axis[i], Mx.Small, FontStyle.Regular, Theme.Muted, x, axisY);
            }

            // Daily activity heat strip.
            float heatY = axisY + 30f;
            Theme.Text(g, "Daily activity", Mx.Body, FontStyle.Regular, Theme.Fg, card.X + Mx.CardPad, heatY);
            string less = "Less";
            float legendRight = card.Right - Mx.CardPad;
            for (int level = 4; level >= 0; level--)
            {
                Theme.Fill(g, new RectangleF(legendRight - 12f, heatY + 4f, 10f, 10f), 2f, LevelColor(level));
                legendRight -= 14f;
            }
            Theme.TextRight(g, less, Mx.Small, FontStyle.Regular, Theme.Muted, legendRight, heatY + 3f);
            string more = "More";
            Theme.TextRight(g, more, Mx.Small, FontStyle.Regular, Theme.Muted, card.Right - Mx.CardPad - 5 * 14f - 4f, heatY + 3f);

            float cellSize = 16f;
            float cellX = card.X + Mx.CardPad;
            float cellY = heatY + 24f;
            float maxX = card.Right - Mx.CardPad - cellSize;
            for (int i = 0; i < insights.Activity.Count; i++)
            {
                if (cellX > maxX)
                {
                    cellX = card.X + Mx.CardPad;
                    cellY += cellSize + 4f;
                }
                Theme.Fill(g, new RectangleF(cellX, cellY, cellSize, cellSize), 2f, LevelColor(insights.Activity[i].Level));
                cellX += cellSize + 4f;
            }
        }

        private Color LevelColor(int level)
        {
            switch (level)
            {
                case 1: return Theme.Alpha(Theme.Chart1, 51);
                case 2: return Theme.Alpha(Theme.Chart1, 102);
                case 3: return Theme.Alpha(Theme.Chart1, 178);
                case 4: return Theme.Chart1;
                default: return Theme.Secondary;
            }
        }

        private string PeriodPhrase()
        {
            if (Snap.Window.AllTime) return "all time";
            if (Snap.Window.Days == 1) return "the last 24 hours";
            return "the last " + Snap.Window.Days + " days";
        }
    }
}
