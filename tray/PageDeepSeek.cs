using System;
using System.Collections.Generic;
using System.Drawing;
using System.Globalization;

namespace RouterMonitorTray
{
    /// <summary>The DeepSeek page: account health, balance, the combined daily
    /// chart, the native model table and the recent request log.</summary>
    internal sealed partial class PanelView
    {
        // Measured on the live page: the scope banner is 160 tall, the
        // account/spend row 409, and the chart/models row 471.
        private const float DsScopeH = 160f;
        private const float DsSpendH = 409f;
        private const float DsChartH = 471f;

        private RectangleF dsStats;
        private RectangleF dsScope;
        private RectangleF dsAccount;
        private RectangleF dsBalance;
        private RectangleF dsChart;
        private RectangleF dsModels;
        private RectangleF dsRecent;

        private void LayoutDeepSeek()
        {
            // The grid container's p-px pushes the first row one pixel in on both
            // axes, so cards start at x=281 y=149 like the browser's.
            float y = Mx.PagePad + Mx.PageHeaderH + Mx.CardGap + 1f;
            float gridX = PageX + 1f;
            float gridW = PageW - 2f;
            float col2 = (float)Math.Ceiling((gridW - 1f) / 2f);
            float col2b = gridW - 1f - col2;

            dsStats = new RectangleF(gridX, y, gridW, Mx.StatH);
            y += Mx.StatH + 1f;

            // The scope banner spans the grid and explains which upstream served
            // each native api.deepseek.com request.
            float scopeH = Snap != null && Snap.Upstream != null && Snap.Upstream.Total > 0 ? DsScopeH : 0f;
            dsScope = new RectangleF(gridX, y, gridW, scopeH);
            if (scopeH > 0f)
            {
                y += scopeH + 1f;
            }

            // Both cards stretch to the taller row, as the browser's grid does.
            dsAccount = new RectangleF(gridX, y, col2, DsSpendH);
            dsBalance = new RectangleF(gridX + col2 + 1f, y, col2b, DsSpendH);
            y += DsSpendH + 1f;

            dsChart = new RectangleF(gridX, y, col2, DsChartH);
            dsModels = new RectangleF(gridX + col2 + 1f, y, col2b, DsChartH);
            y += DsChartH + 1f;

            int rows = Snap == null ? 0 : Math.Min(Snap.Recent.Count, 50);
            float recentH = LogTableTop + Math.Max(1, Math.Min(rows, 20)) * Mx.RowH + PagerH + Mx.CardPad;
            dsRecent = new RectangleF(gridX, y, gridW, recentH);
            y += recentH;

            contentHeight = y + Mx.PagePad;
        }

