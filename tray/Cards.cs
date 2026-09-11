using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Globalization;

namespace RouterMonitorTray
{
    /// <summary>
    /// The web app's metrics, in CSS pixels: the same paddings, row heights,
    /// badge sizes and border hairlines that the Tailwind classes produce.
    /// </summary>
    internal static class Mx
    {
        public const float CardPad = 16f;       // --card-spacing / p-4
        public const float CardGap = 16f;       // Card gap-4 between children
        public const float Pad = 16f;           // legacy alias for the card padding
        public const float PagePad = 24f;       // md:p-6 page padding
        public const float Radius = 12f;

        public const float PageTitle = 20f;     // text-xl  (30px line)
        public const float CardTitle = 16f;     // text-base
        public const float Body = 14f;          // text-sm
        public const float Small = 12f;         // text-xs
        public const float Tiny = 10f;          // text-[10px]
        public const float StatFooter = 12f;    // text-xs
        public const float StatValue = 24f;     // text-2xl
        public const float ButtonText = 13f;    // text-[0.8rem]

        public const float CardTitleLine = 22f;
        public const float DescLine = 20f;
        /// <summary>
        /// Flush DashboardCard header block for a bordered header and the default
        /// leading-snug title. Cards with a bare `text-base` title are 2px taller;
        /// Cards.Header derives both from the parts rather than pinning them.
        /// </summary>
        public const float FlushHeaderH = 78f;
        /// <summary>The same header when the card draws a border-b: 79.</summary>
        public const float FlushHeaderRuledH = 79f;
        /// <summary>Card: rounded-xl, which this project pins at radius * 1.4.</summary>
        public const float TileRadius = 14f;
        /// <summary>CardHeader title line: the default `text-base leading-snug`.</summary>
        public const float TitleLine = 22f;
        /// <summary>
        /// The same title when a card overrides it with a bare `text-base`, which
        /// drops leading-snug and takes Tailwind's 24px line-height. Measured:
        /// those cards put their description at +44 and their content at +81.
        /// </summary>
        public const float TitleLineBase = 24f;
        /// <summary>CardDescription line: text-sm leading-5.</summary>
        public const float BodyLine = 20f;
        /// <summary>Careful gap between a title and its description: gap-1.</summary>
        public const float TitleGap = 4f;
        /// <summary>Page header block: h1 line (28) + gap-1 (4) + description (20).</summary>
        public const float PageHeaderH = 52f;
        public const float BadgeH = 20f;        // h-5
        public const float BtnSmH = 28f;        // h-7
        public const float BtnH = 32f;          // h-8
        public const float HeadH = 40f;         // th h-10
        public const float RowH = 53f;          // a two-line cell: p-2 + 36 + border
        public const float RowSingleH = 48f;    // single-line rows keep the h-12 minimum
        public const float SparkH = 36f;
        /// <summary>Measured on the live page at 1440x900.</summary>
        public const float StatH = 153f;
        public const float TrendH = 374f;
        public const float FooterH = 49f;       // CardFooter: border + p-4 + text-xs
    }

    internal enum BadgeKind
    {
        Secondary,
        Destructive,
        Outline,
        Default
    }

    internal enum BtnKind
    {
        Outline,
        Ghost,
        Primary,
        Link
    }

    /// <summary>Shared card, badge, table and chart primitives.</summary>
    internal static class Cards
    {
        private static readonly CultureInfo Inv = CultureInfo.InvariantCulture;

        // -- cards ------------------------------------------------------------
        /// <summary>
        /// Height of a card header: the measured single-line baseline plus one
        /// line per extra wrapped description line. The web's CardHeader allows
        /// the description to wrap, so a two-line card is 20px taller and
        /// everything below it moves down by the same amount.
        /// </summary>
        public static float HeaderHeight(Graphics g, RectangleF card, string title, string description, bool rule)
        {
            return HeaderHeight(g, card, title, description, rule, Mx.TitleLine);
        }

