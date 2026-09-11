using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Globalization;

namespace RouterMonitorTray
{
    /// <summary>
    /// The web components that more than one page needs: the delta badges, the
    /// stat card, the trend charts and the two data tables.
    /// </summary>
    internal static class Widgets
    {
        private static readonly CultureInfo Inv = CultureInfo.InvariantCulture;

        // -- delta ------------------------------------------------------------
        /// <summary>MetricStatGrid footer delta: chevron + absolute value, no pill.</summary>
        public static float DeltaInline(Graphics g, float x, float y, double value, string suffix)
        {
            string text = Fmt.Delta(value, suffix);
            string glyph = Math.Abs(value) < 0.05 ? "minus" : (value > 0 ? "chevron-up" : "chevron-down");
            Color color = Math.Abs(value) < 0.05 ? Theme.Muted : (value > 0 ? Theme.DeltaUp : Theme.DeltaDown);
            Glyph.Draw(g, glyph, new RectangleF(x, y + 2f, 12f, 12f), color, 1.6f);
            Theme.Text(g, text, Mx.StatFooter, FontStyle.Regular, color, x + 15f, y);
            return 15f + Theme.Measure(g, text, Mx.StatFooter, FontStyle.Regular);
        }

        /// <summary>Card heading delta: the Badge variant with a trending icon.</summary>
        public static float DeltaBadge(Graphics g, float x, float y, double value, string suffix)
        {
            string text = Fmt.Delta(value, suffix);
            bool up = value > 0;
            float textWidth = Theme.Measure(g, text, Mx.Small, FontStyle.Regular);
            float width = textWidth + 32f;
            RectangleF rect = new RectangleF(x, y, width, Mx.BadgeH);
            Theme.Pill(g, rect, up ? Theme.EmeraldSoft : Theme.RedSoft, Color.Empty);
            Color color = up ? Theme.Emerald : Theme.Red;
            Glyph.Draw(g, up ? "trending-up" : "trending-down", new RectangleF(x + 7f, y + 2f, 16f, 16f), color, 1.7f);
            Theme.Text(g, text, Mx.Small, FontStyle.Regular, color, x + 26f,
                Theme.CenterY(g, y, y + Mx.BadgeH, Mx.Small, FontStyle.Regular));
            return width;
        }

        // -- stat card --------------------------------------------------------
        public static void StatCard(Graphics g, RectangleF card, string label, string value, double delta,
            string footer, double[] spark)
        {
            // Measured on the live card: the stat tile is gap-0, so the label sits
            // at +16, the 24/32 value box at +32, the sparkline at +64 and the
            // CardFooter rule at +104.
            Theme.TextW(g, label, Mx.Small, 400, Theme.Fg, card.X + Mx.CardPad, card.Y + 16f);
            // font-semibold text-2xl tabular-nums (Theme.InkShift handles the ink).
            Theme.TextT(g, value, Mx.StatValue, FontStyle.Bold, Theme.Fg, card.X + Mx.CardPad, card.Y + 38f);

            Cards.Sparkline(g, new RectangleF(card.X + Mx.CardPad, card.Y + 68f, card.Width - Mx.CardPad * 2f, Mx.SparkH),
                spark, delta < 0);

            float ruleY = card.Y + 104f;
            Cards.Line(g, card.X, ruleY, card.Width, Theme.Border);

            float footerY = ruleY + 17f;
            float cursor = card.X + Mx.CardPad;
            if (Math.Abs(delta) >= 0.05)
            {
                cursor += DeltaInline(g, cursor, footerY, delta, "%") + 5f;
            }
            Theme.Text(g, Theme.Fit(g, footer, Mx.StatFooter, FontStyle.Regular, card.Right - Mx.CardPad - cursor),
                Mx.StatFooter, FontStyle.Regular, Theme.Muted, cursor, footerY);
        }

        // -- tables -----------------------------------------------------------
        public static float TableHeight(int rows)
        {
            return Mx.HeadH + rows * Mx.RowH;
        }