        private void DrawDeepSeekPage(Graphics g)
        {
            PageHeader(g, "DeepSeek", "Native DeepSeek API account health, balance, and router usage.", false, true);

            GridRow(g, dsStats, 4);
            DrawDeepSeekStats(g);

            if (dsScope.Height > 0f)
            {
                GridOutline(g, dsScope);
                DrawScopeBanner(g);
            }

            GridPair(g, dsAccount, dsBalance);
            DrawAccountCard(g);
            DrawBalanceCard(g);

            GridPair(g, dsChart, dsModels);
            DrawDeepSeekChart(g);
            DrawDeepSeekModels(g);

            GridOutline(g, dsRecent);
            DrawDeepSeekRecent(g);
        }

/// <summary>
        /// The scope banner: a badge, the request counts, a stacked bar of which
        /// upstream served them, the segment legend and the detail sentence.
        /// </summary>
        private void DrawScopeBanner(Graphics g)
        {
            // Measured on the live banner: CardContent is px-6 py-4, so the first
            // row sits 32px below the card top; the bar is 32px under it, the
            // legend 20px under that and the detail 28px under that.
            RectangleF card = dsScope;
            UpstreamInfo up = Snap.Upstream;
            float contentTop = card.Y + 16f;
            float left = card.X + 24f;
            string[] labels = new string[]
            {
                "Codex \u2192 api.deepseek.com", "harness \u2192 api.deepseek.com",
                "Codex \u2192 router \u2192 DeepSeek", "router \u2192 Command Code",
                "other host", "unclassified"
            };
            double[] values = new double[]
            {
                up.NativeDirect, up.Harness, up.NativeViaRouter,
                up.CommandCode, up.OtherUpstream, up.Unclassified
            };
            Color[] colors = new Color[]
            {
                Theme.Emerald, Theme.Alpha(Theme.Emerald, 200), Theme.Alpha(Theme.Emerald, 128),
                Theme.Amber, Theme.Alpha(Theme.Muted, 128), Theme.Alpha(Theme.Muted, 64)
            };

            // Row 1: the outline Badge, then the counts centred against its 20px
            // height. The badge's own padding is what sets where the counts start.
            float rowY = contentTop + 16f;
            float badgeW = Cards.BadgeWidth(g, up.Label, null);
            Cards.Badge(g, left, rowY, up.Label, BadgeKind.Outline);
            string counts = Fmt.Int(up.Included) + " native requests \u00b7 " +
                Fmt.Int(up.NativeDirect + up.NativeViaRouter) + " from the Codex log + " +
                Fmt.Int(up.Harness) + " from the harness";
            Theme.TextT(g, counts, Mx.Small, FontStyle.Regular, Theme.Muted, left + badgeW + 8f,
                rowY + 2f);

            float barY = contentTop + 48f;
            RectangleF track = new RectangleF(left, barY, card.Width - 48f, 8f);
            Theme.Fill(g, track, 4f, Theme.Secondary);
            float cursor = track.X;
            for (int i = 0; i < values.Length; i++)
            {
                if (values[i] <= 0) continue;
                float segment = (float)(values[i] / up.Total) * track.Width;
                Theme.FillRect(g, new RectangleF(cursor, track.Y, segment, track.Height), colors[i]);
                cursor += segment;
            }

            float legendY = contentTop + 68f;
            float x = left;
            for (int i = 0; i < values.Length; i++)
            {
                if (values[i] <= 0) continue;
                float labelW = Theme.Measure(g, labels[i], Mx.Small, FontStyle.Regular);
                string count = Fmt.Int(values[i]);
                float countW = Theme.MeasureT(g, count, Mx.Small, FontStyle.Regular);
                float entryW = 8f + 6f + labelW + 6f + countW;
                if (x > left && x + entryW > card.Right - 24f)
                {
                    x = left;
                    legendY += 18f;
                }
                Theme.Fill(g, new RectangleF(x, legendY + 3f, 8f, 8f), 4f, colors[i]);
                Theme.Text(g, labels[i], Mx.Small, FontStyle.Regular, Theme.Muted, x + 14f, legendY);
                Theme.TextT(g, count, Mx.Small, FontStyle.Regular, Theme.Fg, x + 14f + labelW + 6f, legendY);
                x += entryW + 16f;
            }

            if (up.Detail.Length > 0)
            {
                Theme.Text(g, Theme.Fit(g, up.Detail, Mx.Small, FontStyle.Regular, card.Width - 48f),
                    Mx.Small, FontStyle.Regular, Theme.Muted, left, contentTop + 96f);
            }
        }