        public static float HeaderHeight(Graphics g, RectangleF card, string title, string description, bool rule,
            float titleLine)
        {
            // Derived rather than pinned, because the two title variants differ by
            // 2px and the difference propagates: measured content tops are +79 for
            // a leading-snug title and +81 for a bare text-base one.
            float baseline = rule
                ? Mx.CardPad + titleLine + Mx.TitleGap + Mx.BodyLine + Mx.CardPad + 1f
                : Mx.CardPad + titleLine + Mx.TitleGap + Mx.BodyLine;
            float width = card.Width - Mx.CardPad * 2f;
            return baseline + (DescriptionLines(g, description, width) - 1) * Mx.DescLine;
        }

        /// <summary>How many lines the description takes at the given width.</summary>
        public static int DescriptionLines(Graphics g, string description, float width)
        {
            if (string.IsNullOrEmpty(description))
            {
                return 1;
            }
            return Math.Max(1, Theme.Wrap(g, description, Mx.Body, FontStyle.Regular, width, 4).Count);
        }

        /// <summary>
        /// Draws the card header exactly like CardHeader (px-4, gap-1) with the
        /// optional border-b, and returns the y where CardContent starts. The
        /// description wraps the way the browser wraps it.
        /// </summary>
        public static float Header(Graphics g, RectangleF card, string title, string description, bool rule)
        {
            return Header(g, card, title, description, rule, Mx.TitleLine);
        }

        /// <summary>
        /// The same header for a card whose title overrides the default
        /// `leading-snug` with a bare `text-base` (24px line-height), which is
        /// 2px taller — enough to shift the description and everything below it.
        /// </summary>
        public static float Header(Graphics g, RectangleF card, string title, string description, bool rule,
            float titleLine)
        {
            // A leading-snug title has 1px less half-leading than a bare text-base
            // one, so Theme.InkShift's size-based figure overshoots it by 1.
            float titleY = card.Y + Mx.CardPad + (titleLine >= Mx.TitleLineBase ? 0f : -1f);
            Theme.TextW(g, title, Mx.CardTitle, 500, Theme.Fg, card.X + Mx.CardPad, titleY);
            float width = card.Width - Mx.CardPad * 2f;
            List<string> lines = string.IsNullOrEmpty(description)
                ? new List<string>()
                : Theme.Wrap(g, description, Mx.Body, FontStyle.Regular, width, 4);
            float y = titleY + titleLine + Mx.TitleGap;
            for (int i = 0; i < lines.Count; i++)
            {
                Theme.Text(g, lines[i], Mx.Body, FontStyle.Regular, Theme.Muted,
                    card.X + Mx.CardPad, y + i * Mx.DescLine);
            }
            // The browser's #[.border-b]:pb-4 header measures 81px against the
            // plain header's 78; each extra description line adds a line pitch.
            float bottom = card.Y + HeaderHeight(g, card, title, description, rule, titleLine);
            if (rule)
            {
                Line(g, card.X, bottom - 1f, card.Width, Theme.Border);
            }
            return bottom;
        }


        // -- real Card tiles --------------------------------------------------
        /// <summary>
        /// The Requests and Models pages use the plain Card component rather
        /// than the overview's flush DashboardCard grid: rounded-xl, bg-card and
        /// a ring-foreground/10 outline over the page background.
        /// </summary>
        public static void Tile(Graphics g, RectangleF rect)
        {
            Theme.Fill(g, rect, Mx.TileRadius, Theme.Card);
            Theme.Stroke(g, rect, Mx.TileRadius, Theme.TileRing, 1f);
        }

        /// <summary>Card + CardHeader (px-4, gap-1) with an optional description.</summary>
        public static float TileHeader(Graphics g, RectangleF card, string title, string description)
        {
            // Default leading-snug title: 1px less half-leading than text-base.
            float titleY = card.Y + Mx.CardPad - 1f;
            Theme.TextW(g, title, Mx.CardTitle, 500, Theme.Fg, card.X + Mx.CardPad, titleY);
            float y = titleY + 1f + Mx.TitleLine;
            if (!string.IsNullOrEmpty(description))
            {
                y += Mx.TitleGap;
                Theme.Text(g, Theme.Fit(g, description, Mx.Body, FontStyle.Regular, card.Width - Mx.CardPad * 2f),
                    Mx.Body, FontStyle.Regular, Theme.Muted, card.X + Mx.CardPad, y);
                y += Mx.BodyLine;
            }
            // Card gap-4 before the next child.
            return y + Mx.CardGap;
        }

