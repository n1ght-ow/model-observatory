using System;
using System.Collections.Generic;
using System.Drawing;
using System.Globalization;

namespace RouterMonitorTray
{
    /// <summary>The Requests page: the filter card and the full request log with
    /// sortable headers, pagination and CSV export.</summary>
    internal sealed partial class PanelView
    {
        private const int RequestsPageSize = 20;

        private RectangleF rqFilter;
        private RectangleF rqLog;
        private RectangleF rqLogTable;
        private int rqRows;
        private float rqPagerY;

        private List<RecentRow> sortedCache;
        private int sortedCacheCount = -1;
        private string sortedCacheKey = "";
        private bool sortedCacheAsc;

        /// <summary>
        /// The stale-log banner: rounded-md border px-3 py-2 text-xs, so 16px of
        /// padding around one 16px line plus its 1px borders.
        /// </summary>
        private const float StaleBannerH = 34f;

        private RectangleF rqStale;

        private const float SelectBlockH = 54f;   // label line + gap-1.5 + h-8 trigger
        private const float ToolbarH = 45f;       // border-b px-4 py-2 around the text-xs row
        private const float PagerH = 53f;         // border-t px-4 py-3 around the pager
        /// <summary>Card top to the first table row: header 78 + toolbar 45 + thead 40.</summary>
        private const float LogTableTop = 163f;

        private void LayoutRequests()
        {
            // page: flex flex-col gap-4 -> header block, then gap-4, then cards
            float y = Mx.PagePad + Mx.PageHeaderH + Mx.CardGap;

            // The stale-log banner sits between the header and the cards when the
            // newest entry is an hour old or more, pushing both cards down.
            rqStale = new RectangleF(PageX, y, PageW, StaleBannerH);
            if (StaleMinutes() != null)
            {
                y += StaleBannerH + Mx.CardGap;
            }

            // Measured on the live page: the filter card is 156 tall and the log
            // card is 163 + 20 rows x 53 + the 53px pager + 16px of padding.
            float filterH = 156f;
            rqFilter = new RectangleF(PageX, y, PageW, filterH);
            y += filterH + Mx.CardGap;

            rqRows = Snap == null ? 0 : Math.Min(Snap.Recent.Count, RequestsPageSize);
            float logH = LogTableTop + Math.Max(1, rqRows) * Mx.RowH + PagerH + Mx.CardPad;
            rqLog = new RectangleF(PageX, y, PageW, logH);
            y += logH;

            contentHeight = y + Mx.PagePad;
        }

        private void DrawRequestsPage(Graphics g)
        {
            string description = Snap.Source == "router"
                ? "Live request log from Codex Router API (127.0.0.1:4202)."
                : "Live request log from the native DeepSeek API (api.deepseek.com).";
            PageHeader(g, "Requests", description, true, false);

            if (StaleMinutes() != null)
            {
                DrawStaleBanner(g);
            }
            DrawFilterCard(g);
            DrawRequestLog(g);
        }

/// <summary>
        /// Minutes since the newest logged request, or null when the log is fresh
        /// (or empty). The page warns once that gap reaches an hour, so the table
        /// does not quietly end hours in the past.
        /// </summary>
        private int? StaleMinutes()
        {
            if (Snap == null || Snap.Recent.Count == 0 || Snap.GeneratedAt == DateTime.MinValue)
            {
                return null;
            }
            // GeneratedAt is parsed as UTC while RecentRow.At is stored in local
            // time (Api.Load converts it), so the two must be brought together
            // before differencing — otherwise the gap looks like minus the UTC
            // offset and the banner never appears east of Greenwich.
            double minutes = (Snap.GeneratedAt.ToLocalTime() - Snap.Recent[0].At).TotalMinutes;
            if (double.IsNaN(minutes) || double.IsInfinity(minutes))
            {
                return null;
            }
            int rounded = (int)Math.Round(minutes);
            return rounded >= 60 ? rounded : (int?)null;
        }

        /// <summary>
        /// The stale-log banner: rounded-md, amber-500 border at 30% over an
        /// amber-500 5% wash, with amber-700 text.
        /// </summary>
        private void DrawStaleBanner(Graphics g)
        {
            int? stale = StaleMinutes();
            if (stale == null)
            {
                return;
            }
            RectangleF box = rqStale;
            Theme.Fill(g, box, 8f, Theme.Alpha(Theme.Amber500, 13));
            Theme.Stroke(g, box, 8f, Theme.Alpha(Theme.Amber500, 77), 1f);

            int minutes = stale.Value;
            string age = minutes < 120 ? minutes + " min" : Math.Round(minutes / 60.0) + " h";
            string note = "Newest entry in this log is " + age + " old (" +
                Fmt.TableTime(Snap.Recent[0].At) + "). Nothing has been recorded since then.";
            Theme.Text(g, note, Mx.Small, FontStyle.Regular, Theme.AmberInk, box.X + 13f,
                Theme.CenterY(g, box.Y, box.Bottom, Mx.Small, FontStyle.Regular));
        }