        /// <summary>
        /// Column widths measured on the live tables at the 1688x935 reference
        /// viewport: the full-width log spans the 1232px grid, and the compact one
        /// in the Overview card grows past its 615px card and is clipped.
        /// </summary>
        public static Cards.Column[] RequestColumns(bool wide)
        {
            if (wide)
            {
                return new Cards.Column[]
                {
                    new Cards.Column("Time", 256f, false, "at"),
                    new Cards.Column("Model", 245f, false, "model"),
                    new Cards.Column("API", 186f, false, "provider"),
                    new Cards.Column("Tokens", 234f, true, "totalTokens"),
                    new Cards.Column("Latency", 142f, true, "durationMs"),
                    new Cards.Column("Status", 169f, true, "status")
                };
            }
            // Measured on the live Overview card (615px wide, table 646 and clipped).
            return new Cards.Column[]
            {
                new Cards.Column("Time", 134f, false, "at"),
                new Cards.Column("Model", 128f, false, "model"),
                new Cards.Column("API", 98f, false, "provider"),
                new Cards.Column("Tokens", 123f, true, "totalTokens"),
                new Cards.Column("Latency", 67f, true, "durationMs"),
                new Cards.Column("Status", 88f, true, "status")
            };
        }

        public static void RequestsTable(Graphics g, RectangleF table, List<RecentRow> rows, int start, int count,
            string sortKey, bool sortAsc, Action<string, RectangleF> hit, string hover)
        {
            RequestColumns(g, table, rows, start, count, sortKey, sortAsc, hit, hover, 0f);
        }

        /// <summary>
        /// The web table sizes its columns to their content; the Overview card is
        /// narrower than that, so the browser clips it through overflow-x-auto.
        /// The tray draws the same fixed columns and clips to the card edge.
        /// </summary>
        public static void RequestColumns(Graphics g, RectangleF table, List<RecentRow> rows, int start, int count,
            string sortKey, bool sortAsc, Action<string, RectangleF> hit, string hover, float inset)
        {
            bool wide = table.Width > 900f;
            Cards.Column[] columns = RequestColumns(wide);
            float[] xs = Cards.FixedLayout(table, columns, inset);

            GraphicsState clip = g.Save();
            g.SetClip(table);

            RectangleF head = new RectangleF(table.X, table.Y, table.Width, Mx.HeadH);
            for (int i = 0; i < columns.Length; i++)
            {
                RectangleF cell = new RectangleF(xs[i], head.Y, columns[i].Width, Mx.HeadH);
                // TableHead px-2, with ps-6 on the first column and pe-6 on the last.
                float padLeft = i == 0 ? 24f : 8f;
                float padRight = i == columns.Length - 1 ? 24f : 8f;
                Cards.Head(g, cell, columns[i], sortKey, sortAsc, hover == "sort:" + columns[i].SortKey,
                    padLeft, padRight);
                if (!string.IsNullOrEmpty(columns[i].SortKey) && hit != null)
                {
                    hit("sort:" + columns[i].SortKey, cell);
                }
            }

            float y = table.Y + Mx.HeadH;
            for (int i = 0; i < count && start + i < rows.Count; i++)
            {
                RecentRow row = rows[start + i];
                RectangleF line = new RectangleF(table.X, y, table.Width, Mx.RowH);
                string key = "row:req:" + (start + i);
                if (hover == key)
                {
                    Theme.FillRect(g, line, Theme.Alpha(Theme.Secondary, 128));
                }
                if (i > 0)
                {
                    Cards.Line(g, table.X, y, table.Width, Theme.Border);
                }
                DrawRequestRow(g, line, row, xs, columns);
                if (hit != null)
                {
                    hit(key, line);
                }
                y += Mx.RowH;
            }
            g.Restore(clip);
        }