        /// <summary>Height of a Card + CardHeader, up to the first content pixel.</summary>
        public static float TileHeaderHeight(string description)
        {
            return HeaderBlock(description) + Mx.CardGap;
        }

        /// <summary>CardHeader height measured from the card's top edge.</summary>
        public static float HeaderBlock(string description)
        {
            return Mx.CardPad + Mx.TitleLine +
                (string.IsNullOrEmpty(description) ? 0f : Mx.TitleGap + Mx.BodyLine);
        }

        /// <summary>CardHeader with border-b (pb-4) plus the grid hairline.</summary>
        public static float HeaderBlockRuled(string description)
        {
            return HeaderBlock(description) + Mx.CardPad + 1f;
        }

        /// <summary>
        /// The Overview's flush cards are not the plain Card: their headers use
        /// gap-1 between title and description (16 + 22 + 4 + 20 + 16 = 78), and
        /// the ruled ones add pb-4 plus a 1px hairline, for 95.
        /// </summary>
        public static float FlushHeaderH(string description)
        {
            return Mx.CardPad + Mx.CardTitleLine +
                (string.IsNullOrEmpty(description) ? 0f : Mx.TitleGap + Mx.BodyLine) + Mx.CardPad;
        }

        public static float FlushHeaderRuledH(string description)
        {
            return FlushHeaderH(description) + 1f;
        }

        /// <summary>Content top of a card whose header draws a border-b rule.</summary>
        public static float RuledContentTop(string description)
        {
            return HeaderBlockRuled(description) + Mx.CardGap;
        }

        /// <summary>
        /// CardFooter height when it holds a button: border-t + py-4 around the
        /// 28px small Button. A footer with only a text line is Mx.FooterH (49).
        /// </summary>
        public const float FooterWithButton = 61f;

        /// <summary>CardFooter: border-t plus the web's bg-muted/50 strip.</summary>
        public static void TileFooter(Graphics g, RectangleF card, float top)
        {
            RectangleF strip = new RectangleF(card.X + 1f, top + 1f, card.Width - 2f, card.Bottom - top - 2f);
            Theme.FillRect(g, strip, Theme.Dark ? Color.FromArgb(31, 31, 31) : Color.FromArgb(248, 248, 248));
            Line(g, card.X, top, card.Width, Theme.Border);
        }

        /// <summary>
        /// Snaps a layout coordinate to the device pixel grid. Without this a
        /// hairline at x=564.75 is antialiased across two columns and reads as a
        /// grey smear instead of the crisp line the browser draws.
        /// </summary>
        public static float Snap(Graphics g, float value)
        {
            float scale = g.Transform.Elements[0];
            if (scale <= 0f)
            {
                return value;
            }
            return (float)(Math.Round(value * scale) / scale);
        }

        /// <summary>A one-device-pixel horizontal rule, snapped so it stays crisp.</summary>
        public static void Line(Graphics g, float x, float y, float width, Color color)
        {
            float scale = g.Transform.Elements[0];
            float px = scale > 0f ? 1f / scale : 1f;
            // Rules are drawn at their logical row, which is the top edge of a
            // 1px band; snapping rounds it to the pixel that band occupies.
            // x and width are snapped independently on purpose: the rule is the
            // full-bleed line between cells, and both of its ends must land on
            // the same pixel the browser paints, or the line reads short by one.
            float left = Snap(g, x);
            float right = Snap(g, x) + Snap(g, width);
            float top = Snap(g, y);
            if (right <= left)
            {
                right = left + px;
            }
            if (right - left < px)
            {
                right = left + px;
            }
            using (SolidBrush brush = new SolidBrush(color))
            {
                g.FillRectangle(brush, left, top, right - left, px);
            }
        }