        private void DrawDeepSeekStats(Graphics g)
        {
            Totals window = Snap.Window;
            float cell = (dsStats.Width - 3f) / 4f;
            string period = PeriodLabel();

            string latency = window.AvgMs > 0 ? Fmt.Int(window.AvgMs) + " ms" : "\u2014";
            string latencyFooter = window.AvgFirstTokenMs > 0
                ? "first token " + Fmt.Int(window.AvgFirstTokenMs) + " ms"
                : "latency not available in session log";

            RectangleF[] cells = new RectangleF[4];
            for (int i = 0; i < 4; i++)
            {
                cells[i] = new RectangleF(dsStats.X + i * (cell + 1f), dsStats.Y, cell, dsStats.Height);
            }
            Widgets.StatCard(g, cells[0], "Requests", Fmt.Int(window.Requests), window.DeltaRequests, period,
                DailySeries("requests"));
            Widgets.StatCard(g, cells[1], "Tokens", Theme.Compact(window.Tokens), window.DeltaTokens, period,
                DailySeries("tokens"));
            Widgets.StatCard(g, cells[2], "Success rate", window.SuccessRate.ToString("0.0", Inv) + "%",
                window.DeltaSuccessRatePp, Fmt.Int(Snap.TotalsAll.Failed) + " failed all-time", DailySeries("success"));
            Widgets.StatCard(g, cells[3], "Avg latency", latency, window.DeltaLatency, latencyFooter,
                DailySeries("latency"));
        }

        private string CredentialLabel()
        {
            AccountInfo account = Snap.Account;
            if (account == null)
            {
                return "not configured";
            }
            if (account.KeySource == "env") return "DEEPSEEK_API_KEY (environment)";
            if (account.KeySource == "file") return "~/.codex/codex-router/deepseek-api-key.secret";
            return "not configured";
        }

        private void DrawAccountCard(Graphics g)
        {
            RectangleF card = dsAccount;
            AccountInfo account = Snap.Account;
            if (account == null)
            {
                account = new AccountInfo();
            }

            // Cards.Header draws the title and description and returns where
            // CardContent starts, which is what the rows below hinge on. This card
            // overrides the title to a bare text-base, so it is 81 not 79.
            float contentTop = Cards.Header(g, card, "DeepSeek API account",
                "Official DeepSeek API at api.deepseek.com, checked through /user/balance.",
                true, Mx.TitleLineBase);
            float titleWidth = Theme.MeasureW(g, "DeepSeek API account", Mx.CardTitle, 500);
            string badge;
            BadgeKind kind;
            string glyph;
            Color glyphColor = Theme.Fg;
            if (!account.Configured)
            {
                badge = "not configured";
                kind = BadgeKind.Outline;
                glyph = "circle-alert";
            }
            else if (!account.Online || !account.Available)
            {
                badge = account.Online ? "unavailable" : "unreachable";
                kind = BadgeKind.Destructive;
                glyph = "circle-alert";
                glyphColor = Theme.Destructive;
            }
            else
            {
                badge = "available";
                kind = BadgeKind.Secondary;
                glyph = "circle-check";
                glyphColor = Theme.Emerald;
            }
            Cards.Badge(g, card.X + Mx.CardPad + titleWidth + 8f, card.Y + Mx.CardPad, badge, kind, glyph, glyphColor);

            // CardContent is px-6 py-4, so the rows start 16 under the header.
            float y = contentTop + 16f;
            AccountRow(g, card, y, "Credential", CredentialLabel(), false);
            y += 32f;
            AccountRow(g, card, y, "Account available", account.Available ? "Yes" : "No", false);
            y += 32f;
            AccountRow(g, card, y, "Balance check", account.Online ? Fmt.Int(account.LatencyMs) + " ms" : "\u2014", false);
            y += 32f;
            AccountRow(g, card, y, "Checked at",
                account.HasCheckedAt ? Fmt.AccountTime(account.CheckedAt) : "\u2014", false);
            // The footer follows the content rather than the card's bottom edge:
            // the grid stretches this card to its row, and the browser leaves the
            // leftover 119px blank below the footer. Measured: footer 693..754 for
            // a card at 464 (card.Y + 229), i.e. 16px under the last row.
            float footerY = card.Y + 229f;
            float footerBottom = footerY + Cards.FooterWithButton;
            Cards.Line(g, card.X, footerY, card.Width, Theme.Border);
            Theme.Text(g, "Source: DeepSeek API \u00b7 native api.deepseek.com", Mx.Small, FontStyle.Regular, Theme.Muted,
                card.X + Mx.CardPad, Theme.CenterY(g, footerY, footerBottom, Mx.Small, FontStyle.Regular));

            float platformWidth = Cards.ButtonWidth(g, "Platform", "external-link");
            RectangleF platform = new RectangleF(card.Right - Mx.CardPad - platformWidth, footerY + 8f, platformWidth, Mx.BtnSmH);
            Cards.Button(g, platform, "Platform", BtnKind.Ghost, "external-link", hover == "platform");
            Hit("url:https://platform.deepseek.com/usage", platform);
        }