        private static void DrawRequestRow(Graphics g, RectangleF line, RecentRow row, float[] xs, Cards.Column[] columns)
        {
            // Measured on both tables: a single-line cell's text ink sits 19px
            // below the cell top (the 8px padding box centres its 20px line), and
            // the Tokens column's first line sits 11px below it because that cell
            // holds two lines. Theme.Text lands its ink 2px into the draw origin.
            float singleY = line.Y + 19f;
            float stackedY = line.Y + 11f;
            float subY = line.Y + 30f;

            Theme.Text(g, row.HasTime ? Fmt.TableTime(row.At) : "\u2014", Mx.Body, FontStyle.Regular, Theme.Muted,
                xs[0] + 24f, singleY);

            // TableCell is whitespace-nowrap: the browser never ellipsises a cell,
            // it lets the text overflow into the scroll container's clip. The
            // caller sets that clip, so no per-cell truncation here.
            Theme.TextW(g, Fmt.Model(row.Model), Mx.Body, 500, Theme.Fg, xs[1] + 8f, singleY);
            Theme.Text(g, row.Provider, Mx.Body, FontStyle.Regular, Theme.Muted, xs[2] + 8f, singleY);

            float tokensRight = xs[3] + columns[3].Width - 8f;
            Theme.TextTRight(g, Theme.Compact(row.Tokens), Mx.Body, FontStyle.Regular, Theme.Fg, tokensRight, stackedY);
            string sub = Fmt.Int(row.InputTokens) + " in \u00b7 " + Fmt.Int(row.OutputTokens) + " out"
                + (row.HasCost && row.Cost > 0 ? " \u00b7 $" + row.Cost.ToString("0.0000", Inv) : "");
            Theme.TextTRight(g, sub, Mx.Small, FontStyle.Regular, Theme.Muted, tokensRight, subY);

            float latencyRight = xs[4] + columns[4].Width - 8f;
            Theme.TextTRight(g, row.DurationMs > 0 ? Fmt.Int(row.DurationMs) + " ms" : "\u2014", Mx.Body,
                FontStyle.Regular, Theme.Muted, latencyRight, singleY);

            float statusRight = xs[5] + columns[5].Width - 24f;
            string label;
            BadgeKind kind;
            if (!row.HasStatus)
            {
                label = "\u2014";
                kind = BadgeKind.Outline;
            }
            else if (row.Status >= 200 && row.Status < 300)
            {
                label = row.Status + " OK";
                kind = BadgeKind.Secondary;
            }
            else if (row.Status == 0)
            {
                label = "cancelled";
                kind = BadgeKind.Outline;
            }
            else
            {
                label = row.Status + " error";
                kind = BadgeKind.Destructive;
            }
            if (label == "\u2014")
            {
                Theme.TextRight(g, label, Mx.Body, FontStyle.Regular, Theme.Muted, statusRight, singleY);
            }
            else
            {
                float width = Cards.BadgeWidth(g, label, null);
                Cards.Badge(g, statusRight - width, line.Y + (Mx.RowH - Mx.BadgeH) / 2f, label, kind);
            }
        }

        /// <summary>
        /// The model table's columns, sized the way the browser does it: the web
        /// table has no table-fixed, so each column is as wide as its widest cell
        /// (plus that column's padding) and the table overflows its card rather
        /// than shrinking. Content differs between runs — the reference capture
        /// shows "DeepSeek API" where a live run shows "commandcode" — so fixed
        /// widths can never match both.
        /// </summary>
        public static Cards.Column[] ModelColumns(Graphics g, List<ModelRow> models, bool showProvider,
            float tableWidth)
        {
            List<Cards.Column> columns = new List<Cards.Column>();
            List<string[]> cells = new List<string[]>();
            columns.Add(new Cards.Column("Model", 0f, false));
            List<string> modelCells = new List<string>();
            for (int i = 0; i < models.Count; i++)
            {
                modelCells.Add(Fmt.Model(models[i].Model));
            }
            cells.Add(modelCells.ToArray());
            if (showProvider)
            {
                columns.Add(new Cards.Column("API", 0f, false));
                List<string> providers = new List<string>();
                for (int i = 0; i < models.Count; i++)
                {
                    providers.Add(models[i].Provider);
                }
                cells.Add(providers.ToArray());
            }
            string[] numeric = new string[] { "Requests", "Tokens", "Avg latency", "Errors" };
            for (int i = 0; i < numeric.Length; i++)
            {
                columns.Add(new Cards.Column(numeric[i], 0f, true));
            }
            string[][] numericCells = new string[numeric.Length][];
            for (int i = 0; i < numeric.Length; i++)
            {
                numericCells[i] = new string[models.Count];
            }
            for (int r = 0; r < models.Count; r++)
            {
                numericCells[0][r] = Fmt.Int(models[r].Requests);
                numericCells[1][r] = Theme.Compact(models[r].Tokens);
                numericCells[2][r] = models[r].AvgMs > 0 ? Fmt.Int(models[r].AvgMs) + " ms" : "\u2014";
                numericCells[3][r] = Cards.Share(models[r].ErrorRate, models[r].Requests);
            }
            for (int i = 0; i < numeric.Length; i++)
            {
                cells.Add(numericCells[i]);
            }
            // The web table is width:100%, so the slack over the content widths is
            // shared out proportionally instead of leaving the table short.
            return Cards.AutoLayout(g, columns.ToArray(), cells.ToArray(), Math.Max(tableWidth, 0f));
        }