        /// <summary>A one-device-pixel vertical rule, snapped so it stays crisp.</summary>
        public static void VLine(Graphics g, float x, float y, float height, Color color)
        {
            float scale = g.Transform.Elements[0];
            float px = scale > 0f ? 1f / scale : 1f;
            float left = Snap(g, x);
            float top = Snap(g, y);
            float bottom = Snap(g, y + height);
            if (bottom - top < px)
            {
                bottom = top + px;
            }
            using (SolidBrush brush = new SolidBrush(color))
            {
                g.FillRectangle(brush, left, top, px, bottom - top);
            }
        }

        // -- badges -----------------------------------------------------------
        public static Color BadgeFill(BadgeKind kind)
        {
            switch (kind)
            {
                case BadgeKind.Destructive: return Theme.Alpha(Theme.Destructive, Theme.Dark ? 52 : 28);
                case BadgeKind.Outline: return Color.Empty;
                case BadgeKind.Default: return Theme.Primary;
                default: return Theme.Secondary;
            }
        }

        public static Color BadgeText(BadgeKind kind)
        {
            switch (kind)
            {
                case BadgeKind.Destructive: return Theme.Destructive;
                case BadgeKind.Default: return Theme.PrimaryFg;
                default: return Theme.Fg;
            }
        }

        /// <summary>
        /// The web Badge's box: px-2 (16) plus its 1px transparent border (2)
        /// around the label, which the Badge component sets at font-medium.
        /// Measuring the label at 400 instead of 500 made every badge about 2px
        /// narrow, which walked each badge after it out of position.
        /// </summary>
        public static float BadgeWidth(Graphics g, string text, string glyph)
        {
            float width = Theme.MeasureW(g, text, Mx.Small, 500) + 18f;
            if (!string.IsNullOrEmpty(glyph))
            {
                width += 18f;
            }
            return width;
        }

        /// <summary>The web Badge: h-5, rounded-4xl, px-2, text-xs.</summary>
        public static float Badge(Graphics g, float x, float y, string text, BadgeKind kind)
        {
            return Badge(g, x, y, text, kind, null, Theme.Fg);
        }

        public static float Badge(Graphics g, float x, float y, string text, BadgeKind kind, string glyph, Color glyphColor)
        {
            float width = BadgeWidth(g, text, glyph);
            RectangleF rect = new RectangleF(x, y, width, Mx.BadgeH);
            Theme.Pill(g, rect, BadgeFill(kind), kind == BadgeKind.Outline ? Theme.Border : Color.Empty);
            float textX = x + 8f;
            if (!string.IsNullOrEmpty(glyph))
            {
                Glyph.Draw(g, glyph, new RectangleF(x + 6f, y + 3f, 14f, 14f), glyphColor, 1.5f);
                textX = x + 24f;
            }
            Theme.TextW(g, text, Mx.Small, 500, BadgeText(kind), textX,
                Theme.CenterY(g, y, y + Mx.BadgeH, Mx.Small, FontStyle.Regular));
            return width;
        }

        // -- buttons ----------------------------------------------------------
        public static float ButtonWidth(Graphics g, string label, string glyph)
        {
            float width = Theme.Measure(g, label, Mx.ButtonText, FontStyle.Regular) + 20f;
            if (!string.IsNullOrEmpty(glyph))
            {
                width += 20f;
            }
            return width;
        }