        private void AccountRow(Graphics g, RectangleF card, float y, string label, string value, bool bold)
        {
            Theme.Text(g, label, Mx.Body, FontStyle.Regular, Theme.Muted, card.X + Mx.CardPad, y);
            float maxWidth = card.Width - Mx.CardPad * 2f - 140f;
            Theme.TextRight(g, Theme.Fit(g, value, Mx.Body, FontStyle.Regular, maxWidth), Mx.Body, FontStyle.Regular,
                Theme.Fg, card.Right - Mx.CardPad, y);
        }
        /// <summary>
        /// <summary>
        /// Balance and spend: the remaining balance next to what the native
        /// DeepSeek API cost, estimated in CNY from the token counts.
        /// </summary>
        private void DrawBalanceCard(Graphics g)
        {
            RectangleF card = dsBalance;
            AccountInfo account = Snap.Account;
            List<BalanceRow> balances = account == null ? new List<BalanceRow>() : account.Balances;
            Totals window = Snap.Window;
            Totals all = Snap.TotalsAll;
            double windowCost = window.HasCostCny ? window.CostCny : 0;
            double allCost = all.HasCostCny ? all.CostCny : 0;
            double perRequest = window.Requests > 0 ? windowCost / window.Requests : 0;
            double perMillion = window.Tokens > 0 ? windowCost / window.Tokens * 1000000.0 : 0;

            // Cards.Header wraps the description the way the browser does (three
            // lines here, which is what makes this header 121 tall rather than 65)
            // and returns where CardContent starts.
            float contentTop = Cards.Header(g, card, "Balance and spend",
                "Remaining balance from /user/balance next to what the native DeepSeek API cost. "
                    + "The API has no usage endpoint, so spend is estimated from the token counts at "
                    + "DeepSeek's official CNY prices (peak and off-peak), updated 2026-09-11.",
                true, Mx.TitleLineBase);
            float titleWidth = Theme.MeasureW(g, "Balance and spend", Mx.CardTitle, 500);
            string countLabel = balances.Count + (balances.Count == 1 ? " currency" : " currencies");
            float badgeW = Cards.BadgeWidth(g, countLabel, null);
            Cards.Badge(g, card.X + Mx.CardPad + titleWidth + 8f, card.Y + Mx.CardPad, countLabel, BadgeKind.Secondary);
            Cards.Badge(g, card.X + Mx.CardPad + titleWidth + 8f + badgeW + 8f, card.Y + Mx.CardPad,
                PeriodLabel(), BadgeKind.Outline);

            if (balances.Count == 0)
            {
                Theme.Text(g, Theme.Fit(g, "No balance data. " + (account != null ? account.Error : ""), Mx.Body,
                    FontStyle.Regular, card.Width - Mx.CardPad * 2f), Mx.Body, FontStyle.Regular, Theme.Muted,
                    card.X + Mx.CardPad, card.Y + 95f);
            }
            else
            {
                BalanceRow balance = balances[0];
                // Measured on the live card: the bordered box is inset 24px, starts
                // 137px below the card top and is 195 tall. Inside, the two columns
                // are a gap-3 grid (so each is (w-44)/2 wide), the stat pairs sit on
                // a 44px pitch, and the summary paragraph's own border-t + pt-3 puts
                // a rule 137px down with its text 12px under it.
                RectangleF box = new RectangleF(card.X + 24f, card.Y + 137f,
                    card.Width - 48f, 195f);
                Theme.Stroke(g, box, 8f, Theme.Border, 1f);
                Theme.Text(g, "Remaining", Mx.Body, FontStyle.Regular, Theme.Muted, box.X + 17f, box.Y + 27f);
                Theme.TextRightW(g, Fmt.Money(balance.Currency, balance.Total), 24f, 600, Theme.Fg,
                    box.Right - 16f, box.Y + 17f);

                float half = (box.Width - 44f) / 2f + 12f;
                string[] labels = new string[]
                {
                    "Granted", "Topped up",
                    "Spent " + PeriodLabel().ToLowerInvariant() + " (est.)", "Spent all-time (est.)"
                };
                string[] values = new string[]
                {
                    Fmt.Money(balance.Currency, balance.Granted),
                    Fmt.Money(balance.Currency, balance.ToppedUp),
                    Fmt.Money("CNY", windowCost),
                    Fmt.Money("CNY", allCost)
                };
                for (int i = 0; i < 4; i++)
                {
                    float cx = box.X + 17f + (i % 2) * half;
                    float cy = box.Y + 61f + (i / 2) * 44f;
                    Theme.Text(g, labels[i], Mx.Small, FontStyle.Regular, Theme.Muted, cx, cy);
                    Theme.TextW(g, values[i], Mx.Body, 500, Theme.Fg, cx, cy + 17f);
                }

                // The summary paragraph carries mt-3 border-t pt-3: measured on the
                // live card its border sits at box.Y+149 and its single line of
                // text 14px under that. It fits on one line, but wrap anyway so a
                // longer request count does not clip.
                float ruleY = box.Y + 149f;
                Cards.Line(g, box.X, ruleY, box.Width, Theme.Border);
                List<string> summary = Theme.Wrap(g, Fmt.Int(window.Requests) + " requests \u00b7 " +
                    Fmt.Money("CNY", perRequest) + " per request \u00b7 " + Fmt.Money("CNY", perMillion) +
                    " per 1M tokens", Mx.Small, FontStyle.Regular, box.Width - 32f, 2);
                for (int i = 0; i < summary.Count; i++)
                {
                    Theme.TextT(g, summary[i], Mx.Small, FontStyle.Regular, Theme.Muted,
                        box.X + 17f, ruleY + 14f + i * 17f);
                }
            }

            // This footer holds a JSON button, so it is 61 tall and pinned to the
            // card's bottom edge: measured rule at 812 for a card ending at 873.
            float footerY = card.Bottom - Cards.FooterWithButton;
            Cards.TileFooter(g, card, footerY);
            string checkedAt = "Checked " + (account != null && account.HasCheckedAt
                ? Fmt.AccountTime(account.CheckedAt) : "\u2014") + " \u00b7 spend est. from ";
            Theme.Text(g, checkedAt, Mx.Small, FontStyle.Regular, Theme.Muted, card.X + Mx.CardPad,
                Theme.CenterY(g, footerY, card.Bottom, Mx.Small, FontStyle.Regular));
            float linkX = card.X + Mx.CardPad + Theme.Measure(g, checkedAt, Mx.Small, FontStyle.Regular);
            float linkY = Theme.CenterY(g, footerY, card.Bottom, Mx.Small, FontStyle.Regular);
            RectangleF link = new RectangleF(linkX, linkY,
                Theme.Measure(g, "DeepSeek CNY pricing", Mx.Small, FontStyle.Regular), 16f);
            Theme.TextT(g, "DeepSeek CNY pricing", Mx.Small, FontStyle.Regular, Theme.Fg, linkX, linkY);
            Hit("url:https://api-docs.deepseek.com/quick_start/pricing", link);

            float jsonWidth = Cards.ButtonWidth(g, "JSON", "refresh");
            RectangleF json = new RectangleF(card.Right - Mx.CardPad - jsonWidth, footerY + 8f, jsonWidth, Mx.BtnSmH);
            Cards.Button(g, json, "JSON", BtnKind.Ghost, "refresh", hover == "json:deepseek");
            Hit("json:deepseek", json);
        }
        private void DrawDeepSeekChart(Graphics g)
        {
            RectangleF card = dsChart;
            Theme.Text(g, "Requests and tokens per day", Mx.CardTitle, FontStyle.Regular, Theme.Fg,
                card.X + Mx.CardPad, card.Y + 16f);
            Theme.Text(g, Theme.Fit(g, "DeepSeek native API usage, " + PeriodLabel() +
                    ". Bars are requests; the line is tokens.", Mx.Body, FontStyle.Regular, card.Width - Mx.CardPad * 2f),
                Mx.Body, FontStyle.Regular, Theme.Muted, card.X + Mx.CardPad, card.Y + 42f);
            Cards.Line(g, card.X, card.Y + 79f, card.Width, Theme.Border);

            // Measured on the live card: its DashboardCard header is 29px deeper
            // than the Overview trend cards'.
            RectangleF plot = Widgets.TrendPlot(card, 29f);
            if (Snap.Daily.Count == 0)
            {
                Theme.Text(g, "No DeepSeek usage in this range.", Mx.Body, FontStyle.Regular, Theme.Muted,
                    plot.X, plot.Y + 20f);
                return;
            }
            Widgets.CombinedChart(g, plot, card, Snap.Daily, -1);
        }