        /// <summary>ModelUsageTable: Model | API? | Requests | Tokens | Avg latency | Errors.</summary>
        public static void ModelUsageTable(Graphics g, RectangleF table, List<ModelRow> models, bool showProvider,
            Action<string, RectangleF> hit, string hover, string keyPrefix)
        {
            Cards.Column[] columns = ModelColumns(g, models, showProvider, table.Width);
            // The table spans the card with no outer inset, and each cell carries
            // its own p-2 (the first one ps-6). The columns are content-sized, so
            // the table can be wider than its card — it is clipped, not squeezed.
            float[] xs = Cards.FixedLayout(table, columns, 0f);
            GraphicsState modelClip = g.Save();
            g.SetClip(table);

            RectangleF head = new RectangleF(table.X, table.Y, table.Width, Mx.HeadH);
            for (int i = 0; i < columns.Length; i++)
            {
                // TableHead px-2, ps-6 on the first column and pe-6 on the last.
                float padLeft = i == 0 ? 24f : 8f;
                float padRight = i == columns.Length - 1 ? 24f : 8f;
                float right = xs[i] + columns[i].Width - padRight;
                float labelWidth = Theme.Measure(g, columns[i].Label, Mx.Body, FontStyle.Regular);
                Theme.Text(g, columns[i].Label, Mx.Body, FontStyle.Regular, Theme.Fg,
                    columns[i].Right ? right - labelWidth : xs[i] + padLeft,
                    Theme.CenterY(g, head.Y, head.Y + Mx.HeadH, Mx.Body, FontStyle.Regular));
            }

            float y = table.Y + Mx.HeadH;
            for (int i = 0; i < models.Count; i++)
            {
                ModelRow model = models[i];
                RectangleF line = new RectangleF(table.X, y, table.Width, Mx.RowSingleH);
                string key = keyPrefix + i;
                if (hover == key)
                {
                    Theme.FillRect(g, line, Theme.Alpha(Theme.Secondary, 128));
                }
                if (i > 0)
                {
                    Cards.Line(g, table.X, y, table.Width, Theme.Border);
                }
                if (hit != null)
                {
                    hit(key, line);
                }
                float textY = y + (Mx.RowSingleH - 19f) / 2f;
                // TableCell p-2 with ps-6 on the first column and pe-6 on the last,
                // matching the head cells above.
                Theme.TextW(g, Fmt.Model(model.Model), Mx.Body, 500, Theme.Fg, xs[0] + 24f, textY);

                int index = 1;
                if (showProvider)
                {
                    Theme.Text(g, model.Provider, Mx.Body, FontStyle.Regular, Theme.Muted, xs[index] + 8f, textY);
                    index++;
                }
                Theme.TextRight(g, Fmt.Int(model.Requests), Mx.Body, FontStyle.Regular, Theme.Fg,
                    xs[index] + columns[index].Width - 8f, textY);
                index++;
                Theme.TextRight(g, Theme.Compact(model.Tokens), Mx.Body, FontStyle.Regular, Theme.Fg,
                    xs[index] + columns[index].Width - 8f, textY);
                index++;
                Theme.TextRight(g, model.AvgMs > 0 ? Fmt.Int(model.AvgMs) + " ms" : "\u2014", Mx.Body,
                    FontStyle.Regular, Theme.Muted, xs[index] + columns[index].Width - 8f, textY);
                index++;
                string errorLabel = model.ErrorRate.ToString("0.0", Inv) + "%";
                float width = Cards.BadgeWidth(g, errorLabel, null);
                Cards.Badge(g, xs[index] + columns[index].Width - 24f - width,
                    y + (Mx.RowSingleH - Mx.BadgeH) / 2f,
                    errorLabel, model.ErrorRate > 0 ? BadgeKind.Destructive : BadgeKind.Outline);
                y += Mx.RowSingleH;
            }
            g.Restore(modelClip);
        }

        // -- charts -----------------------------------------------------------
        // Measured on the live "Requests per day" card: the plot area is inset
        // 21px from each card edge, its grid runs from card+71 to card+291, the
        // tick labels sit 14px below the plot and the legend wrapper at card+321.
        public const float ChartInset = 21f;
        public const float ChartPlotH = 220f;
        public const float ChartTickGap = 14f;
        /// <summary>The legend wrapper sits 30px below the plot in every trend card.</summary>
        public const float ChartLegendGap = 30f;