        public static void Button(Graphics g, RectangleF rect, string label, BtnKind kind, string glyph, bool hover)
        {
            if (kind == BtnKind.Link)
            {
                Theme.Text(g, label, Mx.Body, FontStyle.Regular, Theme.Fg, rect.X, Theme.CenterY(g, rect.Y, rect.Bottom, Mx.Body, FontStyle.Regular));
                return;
            }
            if (kind == BtnKind.Primary)
            {
                Theme.Fill(g, rect, 8f, hover ? Theme.Alpha(Theme.Primary, 210) : Theme.Primary);
            }
            else if (kind == BtnKind.Outline)
            {
                Theme.Fill(g, rect, 8f, hover ? Theme.Alpha(Theme.Input, Theme.Dark ? 110 : 120) : Theme.Alpha(Theme.Input, Theme.Dark ? 60 : 60));
                Theme.Stroke(g, rect, 8f, Theme.Input, 1f);
            }
            else if (hover)
            {
                Theme.Fill(g, rect, 8f, Theme.Secondary);
            }

            Color color = kind == BtnKind.Primary ? Theme.PrimaryFg : (kind == BtnKind.Ghost ? Theme.Muted : Theme.Fg);
            if (hover && kind == BtnKind.Ghost)
            {
                color = Theme.Fg;
            }
            float textWidth = Theme.Measure(g, label, Mx.ButtonText, FontStyle.Regular);
            float glyphWidth = string.IsNullOrEmpty(glyph) ? 0f : 14f;
            float gap = string.IsNullOrEmpty(glyph) ? 0f : 6f;
            float startX = rect.X + (rect.Width - textWidth - glyphWidth - gap) / 2f;
            if (!string.IsNullOrEmpty(glyph))
            {
                Glyph.Draw(g, glyph, new RectangleF(startX, rect.Y + (rect.Height - 14f) / 2f, 14f, 14f), color, 1.5f);
            }
            Theme.Text(g, label, Mx.ButtonText, FontStyle.Regular, color, startX + glyphWidth + gap,
                Theme.CenterY(g, rect.Y, rect.Bottom, Mx.ButtonText, FontStyle.Regular));
        }

        // -- sparkline --------------------------------------------------------
        public static void Sparkline(Graphics g, RectangleF rect, double[] values, bool negative)
        {
            if (values == null || values.Length < 2)
            {
                return;
            }
            double max = double.MinValue, min = double.MaxValue;
            for (int i = 0; i < values.Length; i++)
            {
                if (values[i] > max) max = values[i];
                if (values[i] < min) min = values[i];
            }
            double span = max - min;
            bool flat = span <= 0.000001;

            Color color = negative ? Theme.Chart3 : Theme.Chart2;
            PointF[] points = new PointF[values.Length];
            for (int i = 0; i < values.Length; i++)
            {
                float x = rect.X + rect.Width * i / (float)(values.Length - 1);
                float t = flat ? 0.5f : (float)((values[i] - min) / span);
                points[i] = new PointF(x, rect.Bottom - 3f - t * (rect.Height - 6f));
            }

            using (GraphicsPath line = new GraphicsPath())
            {
                Theme.Smooth(line, points);
                using (GraphicsPath area = (GraphicsPath)line.Clone())
                {
                    area.AddLine(points[points.Length - 1].X, points[points.Length - 1].Y, rect.Right, rect.Bottom);
                    area.AddLine(rect.Right, rect.Bottom, rect.X, rect.Bottom);
                    area.CloseFigure();
                    using (LinearGradientBrush brush = new LinearGradientBrush(
                        new RectangleF(rect.X, rect.Y, rect.Width, rect.Height + 1f),
                        Theme.Alpha(color, 90), Theme.Alpha(color, 0), LinearGradientMode.Vertical))
                    {
                        g.FillPath(brush, area);
                    }
                }
                using (Pen pen = new Pen(color, 1.75f))
                {
                    pen.LineJoin = LineJoin.Round;
                    pen.StartCap = LineCap.Round;
                    pen.EndCap = LineCap.Round;
                    g.DrawPath(pen, line);
                }
            }
        }

        // -- charts -----------------------------------------------------------
        /// <summary>
        /// Recharts with a hidden Y axis computes exactly two horizontal grid
        /// lines: the top and the bottom of the plot band. Measured on the live
        /// chart as strokes at plot.top and plot.top+220.
        /// </summary>
        public static void GridEdges(Graphics g, RectangleF plot)
        {
            Line(g, plot.X, plot.Y, plot.Width, Theme.BorderSoft);
            Line(g, plot.X, plot.Bottom, plot.Width, Theme.BorderSoft);
        }