        private void DrawFilterCard(Graphics g)
        {
            RectangleF card = rqFilter;
            Cards.Tile(g, card);
            float rowY = Cards.TileHeader(g, card, "Filter requests",
                "Choose an API and model to narrow the log below.") + 8f;
            float x = card.X + Mx.CardPad;

            x = FilterSelect(g, x, rowY, "provider", "API / provider", ProviderLabel(), 224f);
            x += 12f;
            FilterSelect(g, x, rowY, "model", "Model", ModelLabel(), 256f);

            bool hasFilter = State.Provider.Length > 0 || State.Model.Length > 0;
            float resetWidth = Cards.ButtonWidth(g, "Reset", "rotate-ccw");
            RectangleF reset = new RectangleF(card.Right - Mx.CardPad - resetWidth, rowY + 24f, resetWidth, Mx.BtnSmH);
            Cards.Button(g, reset, "Reset", BtnKind.Ghost, "rotate-ccw", hover == "reset");
            if (hasFilter)
            {
                Hit("reset", reset);
            }
        }

        private string ProviderLabel()
        {
            if (State.Provider.Length == 0)
            {
                return "All APIs";
            }
            return State.Provider;
        }

        private string ModelLabel()
        {
            if (State.Model.Length == 0)
            {
                return "All models";
            }
            return Fmt.Model(State.Model);
        }

        /// <summary>One labelled Select trigger: filter icon, label, border box, chevron.</summary>
        private float FilterSelect(Graphics g, float x, float y, string which, string label, string value, float minWidth)
        {
            Glyph.Draw(g, "filter", new RectangleF(x, y, 13f, 13f), Theme.Muted, 1.5f);
            Theme.Text(g, label, Mx.Small, FontStyle.Regular, Theme.Muted, x + 19f, y);
            float valueWidth = Theme.Measure(g, value, Mx.Body, FontStyle.Regular);
            float width = Math.Max(minWidth, valueWidth + 48f);
            RectangleF box = new RectangleF(x, y + 21f, width, Mx.BtnH);
            bool isHover = hover == "select:" + which;
            Theme.Fill(g, box, 8f, isHover ? Theme.Alpha(Theme.Input, Theme.Dark ? 110 : 120) : Theme.Alpha(Theme.Input, Theme.Dark ? 60 : 60));
            Theme.Stroke(g, box, 8f, Theme.Input, 1f);
            Glyph.Draw(g, "filter", new RectangleF(box.X + 10f, box.Y + 9f, 14f, 14f), Theme.Muted, 1.5f);
            Theme.Text(g, Theme.Fit(g, value, Mx.Body, FontStyle.Regular, box.Width - 60f), Mx.Body, FontStyle.Regular,
                State.Provider.Length > 0 || State.Model.Length > 0 ? Theme.Fg : Theme.Muted,
                box.X + 32f, Theme.CenterY(g, box.Y, box.Bottom, Mx.Body, FontStyle.Regular));
            Glyph.Draw(g, "chevron-down", new RectangleF(box.Right - 24f, box.Y + 9f, 14f, 14f), Theme.Muted, 1.5f);

            if (which == "provider")
            {
                selectProviderRect = box;
            }
            else
            {
                selectModelRect = box;
            }
            Hit("select:" + which, box);
            return x + width;
        }