        private void DrawDeepSeekModels(Graphics g)
        {
            RectangleF card = dsModels;
            List<ModelRow> models = SortedModels(Snap.WindowModels);
            Theme.Text(g, "Models", Mx.CardTitle, FontStyle.Regular, Theme.Fg, card.X + Mx.CardPad, card.Y + 16f);
            float titleWidth = Theme.Measure(g, "Models", Mx.CardTitle, FontStyle.Regular);
            Cards.Badge(g, card.X + Mx.CardPad + titleWidth + 8f, card.Y + Mx.CardPad, models.Count + " routes",
                BadgeKind.Secondary);
            Theme.Text(g, Theme.Fit(g, "DeepSeek models with usage in " + PeriodLabel() + ".", Mx.Body,
                    FontStyle.Regular, card.Width - Mx.CardPad * 2f), Mx.Body, FontStyle.Regular,
                Theme.Muted, card.X + Mx.CardPad, card.Y + 42f);
            Cards.Line(g, card.X, card.Y + 79f, card.Width, Theme.Border);

            RectangleF table = new RectangleF(card.X, card.Y + 79f, card.Width, card.Height - 76f - 16f);
            if (models.Count == 0)
            {
                Cards.Empty(g, table, "cpu", "No DeepSeek usage", "No DeepSeek calls were recorded in this range.");
                return;
            }
            // The reference's DeepSeek Models table shows the API column too.
            Widgets.ModelUsageTable(g, table, models, true, Hit, hover, "row:ds:");
        }