        /// <summary>Recharts bar chart: rounded top corners, 3px radius.</summary>
        /// <summary>
        /// Recharts band bars. The live chart gives each of the seven days a 75px
        /// band and draws a 60px bar inside it, so the bar is 0.8 of the band.
        /// </summary>
        public static void Bars(Graphics g, RectangleF plot, List<DailyRow> daily, int hoverIndex, float radius)
        {
            if (daily.Count == 0)
            {
                return;
            }
            float slot = plot.Width / daily.Count;
            float barW = slot * 0.8f;
            double max = 1;
            for (int i = 0; i < daily.Count; i++)
            {
                if (daily[i].Requests > max) max = daily[i].Requests;
            }
            for (int i = 0; i < daily.Count; i++)
            {
                float center = plot.X + slot * i + slot / 2f;
                double value = daily[i].Requests;
                if (value <= 0)
                {
                    using (SolidBrush stub = new SolidBrush(Theme.Border))
                    {
                        g.FillRectangle(stub, center - barW / 2f, plot.Bottom - 2f, barW, 2f);
                    }
                    continue;
                }
                float height = (float)(value / max) * (plot.Height - 4f);
                if (height < 3f) height = 3f;
                RectangleF bar = new RectangleF(center - barW / 2f, plot.Bottom - height, barW, height);
                Color fill = i == hoverIndex ? Theme.Alpha(Theme.Chart2, 235) : Theme.Chart2;
                using (GraphicsPath path = Theme.TopRounded(bar, radius))
                using (SolidBrush brush = new SolidBrush(fill))
                {
                    g.FillPath(brush, path);
                }
            }
        }

        /// <summary>Recharts line + gradient area, used by the sparkline/trend charts.</summary>
        public static void LineArea(Graphics g, PointF[] points, RectangleF plot, Color color, bool area, float width)
        {
            if (points == null || points.Length < 2)
            {
                return;
            }
            using (GraphicsPath line = new GraphicsPath())
            {
                Theme.Smooth(line, points);
                if (area)
                {
                    using (GraphicsPath filled = (GraphicsPath)line.Clone())
                    {
                        filled.AddLine(points[points.Length - 1].X, points[points.Length - 1].Y, plot.Right, plot.Bottom);
                        filled.AddLine(plot.Right, plot.Bottom, plot.X, plot.Bottom);
                        filled.CloseFigure();
                        using (LinearGradientBrush brush = new LinearGradientBrush(
                            new RectangleF(plot.X, plot.Y - 4f, plot.Width, plot.Height + 8f),
                            Theme.Alpha(color, 70), Theme.Alpha(color, 0), LinearGradientMode.Vertical))
                        {
                            g.FillPath(brush, filled);
                        }
                    }
                }
                using (Pen pen = new Pen(color, width))
                {
                    pen.LineJoin = LineJoin.Round;
                    pen.StartCap = LineCap.Round;
                    pen.EndCap = LineCap.Round;
                    g.DrawPath(pen, line);
                }
            }
        }

        /// <summary>recharts Pie with innerRadius/outerRadius, paddingAngle 2, no stroke.</summary>
        public static void Donut(Graphics g, RectangleF box, double[] values, Color[] colors)
        {
            double total = 0;
            for (int i = 0; i < values.Length; i++)
            {
                total += values[i];
            }
            if (total <= 0)
            {
                return;
            }
            float size = Math.Min(box.Width, box.Height);
            float outer = size / 2f;
            float inner = outer * (44f / 70f);
            RectangleF outerRect = new RectangleF(box.X + (box.Width - size) / 2f, box.Y + (box.Height - size) / 2f, size, size);
            RectangleF innerRect = new RectangleF(outerRect.X + (outer - inner), outerRect.Y + (outer - inner),
                inner * 2f, inner * 2f);

            float start = -90f;
            for (int i = 0; i < values.Length; i++)
            {
                float sweep = (float)(values[i] / total) * 360f;
                float gap = values.Length > 1 ? 2f : 0f;
                if (sweep - gap > 0.2f)
                {
                    using (GraphicsPath path = new GraphicsPath())
                    {
                        path.AddArc(outerRect, start + gap / 2f, sweep - gap);
                        path.AddArc(innerRect, start + sweep - gap / 2f, -(sweep - gap));
                        path.CloseFigure();
                        using (SolidBrush brush = new SolidBrush(colors[i % colors.Length]))
                        {
                            g.FillPath(brush, path);
                        }
                    }
                }
                start += sweep;
            }
        }