        public static float ChartLegendY(RectangleF plot)
        {
            return plot.Bottom + ChartLegendGap;
        }

        /// <summary>The recharts plot area inside a trend card.</summary>
        public static RectangleF TrendPlot(RectangleF card, float headerExtra)
        {
            return new RectangleF(card.X + ChartInset, card.Y + 71f + headerExtra,
                card.Width - ChartInset * 2f, ChartPlotH);
        }

        /// <summary>TrendChart mode="requests": bars + "Requests" legend.</summary>
        public static void RequestsChart(Graphics g, RectangleF plot, RectangleF card, List<DailyRow> daily, int hoverIndex)
        {
            Cards.GridEdges(g, plot);
            Cards.Bars(g, plot, daily, hoverIndex, 3f);
            DrawAxisLabels(g, plot, daily);
            LegendCentred(g, plot, ChartLegendY(plot), new string[] { "Requests" }, new Color[] { Theme.Chart2 });
        }

        /// <summary>TrendChart mode="tokens": tokens line/area + successful line.</summary>
        public static void TokensChart(Graphics g, RectangleF plot, RectangleF card, List<DailyRow> daily)
        {
            Cards.GridEdges(g, plot);
            if (daily.Count < 2)
            {
                return;
            }
            float slot = plot.Width / daily.Count;
            double maxTokens = 1, maxSuccess = 1;
            for (int i = 0; i < daily.Count; i++)
            {
                if (daily[i].Tokens > maxTokens) maxTokens = daily[i].Tokens;
                if (daily[i].Success > maxSuccess) maxSuccess = daily[i].Success;
            }
            PointF[] tokenPoints = new PointF[daily.Count];
            PointF[] successPoints = new PointF[daily.Count];
            for (int i = 0; i < daily.Count; i++)
            {
                float px = plot.X + slot * i + slot / 2f;
                tokenPoints[i] = new PointF(px, plot.Bottom - 2f - (float)(daily[i].Tokens / maxTokens) * (plot.Height - 8f));
                successPoints[i] = new PointF(px, plot.Bottom - 2f - (float)(daily[i].Success / maxSuccess) * (plot.Height - 8f));
            }
            // TrendChart draws plain <Line> elements: no area fill under either.
            Cards.LineArea(g, tokenPoints, plot, Theme.Chart1, false, 2f);
            Cards.LineArea(g, successPoints, plot, Theme.Chart3, false, 2f);

            int step = AxisStep(g, daily, slot);
            for (int i = 0; i < daily.Count; i += step)
            {
                Theme.TextCenter(g, Theme.AxisTick(daily[i].Date, daily.Count), Mx.Small, FontStyle.Regular, Theme.Muted,
                    tokenPoints[i].X, plot.Bottom + ChartTickGap);
            }
            // recharts centres the legend wrapper; the order is Successful, Tokens.
            LegendCentred(g, plot, ChartLegendY(plot), new string[] { "Successful", "Tokens" },
                new Color[] { Theme.Chart3, Theme.Chart1 });
        }

        /// <summary>TrendChart mode="combined": request bars + token line.</summary>
        public static void CombinedChart(Graphics g, RectangleF plot, RectangleF card, List<DailyRow> daily, int hoverIndex)
        {
            Cards.GridEdges(g, plot);
            Cards.Bars(g, plot, daily, -1, 3f);
            if (daily.Count >= 2)
            {
                float slot = plot.Width / daily.Count;
                double maxTokens = 1;
                for (int i = 0; i < daily.Count; i++)
                {
                    if (daily[i].Tokens > maxTokens) maxTokens = daily[i].Tokens;
                }
                PointF[] points = new PointF[daily.Count];
                for (int i = 0; i < daily.Count; i++)
                {
                    float px = plot.X + slot * i + slot / 2f;
                    points[i] = new PointF(px, plot.Bottom - 2f - (float)(daily[i].Tokens / maxTokens) * (plot.Height - 8f));
                }
                Cards.LineArea(g, points, plot, Theme.Chart1, false, 2f);
            }
            DrawAxisLabels(g, plot, daily);
            LegendCentred(g, plot, ChartLegendY(plot), new string[] { "Requests", "Tokens" },
                new Color[] { Theme.Chart2, Theme.Chart1 });
        }