        private void DrawRequestLog(Graphics g)
        {
            RectangleF card = rqLog;
            Cards.Tile(g, card);
            string sourceLabel = Snap.Source == "router" ? "Codex Router API" : "DeepSeek API";
            float headerBottom = Cards.TileHeader(g, card, "Request log", LogDescription());

            string total = sourceLabel + " \u00b7 " + Fmt.Int(Snap.TotalsAll.Requests) + " total";
            float totalWidth = Cards.BadgeWidth(g, total, null);
            Cards.Badge(g, card.Right - Mx.CardPad - totalWidth, card.Y + Mx.CardPad, total, BadgeKind.Secondary);

            // Toolbar row, border-b, "Click a column header to sort." + Export CSV.
            float toolbarY = headerBottom;
            Cards.Line(g, card.X, toolbarY + ToolbarH, card.Width, Theme.Border);
            int totalRows = Snap.Recent.Count;
            Theme.Text(g, "Click a column header to sort. " + Fmt.Int(totalRows) + " rows available.", Mx.Small,
                FontStyle.Regular, Theme.Muted, card.X + Mx.CardPad,
                Theme.CenterY(g, toolbarY, toolbarY + ToolbarH, Mx.Small, FontStyle.Regular));

            float exportWidth = Cards.ButtonWidth(g, "Export CSV", "download");
            RectangleF export = new RectangleF(card.Right - Mx.CardPad - exportWidth, toolbarY + (ToolbarH - Mx.BtnSmH) / 2f,
                exportWidth, Mx.BtnSmH);
            Cards.Button(g, export, "Export CSV", BtnKind.Outline, "download", hover == "export");
            Hit("export", export);

            rqLogTable = new RectangleF(card.X, toolbarY + ToolbarH, card.Width,
                card.Bottom - Mx.CardPad - toolbarY - ToolbarH);
            if (totalRows == 0)
            {
                Cards.Empty(g, rqLogTable, "activity", "No matching requests",
                    "No calls were recorded for this API/model combination. Reset the filters or pick another route.");
                return;
            }

            List<RecentRow> rows = SortedRecent();
            int pageCount = Math.Max(1, (rows.Count + RequestsPageSize - 1) / RequestsPageSize);
            if (State.TablePage > pageCount) State.TablePage = pageCount;
            if (State.TablePage < 1) State.TablePage = 1;
            int start = (State.TablePage - 1) * RequestsPageSize;

            RectangleF table = new RectangleF(rqLogTable.X, rqLogTable.Y, rqLogTable.Width,
                Mx.HeadH + Math.Max(1, rqRows) * Mx.RowH);
            Widgets.RequestsTable(g, table, rows, start, rqRows, State.Sort, State.SortAsc, Hit, hover);

            // Pagination footer with border-t.
            float pagerY = table.Bottom;
            rqPagerY = pagerY;
            Cards.Line(g, card.X, pagerY, card.Width, Theme.Border);
            int last = Math.Min(start + rqRows, rows.Count);
            float pagerBottom = card.Bottom - Mx.CardPad;
            Theme.Text(g, Fmt.Int(start + 1) + "\u2013" + Fmt.Int(last) + " of " + Fmt.Int(rows.Count) + " requests",
                Mx.Small, FontStyle.Regular, Theme.Muted, card.X + Mx.CardPad,
                Theme.CenterY(g, pagerY, pagerBottom, Mx.Small, FontStyle.Regular));

            float right = card.Right - Mx.CardPad;
            string pageLabel = "Page " + State.TablePage + " / " + pageCount;
            float labelWidth = Theme.Measure(g, pageLabel, Mx.Small, FontStyle.Regular);
            Theme.Text(g, pageLabel, Mx.Small, FontStyle.Regular, Theme.Muted, right - labelWidth - 40f,
                Theme.CenterY(g, pagerY, pagerBottom, Mx.Small, FontStyle.Regular));

            float pagerBtnY = pagerY + (pagerBottom - pagerY - Mx.BtnSmH) / 2f;
            RectangleF next = new RectangleF(right - 28f, pagerBtnY, 28f, Mx.BtnSmH);
            RectangleF prev = new RectangleF(next.X - 34f - labelWidth, pagerBtnY, 28f, Mx.BtnSmH);
            bool canPrev = State.TablePage > 1;
            bool canNext = State.TablePage < pageCount;
            Cards.Button(g, prev, "", BtnKind.Outline, null, hover == "table:prev");
            Glyph.Draw(g, "chevron-left", new RectangleF(prev.X + 8f, prev.Y + 8f, 12f, 12f), canPrev ? Theme.Fg : Theme.Muted, 1.5f);
            Cards.Button(g, next, "", BtnKind.Outline, null, hover == "table:next");
            Glyph.Draw(g, "chevron-right", new RectangleF(next.X + 8f, next.Y + 8f, 12f, 12f), canNext ? Theme.Fg : Theme.Muted, 1.5f);
            if (canPrev) Hit("table:prev", prev);
            if (canNext) Hit("table:next", next);
        }

        private string LogDescription()
        {
            string text = "Latest " + Fmt.Int(Snap.Recent.Count) + " matching requests \u00b7 " +
                Theme.Compact(Snap.TotalsAll.Tokens) + " tokens \u00b7 " +
                Snap.TotalsAll.SuccessRate.ToString("0.0", Inv) + "% success";
            if (Snap.TotalsAll.HasCost && Snap.TotalsAll.Cost > 0)
            {
                text += " \u00b7 $" + Snap.TotalsAll.Cost.ToString("0.00", Inv);
            }
            return text;
        }

        /// <summary>Rows sorted the way the web table sorts them, memoised per snapshot.</summary>
        private List<RecentRow> SortedRecent()
        {
            List<RecentRow> source = Snap == null ? new List<RecentRow>() : Snap.Recent;
            if (sortedCache != null && sortedCacheCount == source.Count &&
                sortedCacheKey == State.Sort && sortedCacheAsc == State.SortAsc)
            {
                return sortedCache;
            }
            List<RecentRow> rows = new List<RecentRow>(source);
            string key = State.Sort;
            rows.Sort(delegate (RecentRow a, RecentRow b)
            {
                int result;
                if (key == "model") result = string.CompareOrdinal(a.Model, b.Model);
                else if (key == "provider") result = string.CompareOrdinal(a.Provider, b.Provider);
                else if (key == "totalTokens") result = a.Tokens.CompareTo(b.Tokens);
                else if (key == "durationMs") result = a.DurationMs.CompareTo(b.DurationMs);
                else if (key == "status") result = a.Status.CompareTo(b.Status);
                else result = a.At.CompareTo(b.At);
                return State.SortAsc ? result : -result;
            });
            sortedCache = rows;
            sortedCacheCount = source.Count;
            sortedCacheKey = key;
            sortedCacheAsc = State.SortAsc;
            return rows;
        }
    }
}