        public static Color[] ChartColors()
        {
            return new Color[] { Theme.Chart1, Theme.Chart2, Theme.Chart3, Theme.Chart4, Theme.Chart5 };
        }

        // -- tables -----------------------------------------------------------
        /// <summary>Column definition for the web's Table component.</summary>
        internal sealed class Column
        {
            public string Label;
            public float Width;
            public bool Right;
            public bool Flex;
            public string SortKey;

            public Column(string label, float width, bool right)
            {
                Label = label;
                Width = width;
                Right = right;
            }

            public Column(string label, float width, bool right, string sortKey)
                : this(label, width, right)
            {
                SortKey = sortKey;
            }

            public static Column Flex2(string label, string sortKey)
            {
                Column column = new Column(label, 0f, false, sortKey);
                column.Flex = true;
                return column;
            }
        }

        /// <summary>Distributes columns across the table width and returns their x positions.</summary>
        public static float[] Layout(Graphics g, RectangleF table, Column[] columns, float inset)
        {
            float available = table.Width - inset * 2f;
            float fixedWidth = 0f;
            for (int i = 0; i < columns.Length; i++)
            {
                if (!columns[i].Flex)
                {
                    fixedWidth += columns[i].Width;
                }
            }
            float flexWidth = 0f;
            int flexCount = 0;
            for (int i = 0; i < columns.Length; i++)
            {
                if (columns[i].Flex)
                {
                    flexCount++;
                }
            }
            if (flexCount > 0)
            {
                flexWidth = Math.Max(60f, (available - fixedWidth) / flexCount);
            }

            float[] xs = new float[columns.Length];
            float cursor = table.X + inset;
            for (int i = 0; i < columns.Length; i++)
            {
                xs[i] = cursor;
                cursor += columns[i].Flex ? flexWidth : columns[i].Width;
            }
            return xs;
        }

        /// <summary>
        /// Sizes columns the way a browser's auto table layout does: each one is as
        /// wide as its widest cell plus that column's padding (ps-6 on the first,
        /// pe-6 on the last, px-2 elsewhere). Nothing is stretched to fill the
        /// card — the web table overflows instead.
        /// </summary>


        /// <summary>
        /// Auto table layout with width:100%: each column starts at its max-content
        /// width and the slack is shared out in proportion to those widths, so the
        /// table fills its container exactly as the browser's does.
        /// </summary>
        public static Column[] AutoLayout(Graphics g, Column[] columns, string[][] cells, float fillWidth)
        {
            Column[] content = ContentLayout(g, columns, cells);
            float total = 0f;
            for (int i = 0; i < content.Length; i++)
            {
                total += content[i].Width;
            }
            if (fillWidth <= 0f || total <= 0f)
            {
                return content;
            }
            float slack = fillWidth - total;
            Column[] sized = new Column[content.Length];
            for (int i = 0; i < content.Length; i++)
            {
                float share = slack > 0f ? slack * (content[i].Width / total) : 0f;
                sized[i] = new Column(content[i].Label, content[i].Width + share, content[i].Right,
                    content[i].SortKey);
            }
            return sized;
        }

        /// <summary>Max-content widths: the widest cell in each column.</summary>
        public static Column[] ContentLayout(Graphics g, Column[] columns, string[][] cells)
        {
            Column[] sized = new Column[columns.Length];
            for (int i = 0; i < columns.Length; i++)
            {
                float padLeft = i == 0 ? 24f : 8f;
                float padRight = i == columns.Length - 1 ? 24f : 8f;
                float width = Theme.Measure(g, columns[i].Label, Mx.Body, FontStyle.Regular);
                if (cells != null && i < cells.Length && cells[i] != null)
                {
                    string[] values = cells[i];
                    for (int c = 0; c < values.Length; c++)
                    {
                        if (string.IsNullOrEmpty(values[c]))
                        {
                            continue;
                        }
                        // The Model cell is font-medium; the rest are plain.
                        float w = i == 0
                            ? Theme.MeasureW(g, values[c], Mx.Body, 500)
                            : Theme.Measure(g, values[c], Mx.Body, FontStyle.Regular);
                        if (w > width)
                        {
                            width = w;
                        }
                    }
                }
                sized[i] = new Column(columns[i].Label, width + padLeft + padRight, columns[i].Right,
                    columns[i].SortKey);
            }
            return sized;
        }