        private static void DrawAxisLabels(Graphics g, RectangleF plot, List<DailyRow> daily)
        {
            if (daily.Count == 0)
            {
                return;
            }
            float slot = plot.Width / daily.Count;
            int step = AxisStep(g, daily, slot);
            for (int i = 0; i < daily.Count; i += step)
            {
                // The tick sits on the band centre, not the bar's left edge.
                Theme.TextCenter(g, Theme.AxisTick(daily[i].Date, daily.Count), Mx.Small, FontStyle.Regular, Theme.Muted,
                    plot.X + slot * i + slot / 2f, plot.Bottom + ChartTickGap);
            }
        }

        /// <summary>Recharts hides ticks that would overlap; mirror that here.</summary>
        public static int AxisStep(Graphics g, List<DailyRow> daily, float slot)
        {
            float widest = 0f;
            for (int i = 0; i < daily.Count; i++)
            {
                float width = Theme.Measure(g, Theme.AxisTick(daily[i].Date, daily.Count), Mx.Small, FontStyle.Regular);
                if (width > widest)
                {
                    widest = width;
                }
            }
            if (slot <= 0f || widest <= 0f)
            {
                return 1;
            }
            int step = (int)Math.Ceiling((widest + 8f) / slot);
            return step < 1 ? 1 : step;
        }

        /// <summary>
        /// Centres a legend row inside the plot's width, which is where recharts
        /// puts the default legend wrapper.
        /// </summary>
        public static void LegendCentred(Graphics g, RectangleF plot, float y, string[] labels, Color[] colors)
        {
            float gap = 16f;
            float total = 0f;
            for (int i = 0; i < labels.Length; i++)
            {
                total += 13f + Theme.Measure(g, labels[i], Mx.Small, FontStyle.Regular);
                if (i > 0)
                {
                    total += gap;
                }
            }
            float x = plot.X + (plot.Width - total) / 2f;
            for (int i = 0; i < labels.Length; i++)
            {
                x = Legend(g, x, y, colors[i], labels[i]);
                if (i < labels.Length - 1)
                {
                    x += gap;
                }
            }
        }

        public static float Legend(Graphics g, float x, float y, Color color, string label)
        {
            Theme.Fill(g, new RectangleF(x, y + 3f, 8f, 8f), 2f, color);
            Theme.Text(g, label, Mx.Small, FontStyle.Regular, Theme.Muted, x + 13f, y);
            return x + 13f + Theme.Measure(g, label, Mx.Small, FontStyle.Regular);
        }

        public static void ChartTooltip(Graphics g, RectangleF plot, List<DailyRow> daily, int index, bool tokens)
        {
            if (index < 0 || index >= daily.Count)
            {
                return;
            }
            float slot = plot.Width / daily.Count;
            float center = plot.X + slot * index + slot / 2f;
            Cards.VLine(g, center, plot.Y - 4f, plot.Height + 4f, Theme.Input);

            DailyRow row = daily[index];
            string title = Fmt.TooltipDate(row.Date);
            string line1 = Fmt.Int(row.Requests) + " req";
            string line2 = Theme.Compact(row.Tokens);
            float width = Math.Max(Theme.Measure(g, title, Mx.Small, FontStyle.Regular),
                Theme.Measure(g, line1 + "  " + line2, Mx.Small, FontStyle.Regular)) + 24f;
            float x = center - width / 2f;
            if (x < plot.X - 8f) x = plot.X - 8f;
            if (x + width > plot.Right + 8f) x = plot.Right + 8f - width;
            RectangleF box = new RectangleF(x, plot.Y - 66f, width, 58f);
            Theme.Fill(g, box, 8f, Theme.Dark ? Color.FromArgb(28, 28, 28) : Color.White);
            Theme.Stroke(g, box, 8f, Theme.Border, 1f);
            Theme.Text(g, title, Mx.Small, FontStyle.Regular, Theme.Muted, box.X + 10f, box.Y + 8f);
            Theme.Text(g, line1, Mx.Body, FontStyle.Regular, Theme.Fg, box.X + 10f, box.Y + 24f);
            Theme.Text(g, line2, Mx.Body, FontStyle.Regular, Theme.Fg, box.X + 10f, box.Y + 40f);
        }
    }
}