        private List<ModelRow> SortedModels(List<ModelRow> source)
        {
            List<ModelRow> models = new List<ModelRow>(source);
            models.Sort(delegate (ModelRow a, ModelRow b)
            {
                int byTokens = b.Tokens.CompareTo(a.Tokens);
                if (byTokens != 0) return byTokens;
                return b.Requests.CompareTo(a.Requests);
            });
            return models;
        }

        private void DrawDeepSeekRecent(Graphics g)
        {
            RectangleF card = dsRecent;
            Cards.Header(g, card, "Recent requests", "Latest native DeepSeek API calls.", false);
            string rows = Fmt.Int(Snap.Recent.Count) + " rows";
            float rowsWidth = Cards.BadgeWidth(g, rows, null);
            Cards.Badge(g, card.Right - Mx.CardPad - rowsWidth, card.Y + Mx.CardPad, rows, BadgeKind.Secondary);

            float toolbarY = card.Y + 79f;
            Cards.Line(g, card.X, toolbarY + 40f, card.Width, Theme.Border);
            Theme.Text(g, "Click a column header to sort. " + Fmt.Int(Snap.Recent.Count) + " rows available.", Mx.Small,
                FontStyle.Regular, Theme.Muted, card.X + Mx.CardPad,
                Theme.CenterY(g, toolbarY, toolbarY + 40f, Mx.Small, FontStyle.Regular));
            float exportWidth = Cards.ButtonWidth(g, "Export CSV", "download");
            RectangleF export = new RectangleF(card.Right - Mx.CardPad - exportWidth, toolbarY + 6f, exportWidth, Mx.BtnSmH);
            Cards.Button(g, export, "Export CSV", BtnKind.Outline, "download", hover == "export");
            Hit("export", export);

            if (Snap.Recent.Count == 0)
            {
                Cards.Empty(g, new RectangleF(card.X, toolbarY + 41f, card.Width, card.Height - 117f), "activity",
                    "No DeepSeek requests", "No DeepSeek native API calls were recorded in this range.");
                return;
            }

            List<RecentRow> sorted = SortedRecent();
            int pageCount = Math.Max(1, (sorted.Count + RequestsPageSize - 1) / RequestsPageSize);
            if (State.TablePage > pageCount) State.TablePage = pageCount;
            if (State.TablePage < 1) State.TablePage = 1;
            int start = (State.TablePage - 1) * RequestsPageSize;
            int visible = Math.Min(RequestsPageSize, sorted.Count - start);

            RectangleF table = new RectangleF(card.X, toolbarY + 41f, card.Width, Mx.HeadH + visible * Mx.RowH);
            Widgets.RequestsTable(g, table, sorted, start, visible, State.Sort, State.SortAsc, Hit, hover);

            float pagerY = table.Bottom;
            Cards.Line(g, card.X, pagerY, card.Width, Theme.Border);
            Theme.Text(g, Fmt.Int(start + 1) + "\u2013" + Fmt.Int(start + visible) + " of " + Fmt.Int(sorted.Count) + " requests",
                Mx.Small, FontStyle.Regular, Theme.Muted, card.X + Mx.CardPad,
                Theme.CenterY(g, pagerY, card.Bottom, Mx.Small, FontStyle.Regular));

            float right = card.Right - Mx.CardPad;
            string pageLabel = "Page " + State.TablePage + " / " + pageCount;
            float labelWidth = Theme.Measure(g, pageLabel, Mx.Small, FontStyle.Regular);
            Theme.Text(g, pageLabel, Mx.Small, FontStyle.Regular, Theme.Muted, right - labelWidth - 40f,
                Theme.CenterY(g, pagerY, card.Bottom, Mx.Small, FontStyle.Regular));
            RectangleF next = new RectangleF(right - 28f, pagerY + 10f, 28f, Mx.BtnSmH);
            RectangleF prev = new RectangleF(next.X - 34f - labelWidth, pagerY + 10f, 28f, Mx.BtnSmH);
            bool canPrev = State.TablePage > 1;
            bool canNext = State.TablePage < pageCount;
            Cards.Button(g, prev, "", BtnKind.Outline, null, hover == "table:prev");
            Glyph.Draw(g, "chevron-left", new RectangleF(prev.X + 8f, prev.Y + 8f, 12f, 12f), canPrev ? Theme.Fg : Theme.Muted, 1.5f);
            Cards.Button(g, next, "", BtnKind.Outline, null, hover == "table:next");
            Glyph.Draw(g, "chevron-right", new RectangleF(next.X + 8f, next.Y + 8f, 12f, 12f), canNext ? Theme.Fg : Theme.Muted, 1.5f);
            if (canPrev) Hit("table:prev", prev);
            if (canNext) Hit("table:next", next);
        }
    }
}