        /// <summary>Places measured columns side by side without stretching them.</summary>
        public static float[] FixedLayout(RectangleF table, Column[] columns, float inset)
        {
            float[] xs = new float[columns.Length];
            float cursor = table.X + inset;
            for (int i = 0; i < columns.Length; i++)
            {
                xs[i] = cursor;
                cursor += columns[i].Width;
            }
            return xs;
        }

        public static float ColumnEnd(float[] xs, Column[] columns, int index)
        {
            if (index + 1 < xs.Length && columns[index].Flex)
            {
                return xs[index + 1];
            }
            return xs[index] + columns[index].Width;
        }

        /// <summary>
        /// Table head cell. The web's TableHead carries px-2 with ps-6 on the
        /// first column and pe-6 on the last, so the header text lines up with
        /// the body cells rather than sitting on the column edge.
        /// </summary>
        public static void Head(Graphics g, RectangleF cell, Column column, string sortKey, bool sortAsc,
            bool hover, float padLeft, float padRight)
        {
            bool active = sortKey == column.SortKey && !string.IsNullOrEmpty(column.SortKey);
            Color color = active || hover ? Theme.Fg : Theme.Muted;
            float width = Theme.Measure(g, column.Label, Mx.Body, FontStyle.Regular);
            bool hasArrow = active;
            float arrowW = hasArrow ? 14f : 0f;
            float total = width + arrowW;
            float left = cell.X + padLeft;
            float right = cell.Right - padRight;
            float x = column.Right ? right - total : left;
            Theme.TextW(g, column.Label, Mx.Body, 500, color, x,
                Theme.CenterY(g, cell.Y, cell.Y + Mx.HeadH, Mx.Body, FontStyle.Regular));
            if (hasArrow)
            {
                Glyph.Draw(g, sortAsc ? "arrow-up" : "arrow-down",
                    new RectangleF(x + width + 2f, cell.Y + (Mx.HeadH - 12f) / 2f, 12f, 12f), Theme.Muted, 1.4f);
            }
        }

        public static void HeadRight(Graphics g, RectangleF cell, string label)
        {
            Theme.TextRight(g, label, Mx.Body, FontStyle.Regular, Theme.Fg, cell.Right,
                Theme.CenterY(g, cell.Y, cell.Y + Mx.HeadH, Mx.Body, FontStyle.Regular));
        }

        // -- misc -------------------------------------------------------------
        public static void Empty(Graphics g, RectangleF area, string glyph, string title, string description)
        {
            float centerX = area.X + area.Width / 2f;
            float y = area.Y + Math.Max(12f, area.Height / 2f - 52f);
            Glyph.Draw(g, glyph, new RectangleF(centerX - 10f, y, 20f, 20f), Theme.Muted, 1.6f);
            Theme.TextCenter(g, title, Mx.CardTitle, FontStyle.Regular, Theme.Fg, centerX, y + 30f);
            string line = Theme.Fit(g, description, Mx.Body, FontStyle.Regular, area.Width - 32f);
            Theme.TextCenter(g, line, Mx.Body, FontStyle.Regular, Theme.Muted, centerX, y + 54f);
        }

        public static Color StatusDot(string status, bool isRouter)
        {
            if (isRouter)
            {
                return status == "live" ? Theme.Emerald : Theme.Red;
            }
            return Theme.Emerald;
        }

        public static string Share(double value, double total)
        {
            if (total <= 0) return "0%";
            return Math.Round(value / total * 100.0).ToString("0", Inv) + "%";
        }
    }
}
