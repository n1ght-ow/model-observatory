using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Text;
using System.Globalization;
using System.Windows.Forms;

namespace RouterMonitorTray
{
    /// <summary>
    /// The tray panel speaks the exact same visual language as the web
    /// dashboard. Every colour below is the sRGB rendering of a token in
    /// src/app/globals.css, so a screenshot of the flyout and a screenshot of
    /// the browser page share their palette — in both the dark and the light
    /// theme.
    ///
    /// Text is measured and drawn with pixel-unit fonts, so all sizes are the
    /// same "CSS pixel" numbers the web uses and the layout is DPI independent.
    /// </summary>
    internal static class Theme
    {
        // -- tokens -----------------------------------------------------------
        /// <summary>
        /// The web app stores "light" unless the user picks dark (see
        /// theme-provider.tsx), so light is the surface the dashboard actually
        /// shows by default — and the surface the reference screenshots show.
        /// </summary>
        public static bool Dark;

        public static Color Bg;             // --background
        public static Color Card;           // --card
        public static Color Fg;             // --foreground
        public static Color Muted;          // --muted-foreground
        public static Color Secondary;      // --secondary / --muted / --accent
        public static Color Border;         // --border
        public static Color BorderSoft;
        public static Color TileRing;       // ring-foreground/10, drawn over --background
        public static Color Input;          // --input
        public static Color Primary;        // --primary
        public static Color PrimaryFg;      // --primary-foreground
        public static Color Ring;           // --ring
        public static Color Sidebar;        // --sidebar
        public static Color SidebarAccent;  // --sidebar-accent

        public static Color Chart1;         // tokens
        public static Color Chart2;         // requests
        public static Color Chart3;         // successful
        public static Color Chart4;
        public static Color Chart5;

        public static Color Emerald;
        public static Color Red;
        public static Color Amber;
        /// <summary>amber-500, fixed across themes — used by the staleness banner.</summary>
        public static readonly Color Amber500 = Color.FromArgb(255, 245, 158, 11);
        /// <summary>amber-700 in light, amber-400 in dark: the banner's text.</summary>
        public static Color AmberInk;
        public static Color EmeraldSoft;    // emerald-500/10 over bg
        public static Color RedSoft;        // red-500/10 over bg
        public static Color MutedSoft;
        public static Color Destructive;
        public static Color DeltaUp;        // emerald-600 / dark:emerald-400
        public static Color DeltaDown;      // rose-600 / dark:rose-400

        static Theme()
        {
            ApplyLight();
        }

        public static void ApplyDark()
        {
            Dark = true;
            Bg = Color.FromArgb(10, 10, 10);            // oklch(0.145 0 0)
            Card = Color.FromArgb(23, 23, 23);          // oklch(0.205 0 0)
            Fg = Color.FromArgb(250, 250, 250);         // oklch(0.985 0 0)
            Muted = Color.FromArgb(161, 161, 161);      // oklch(0.708 0 0)
            Secondary = Color.FromArgb(38, 38, 38);     // oklch(0.269 0 0)
            Border = Color.FromArgb(35, 35, 35);        // white/10 over bg
            BorderSoft = Color.FromArgb(25, 25, 25);
            TileRing = Color.FromArgb(34, 34, 34);      // foreground/10 over --background
            Input = Color.FromArgb(47, 47, 47);         // white/15 over bg
            Primary = Color.FromArgb(229, 229, 229);    // oklch(0.922 0 0)
            PrimaryFg = Color.FromArgb(38, 38, 38);     // oklch(0.205 0 0)
            Ring = Color.FromArgb(115, 115, 115);       // oklch(0.556 0 0)
            Sidebar = Color.FromArgb(23, 23, 23);       // oklch(0.205 0 0)
            SidebarAccent = Color.FromArgb(38, 38, 38); // oklch(0.269 0 0)

            Chart1 = Color.FromArgb(100, 164, 255);     // oklch(0.72 0.16 259)
            Chart2 = Color.FromArgb(121, 130, 254);     // oklch(0.66 0.18 277)
            Chart3 = Color.FromArgb(48, 199, 141);      // oklch(0.74 0.15 162)
            Chart4 = Color.FromArgb(243, 169, 73);      // oklch(0.79 0.14 70)
            Chart5 = Color.FromArgb(254, 97, 117);      // oklch(0.7 0.19 16)

            Emerald = Color.FromArgb(16, 185, 129);
            Red = Color.FromArgb(239, 68, 68);
            Amber = Color.FromArgb(245, 158, 11);
            AmberInk = Color.FromArgb(251, 191, 36);    // amber-400
            EmeraldSoft = Color.FromArgb(11, 28, 22);
            RedSoft = Color.FromArgb(33, 16, 16);
            MutedSoft = Color.FromArgb(29, 29, 29);
            Destructive = Color.FromArgb(255, 100, 103); // oklch(0.704 0.191 22.2)
            DeltaUp = Color.FromArgb(52, 211, 153);      // emerald-400
            DeltaDown = Color.FromArgb(251, 113, 133);   // rose-400
        }

        public static void ApplyLight()
        {
            Dark = false;
            Bg = Color.FromArgb(255, 255, 255);
            Card = Color.FromArgb(255, 255, 255);
            Fg = Color.FromArgb(10, 10, 10);
            Muted = Color.FromArgb(115, 115, 115);      // oklch(0.556 0 0)
            Secondary = Color.FromArgb(245, 245, 245);  // oklch(0.97 0 0)
            Border = Color.FromArgb(229, 229, 229);     // oklch(0.922 0 0)
            BorderSoft = Color.FromArgb(240, 240, 240);
            TileRing = Color.FromArgb(230, 230, 230);
            Input = Color.FromArgb(229, 229, 229);
            Primary = Color.FromArgb(23, 23, 23);       // oklch(0.205 0 0)
            PrimaryFg = Color.FromArgb(250, 250, 250);
            Ring = Color.FromArgb(161, 161, 161);       // oklch(0.708 0 0)
            Sidebar = Color.FromArgb(250, 250, 250);    // oklch(0.985 0 0)
            SidebarAccent = Color.FromArgb(245, 245, 245);

            Chart1 = Color.FromArgb(37, 99, 235);       // oklch(0.62 0.19 259)
            Chart2 = Color.FromArgb(79, 70, 229);       // oklch(0.55 0.2 277)
            Chart3 = Color.FromArgb(5, 150, 105);       // oklch(0.64 0.17 162)
            Chart4 = Color.FromArgb(217, 119, 6);       // oklch(0.72 0.16 70)
            Chart5 = Color.FromArgb(225, 29, 72);       // oklch(0.6 0.22 16)

            Emerald = Color.FromArgb(5, 150, 105);
            Red = Color.FromArgb(220, 38, 38);
            Amber = Color.FromArgb(217, 119, 6);
            EmeraldSoft = Color.FromArgb(236, 253, 245);
            AmberInk = Color.FromArgb(180, 83, 9);      // amber-700
            RedSoft = Color.FromArgb(254, 242, 242);
            MutedSoft = Color.FromArgb(245, 245, 245);
            Destructive = Color.FromArgb(231, 0, 11);   // oklch(0.577 0.245 27.3)
            DeltaUp = Color.FromArgb(5, 150, 105);      // emerald-600
            DeltaDown = Color.FromArgb(225, 29, 72);    // rose-600
        }

        public static void SetDark(bool dark)
        {
            if (dark == Dark)
            {
                return;
            }
            if (dark)
            {
                ApplyDark();
            }
            else
            {
                ApplyLight();
            }
        }

        public static Color Alpha(Color color, int alpha)
        {
            return Color.FromArgb(alpha, color.R, color.G, color.B);
        }

        // -- fonts ------------------------------------------------------------
        // The panel draws in Geist, the same face next/font bundles for the web
        // (the static instances are embedded; see scripts\generate-tray-fonts.py).
        // Microsoft YaHei UI covers the CJK that shows up in model names.
        private static readonly string[] GeistFamilies = new string[]
        {
            "Geist", "Geist Medium", "Geist SemiBold", "Geist Bold"
        };

        private static readonly string[] LatinFamilies = new string[]
        {
            "Segoe UI", "Segoe UI Variable Text", "Tahoma", "Arial"
        };

        private static readonly string[] CjkFamilies = new string[]
        {
            "Microsoft YaHei UI", "Microsoft YaHei", "SimSun", "Segoe UI"
        };

        private static readonly string[] MonoFamilies = new string[]
        {
            "Cascadia Mono", "Consolas", "Courier New"
        };

        private static readonly Dictionary<string, Font> Fonts = new Dictionary<string, Font>();

        /// <summary>
        /// The Geist face nearest the requested style: Bold maps to the 700
        /// instance, everything else to the 400 one.
        /// </summary>
        private static Font Geist(float px, FontStyle style)
        {
            return GeistFace(px, style == FontStyle.Bold ? 700 : 400);
        }

        /// <summary>
        /// The embedded Geist face for a CSS font weight. The web sets weights
        /// 400/500/600 explicitly (font-normal / font-medium / font-semibold), which
        /// is why the four static instances exist.
        /// </summary>
        public static Font GeistFace(float px, int weight)
        {
            if (Fonts_Find("Geist") == null)
            {
                return null;
            }
            string key = "w" + weight + "|" + px.ToString("0.##", CultureInfo.InvariantCulture);
            Font font;
            if (Fonts.TryGetValue(key, out font))
            {
                return font;
            }
            string family = weight >= 700 ? "Geist Bold"
                : weight >= 600 ? "Geist SemiBold"
                : weight >= 500 ? "Geist Medium"
                : "Geist";
            FontFamily found = Fonts_Find(family) ?? Fonts_Find("Geist");
            try
            {
                font = new Font(found, px, FontStyle.Regular, GraphicsUnit.Pixel);
            }
            catch
            {
                return null;
            }
            Fonts[key] = font;
            return font;
        }

        /// <summary>Text width at an explicit CSS font weight.</summary>
        public static float MeasureW(Graphics g, string text, float px, int weight)
        {
            if (string.IsNullOrEmpty(text))
            {
                return 0f;
            }
            string key = "mw" + weight + "|" + px.ToString("0.##", CultureInfo.InvariantCulture) + "|" + text;
            float width;
            if (Widths.TryGetValue(key, out width))
            {
                return width;
            }
            GraphicsState state = g.Save();
            g.ResetTransform();
            float total = 0f;
            Run[] runs = Split(text);
            for (int i = 0; i < runs.Length; i++)
            {
                Font runFont = runs[i].Cjk ? Get(px, weight >= 600 ? FontStyle.Bold : FontStyle.Regular, true)
                    : (GeistFace(px, weight) ?? Get(px, FontStyle.Regular, false));
                total += g.MeasureString(runs[i].Text, runFont, new PointF(0f, 0f), Tight).Width;
                if (!runs[i].Cjk)
                {
                    total += KernSum(runs[i].Text, weight, px);
                }
            }
            g.Restore(state);
            if (Widths.Count > 12000)
            {
                Widths.Clear();
            }
            Widths[key] = total;
            return total;
        }

        /// <summary>Draws text at an explicit CSS font weight.</summary>
        /// <summary>
        /// How far GDI+ places a run's ink above where the browser puts it.
        ///
        /// The browser centres each run's glyph box inside its line box (half
        /// leading), while DrawString anchors on the font's ascent. Measured
        /// against the reference screenshots, the difference is zero at 12px and
        /// 14px and grows with the line box: +2 at 16px, +3 at 20px, and -4 at
        /// 24px, where GDI+ overshoots the other way. Adding this to the draw y
        /// puts the ink on the same row as the browser's.
        /// </summary>
        public static float InkShift(float px)
        {
            if (px >= 24f) return -4f;
            if (px >= 20f) return 3f;
            if (px >= 16f) return 2f;
            return 0f;
        }

        public static void TextW(Graphics g, string text, float px, int weight, Color color, float x, float y)
        {
            if (string.IsNullOrEmpty(text))
            {
                return;
            }
            Run[] runs = Split(text);
            using (SolidBrush brush = new SolidBrush(color))
            {
                float cursor = x;
                float ink = y + InkShift(px);
                for (int i = 0; i < runs.Length; i++)
                {
                    Font runFont = runs[i].Cjk ? Get(px, weight >= 600 ? FontStyle.Bold : FontStyle.Regular, true)
                        : (GeistFace(px, weight) ?? Get(px, FontStyle.Regular, false));
                    // The run is drawn in one call and the cursor advances by the
                    // kerned width. Drawing glyph by glyph instead measures worse
                    // against the browser: GDI+ grid-fits each character's origin
                    // separately, which costs more than the pair adjustments save.
                    g.DrawString(runs[i].Text, runFont, brush, cursor, ink, Tight);
                    float runWidth = g.MeasureString(runs[i].Text, runFont, new PointF(0f, 0f), Tight).Width;
                    cursor += runs[i].Cjk ? runWidth : runWidth + KernSum(runs[i].Text, weight, px);
                }
            }
        }

        /// <summary>The named static Geist face, at an explicit weight.</summary>
        public static Font GetSans(float px, int weight)
        {
            string family = weight >= 700 ? "Geist Bold"
                : weight >= 600 ? "Geist SemiBold"
                : weight >= 500 ? "Geist Medium"
                : "Geist";
            string key = "g" + weight + "|" + px.ToString("0.##", CultureInfo.InvariantCulture);
            Font font;
            if (Fonts.TryGetValue(key, out font))
            {
                return font;
            }
            FontFamily found = Fonts_Find(family);
            Font built;
            try
            {
                built = found != null
                    ? new Font(found, px, FontStyle.Regular, GraphicsUnit.Pixel)
                    : new Font(LatinFamilies[0], px, weight >= 600 ? FontStyle.Bold : FontStyle.Regular,
                        GraphicsUnit.Pixel);
            }
            catch
            {
                built = new Font(FontFamily.GenericSansSerif, px, FontStyle.Regular, GraphicsUnit.Pixel);
            }
            Fonts[key] = built;
            return built;
        }

        private static FontFamily Fonts_Find(string family)
        {
            return RouterMonitorTray.Fonts.Find(family);
        }

        public static Font Get(float px, FontStyle style, bool cjk)
        {
            string key = (cjk ? "c" : "l") + "|" + px.ToString("0.##", CultureInfo.InvariantCulture) + "|" + (int)style;
            Font font;
            if (Fonts.TryGetValue(key, out font))
            {
                return font;
            }

            if (!cjk)
            {
                Font geist = Geist(px, style);
                if (geist != null)
                {
                    Fonts[key] = geist;
                    return geist;
                }
            }

            string[] families = cjk ? CjkFamilies : LatinFamilies;
            for (int i = 0; i < families.Length; i++)
            {
                try
                {
                    Font probe = new Font(families[i], px, style, GraphicsUnit.Pixel);
                    if (string.Equals(probe.Name, families[i], StringComparison.OrdinalIgnoreCase))
                    {
                        Fonts[key] = probe;
                        return probe;
                    }
                    probe.Dispose();
                }
                catch
                {
                }
            }

            Font fallback = new Font(FontFamily.GenericSansSerif, px, style, GraphicsUnit.Pixel);
            Fonts[key] = fallback;
            return fallback;
        }

        // -- tabular figures ---------------------------------------------------
        // The web marks nearly every number tabular-nums. Geist's default figures
        // are proportional (a '1' advances 384/1000 em, a '0' 663), and its tnum
        // feature substitutes all ten digits with 600/1000 em alternates. GDI+
        // cannot enable OpenType features, so digit runs are positioned at that
        // fixed advance and drawn one at a time.
        private const float TabularDigitEm = 0.6f;

        private static bool IsDigit(char c)
        {
            return c >= '0' && c <= '9';
        }

        /// <summary>Width of text with tabular figures.</summary>
        public static float MeasureT(Graphics g, string text, float px, FontStyle style)
        {
            if (string.IsNullOrEmpty(text))
            {
                return 0f;
            }
            string key = "T" + (int)style + "|" + px.ToString("0.##", CultureInfo.InvariantCulture) + "|" + text;
            float width;
            if (Widths.TryGetValue(key, out width))
            {
                return width;
            }
            float digit = TabularDigitEm * px;
            float total = 0f;
            int i = 0;
            while (i < text.Length)
            {
                if (IsDigit(text[i]))
                {
                    int start = i;
                    while (i < text.Length && IsDigit(text[i]))
                    {
                        i++;
                    }
                    total += digit * (i - start);
                }
                else
                {
                    int start = i;
                    while (i < text.Length && !IsDigit(text[i]))
                    {
                        i++;
                    }
                    total += Measure(g, text.Substring(start, i - start), px, style);
                }
            }
            if (Widths.Count > 12000)
            {
                Widths.Clear();
            }
            Widths[key] = total;
            return total;
        }

        /// <summary>Draws text with tabular figures.</summary>
        public static void TextT(Graphics g, string text, float px, FontStyle style, Color color, float x, float y)
        {
            if (string.IsNullOrEmpty(text))
            {
                return;
            }
            Font font = Get(px, style, false);
            float digit = TabularDigitEm * px;
            using (SolidBrush brush = new SolidBrush(color))
            {
                float cursor = x;
                float ink = y + InkShift(px);
                int i = 0;
                while (i < text.Length)
                {
                    if (IsDigit(text[i]))
                    {
                        while (i < text.Length && IsDigit(text[i]))
                        {
                            g.DrawString(text[i].ToString(), font, brush, cursor, ink, Tight);
                            cursor += digit;
                            i++;
                        }
                    }
                    else
                    {
                        int start = i;
                        while (i < text.Length && !IsDigit(text[i]))
                        {
                            i++;
                        }
                        string run = text.Substring(start, i - start);
                        g.DrawString(run, font, brush, cursor, ink, Tight);
                        cursor += Measure(g, run, px, style);
                    }
                }
            }
        }

        public static void TextTRight(Graphics g, string text, float px, FontStyle style, Color color, float right, float y)
        {
            TextT(g, text, px, style, color, right - MeasureT(g, text, px, style), y);
        }

        public static string FitT(Graphics g, string text, float px, FontStyle style, float maxWidth)
        {
            if (string.IsNullOrEmpty(text) || MeasureT(g, text, px, style) <= maxWidth)
            {
                return text;
            }
            for (int length = text.Length - 1; length > 0; length--)
            {
                string probe = text.Substring(0, length) + "\u2026";
                if (MeasureT(g, probe, px, style) <= maxWidth)
                {
                    return probe;
                }
            }
            return "";
        }

        public static Font Mono(float px, FontStyle style)
        {
            string key = "m|" + px.ToString("0.##", CultureInfo.InvariantCulture) + "|" + (int)style;
            Font font;
            if (Fonts.TryGetValue(key, out font))
            {
                return font;
            }
            for (int i = 0; i < MonoFamilies.Length; i++)
            {
                try
                {
                    Font probe = new Font(MonoFamilies[i], px, style, GraphicsUnit.Pixel);
                    if (string.Equals(probe.Name, MonoFamilies[i], StringComparison.OrdinalIgnoreCase))
                    {
                        Fonts[key] = probe;
                        return probe;
                    }
                    probe.Dispose();
                }
                catch
                {
                }
            }
            Font fallback = new Font(FontFamily.GenericMonospace, px, style, GraphicsUnit.Pixel);
            Fonts[key] = fallback;
            return fallback;
        }

        // -- text runs --------------------------------------------------------
        internal struct Run
        {
            public string Text;
            public bool Cjk;
        }

        private static readonly Dictionary<string, Run[]> RunCache = new Dictionary<string, Run[]>();

        public static bool IsCjk(char c)
        {
            return (c >= (char)0x2E80 && c <= (char)0x9FFF)
                || (c >= (char)0x3000 && c <= (char)0x303F)
                || (c >= (char)0xF900 && c <= (char)0xFAFF)
                || (c >= (char)0xFE30 && c <= (char)0xFE4F)
                || (c >= (char)0xFF00 && c <= (char)0xFFEF);
        }

        public static Run[] Split(string text)
        {
            if (string.IsNullOrEmpty(text))
            {
                return new Run[0];
            }

            Run[] cached;
            if (RunCache.TryGetValue(text, out cached))
            {
                return cached;
            }

            List<Run> runs = new List<Run>();
            int start = 0;
            bool current = IsCjk(text[0]);
            for (int i = 1; i < text.Length; i++)
            {
                bool cjk = IsCjk(text[i]);
                if (cjk != current)
                {
                    Run run = new Run();
                    run.Text = text.Substring(start, i - start);
                    run.Cjk = current;
                    runs.Add(run);
                    start = i;
                    current = cjk;
                }
            }
            Run last = new Run();
            last.Text = text.Substring(start);
            last.Cjk = current;
            runs.Add(last);

            Run[] result = runs.ToArray();
            if (RunCache.Count > 4000)
            {
                RunCache.Clear();
            }
            RunCache[text] = result;
            return result;
        }

        private static readonly StringFormat Tight = new StringFormat(StringFormat.GenericTypographic)
        {
            Alignment = StringAlignment.Near,
            LineAlignment = StringAlignment.Near,
            FormatFlags = StringFormatFlags.NoWrap | StringFormatFlags.NoClip
        };

        private static readonly Dictionary<string, float> Widths = new Dictionary<string, float>();

        // -- kerning ----------------------------------------------------------
        // GDI+ reads only the legacy kern table and Geist keeps its kerning in
        // GPOS, so every Latin run came out about 2% wide and paragraphs wrapped
        // in the wrong place. Kerning.Pixels carries the pair adjustments that
        // scripts/generate-tray-kerning.py extracted from the font.

        /// <summary>Total kerning adjustment for a run, in pixels.</summary>
        public static float KernSum(string text, int weight, float px)
        {
            float total = 0f;
            for (int i = 0; i + 1 < text.Length; i++)
            {
                total += Kerning.Pixels(weight, text[i], text[i + 1], px);
            }
            return total;
        }

        /// <summary>Whether any adjacent pair in the run is kerned.</summary>
        public static bool HasKerning(string text, int weight)
        {
            for (int i = 0; i + 1 < text.Length; i++)
            {
                if (Kerning.Pair(weight, text[i], text[i + 1]) != 0)
                {
                    return true;
                }
            }
            return false;
        }

        /// <summary>Width of the text in layout units (CSS pixels).</summary>
        public static float Measure(Graphics g, string text, float px, FontStyle style)
        {
            if (string.IsNullOrEmpty(text))
            {
                return 0f;
            }

            string key = px.ToString("0.##", CultureInfo.InvariantCulture) + "|" + (int)style + "|" + text;
            float width;
            if (Widths.TryGetValue(key, out width))
            {
                return width;
            }

            Run[] runs = Split(text);
            GraphicsState state = g.Save();
            g.ResetTransform();
            float total = 0f;
            for (int i = 0; i < runs.Length; i++)
            {
                Font font = Get(px, style, runs[i].Cjk);
                total += g.MeasureString(runs[i].Text, font, new PointF(0f, 0f), Tight).Width;
                if (!runs[i].Cjk)
                {
                    total += KernSum(runs[i].Text, WeightOf(style), px);
                }
            }
            g.Restore(state);

            if (Widths.Count > 12000)
            {
                Widths.Clear();
            }
            Widths[key] = total;
            return total;
        }

        /// <summary>Width of monospaced text in layout units.</summary>
        public static float MeasureMono(Graphics g, string text, float px, FontStyle style)
        {
            if (string.IsNullOrEmpty(text))
            {
                return 0f;
            }
            GraphicsState state = g.Save();
            g.ResetTransform();
            float width = g.MeasureString(text, Mono(px, style), new PointF(0f, 0f), Tight).Width;
            g.Restore(state);
            return width;
        }

        /// <summary>Draws text with its line box top at (x, y).</summary>
        public static void Text(Graphics g, string text, float px, FontStyle style, Color color, float x, float y)
        {
            if (string.IsNullOrEmpty(text))
            {
                return;
            }
            Run[] runs = Split(text);
            using (SolidBrush brush = new SolidBrush(color))
            {
                float cursor = x;
                float ink = y + InkShift(px);

                for (int i = 0; i < runs.Length; i++)
                {
                    Font font = Get(px, style, runs[i].Cjk);
                    // Drawn as one run: splitting a Latin run into single
                    // characters makes GDI+ grid-fit each origin separately, and
                    // StringFormat.Tight trims a lone space to zero width, which
                    // jammed words together. Kerning is applied to the advance
                    // instead, which is what fixes where a paragraph wraps.
                    g.DrawString(runs[i].Text, font, brush, cursor, ink, Tight);
                    float runWidth = g.MeasureString(runs[i].Text, font, new PointF(0f, 0f), Tight).Width;
                    cursor += runs[i].Cjk
                        ? runWidth
                        : runWidth + KernSum(runs[i].Text, WeightOf(style), px);
                }
            }
        }

        public static void TextMono(Graphics g, string text, float px, FontStyle style, Color color, float x, float y)
        {
            if (string.IsNullOrEmpty(text))
            {
                return;
            }
            Font font = Mono(px, style);
            using (SolidBrush brush = new SolidBrush(color))
            {
                g.DrawString(text, font, brush, x, y + InkShift(px), Tight);
            }
        }

        public static void TextRight(Graphics g, string text, float px, FontStyle style, Color color, float right, float y)
        {
            Text(g, text, px, style, color, right - Measure(g, text, px, style), y);
        }

        public static void TextRightW(Graphics g, string text, float px, int weight, Color color, float right, float y)
        {
            TextW(g, text, px, weight, color, right - MeasureW(g, text, px, weight), y);
        }

        public static void TextCenterW(Graphics g, string text, float px, int weight, Color color, float centerX, float y)
        {
            TextW(g, text, px, weight, color, centerX - MeasureW(g, text, px, weight) / 2f, y);
        }

        /// <summary>CSS weight for a FontStyle, for call sites that still pass one.</summary>
        public static int WeightOf(FontStyle style)
        {
            return style == FontStyle.Bold ? 700 : 400;
        }

        public static void TextCenter(Graphics g, string text, float px, FontStyle style, Color color, float centerX, float y)
        {
            Text(g, text, px, style, color, centerX - Measure(g, text, px, style) / 2f, y);
        }

        /// <summary>Line height of a pixel-unit font, which is what layout math wants.</summary>
        public static float LineHeight(Graphics g, float px, FontStyle style)
        {
            Font font = Get(px, style, false);
            GraphicsState state = g.Save();
            g.ResetTransform();
            float height = font.GetHeight(g);
            g.Restore(state);
            return height;
        }

        /// <summary>Vertical offset that centres a line of text inside [top, bottom].</summary>
        public static float CenterY(Graphics g, float top, float bottom, float px, FontStyle style)
        {
            return top + (bottom - top - LineHeight(g, px, style)) / 2f;
        }

        /// <summary>Truncates with a real ellipsis so text never bleeds out of a card.</summary>
        /// <summary>
        /// Word-wraps text to a width, returning the lines. Used for the few
        /// descriptions long enough that the browser breaks them onto several
        /// lines rather than clipping (the card header has a fixed line count).
        /// </summary>
        public static List<string> Wrap(Graphics g, string text, float px, FontStyle style, float maxWidth,
            int maxLines)
        {
            List<string> lines = new List<string>();
            if (string.IsNullOrEmpty(text))
            {
                return lines;
            }
            string[] words = text.Split(' ');
            string current = "";
            for (int i = 0; i < words.Length; i++)
            {
                string candidate = current.Length == 0 ? words[i] : current + " " + words[i];
                if (Measure(g, candidate, px, style) <= maxWidth || current.Length == 0)
                {
                    current = candidate;
                    continue;
                }
                lines.Add(current);
                current = words[i];
                if (lines.Count == maxLines - 1)
                {
                    // Last permitted line: take the rest and clip it if needed.
                    string rest = current;
                    for (int j = i + 1; j < words.Length; j++)
                    {
                        rest += " " + words[j];
                    }
                    lines.Add(Fit(g, rest, px, style, maxWidth));
                    return lines;
                }
            }
            if (current.Length > 0)
            {
                lines.Add(current);
            }
            return lines;
        }

        /// <summary>Truncates at an explicit CSS font weight.</summary>
        public static string FitW(Graphics g, string text, float px, int weight, float maxWidth)
        {
            if (string.IsNullOrEmpty(text) || MeasureW(g, text, px, weight) <= maxWidth)
            {
                return text;
            }
            for (int length = text.Length - 1; length > 0; length--)
            {
                string probe = text.Substring(0, length) + "\u2026";
                if (MeasureW(g, probe, px, weight) <= maxWidth)
                {
                    return probe;
                }
            }
            return "";
        }

        public static string Fit(Graphics g, string text, float px, FontStyle style, float maxWidth)
        {
            if (string.IsNullOrEmpty(text) || Measure(g, text, px, style) <= maxWidth)
            {
                return text;
            }
            for (int length = text.Length - 1; length > 0; length--)
            {
                string probe = text.Substring(0, length) + "\u2026";
                if (Measure(g, probe, px, style) <= maxWidth)
                {
                    return probe;
                }
            }
            return "";
        }

        // -- shapes -----------------------------------------------------------
        public static GraphicsPath Rounded(RectangleF rect, float radius)
        {
            GraphicsPath path = new GraphicsPath();
            float limit = Math.Min(rect.Width, rect.Height) / 2f;
            float r = Math.Max(0f, Math.Min(radius, limit));
            if (r <= 0.01f)
            {
                path.AddRectangle(rect);
                path.CloseFigure();
                return path;
            }
            float d = r * 2f;
            path.AddArc(rect.X, rect.Y, d, d, 180f, 90f);
            path.AddArc(rect.Right - d, rect.Y, d, d, 270f, 90f);
            path.AddArc(rect.Right - d, rect.Bottom - d, d, d, 0f, 90f);
            path.AddArc(rect.X, rect.Bottom - d, d, d, 90f, 90f);
            path.CloseFigure();
            return path;
        }

        /// <summary>Bar with rounded top corners only, like recharts radius=[3,3,0,0].</summary>
        public static GraphicsPath TopRounded(RectangleF rect, float radius)
        {
            GraphicsPath path = new GraphicsPath();
            float r = Math.Max(0f, Math.Min(radius, Math.Min(rect.Width / 2f, rect.Height)));
            if (r <= 0.01f)
            {
                path.AddRectangle(rect);
                path.CloseFigure();
                return path;
            }
            float d = r * 2f;
            path.AddLine(rect.X, rect.Bottom, rect.X, rect.Y + r);
            path.AddArc(rect.X, rect.Y, d, d, 180f, 90f);
            path.AddLine(rect.X + r, rect.Y, rect.Right - r, rect.Y);
            path.AddArc(rect.Right - d, rect.Y, d, d, 270f, 90f);
            path.AddLine(rect.Right, rect.Y + r, rect.Right, rect.Bottom);
            path.CloseFigure();
            return path;
        }

        public static void Fill(Graphics g, RectangleF rect, float radius, Color color)
        {
            if (rect.Width <= 0f || rect.Height <= 0f || color.A == 0)
            {
                return;
            }
            using (GraphicsPath path = Rounded(rect, radius))
            using (SolidBrush brush = new SolidBrush(color))
            {
                g.FillPath(brush, path);
            }
        }

        public static void FillRect(Graphics g, RectangleF rect, Color color)
        {
            if (rect.Width <= 0f || rect.Height <= 0f || color.A == 0)
            {
                return;
            }
            using (SolidBrush brush = new SolidBrush(color))
            {
                g.FillRectangle(brush, rect);
            }
        }

        public static void Stroke(Graphics g, RectangleF rect, float radius, Color color, float width)
        {
            using (GraphicsPath path = Rounded(rect, radius))
            using (Pen pen = new Pen(color, width))
            {
                g.DrawPath(pen, path);
            }
        }

        public static void Pill(Graphics g, RectangleF rect, Color fill, Color edge)
        {
            float r = rect.Height / 2f;
            Fill(g, rect, r, fill);
            if (edge.A > 0)
            {
                Stroke(g, rect, r, edge, 1f);
            }
        }

        /// <summary>Monotone cubic curve, the same interpolation the web charts use.</summary>
        public static void Smooth(GraphicsPath path, PointF[] points)
        {
            int n = points.Length;
            if (n == 0)
            {
                return;
            }
            if (n == 1)
            {
                path.AddLine(points[0].X, points[0].Y - 0.01f, points[0].X, points[0].Y);
                return;
            }

            float[] dx = new float[n - 1];
            float[] slope = new float[n - 1];
            float[] m = new float[n];
            for (int i = 0; i < n - 1; i++)
            {
                dx[i] = points[i + 1].X - points[i].X;
                slope[i] = dx[i] == 0f ? 0f : (points[i + 1].Y - points[i].Y) / dx[i];
            }
            m[0] = slope[0];
            m[n - 1] = slope[n - 2];
            for (int i = 1; i < n - 1; i++)
            {
                if (slope[i - 1] * slope[i] <= 0f)
                {
                    m[i] = 0f;
                }
                else
                {
                    m[i] = (slope[i - 1] + slope[i]) / 2f;
                }
            }
            for (int i = 0; i < n - 1; i++)
            {
                if (slope[i] == 0f)
                {
                    m[i] = 0f;
                    m[i + 1] = 0f;
                    continue;
                }
                float a = m[i] / slope[i];
                float b = m[i + 1] / slope[i];
                float s = a * a + b * b;
                if (s > 9f)
                {
                    float t = 3f / (float)Math.Sqrt(s);
                    m[i] = t * a * slope[i];
                    m[i + 1] = t * b * slope[i];
                }
            }

            path.AddLine(points[0].X, points[0].Y, points[0].X, points[0].Y);
            for (int i = 0; i < n - 1; i++)
            {
                float c1x = points[i].X + dx[i] / 3f;
                float c1y = points[i].Y + m[i] * dx[i] / 3f;
                float c2x = points[i + 1].X - dx[i] / 3f;
                float c2y = points[i + 1].Y - m[i + 1] * dx[i] / 3f;
                path.AddBezier(points[i].X, points[i].Y, c1x, c1y, c2x, c2y, points[i + 1].X, points[i + 1].Y);
            }
        }

        // -- formatting -------------------------------------------------------
        private static readonly CultureInfo Inv = CultureInfo.InvariantCulture;

        public static Color StatusColor(string status)
        {
            switch (status)
            {
                case "live": return Emerald;
                case "syncing": return Amber;
                case "error": return Red;
                default: return Muted;
            }
        }

        /// <summary>Badge wording, matching the web's SourceStatusCard.</summary>
        public static string StatusText(string status, bool isRouter)
        {
            if (isRouter)
            {
                return status == "live" ? "online" : "unreachable";
            }
            return "session sync";
        }

        public static string Weekday(string iso)
        {
            DateTime parsed;
            if (!string.IsNullOrEmpty(iso) && DateTime.TryParseExact(iso, "yyyy-MM-dd", Inv,
                DateTimeStyles.None, out parsed))
            {
                return parsed.ToString("ddd", Inv);
            }
            return iso;
        }

        /// <summary>Date tick for a range chart: weekday within a week, else "Sep 4".</summary>
        public static string AxisTick(string iso, int days)
        {
            DateTime parsed;
            if (string.IsNullOrEmpty(iso) || !DateTime.TryParseExact(iso, "yyyy-MM-dd", Inv,
                    DateTimeStyles.None, out parsed))
            {
                return iso;
            }
            if (days <= 7)
            {
                return parsed.ToString("ddd", Inv);
            }
            return parsed.ToString("MMM d", Inv);
        }

        /// <summary>Matches Intl.NumberFormat notation:"compact", maximumFractionDigits:2.</summary>
        public static string Compact(double value)
        {
            double abs = Math.Abs(value);
            string sign = value < 0 ? "-" : "";
            if (abs >= 1000000000000.0) return sign + Trim(abs / 1000000000000.0) + "T";
            if (abs >= 1000000000.0) return sign + Trim(abs / 1000000000.0) + "B";
            if (abs >= 1000000.0) return sign + Trim(abs / 1000000.0) + "M";
            if (abs >= 1000.0) return sign + Trim(abs / 1000.0) + "K";
            return sign + abs.ToString("#,0", Inv);
        }

        private static string Trim(double value)
        {
            // Intl.NumberFormat notation:"compact" keeps up to two fraction
            // digits whatever the integer part is (404.37M, 1.5K, 917K).
            return value.ToString("0.##", Inv);
        }

        /// <summary>Intl.NumberFormat maximumFractionDigits:0.</summary>
        public static string Int(double value)
        {
            return value.ToString("#,0", Inv);
        }

        /// <summary>"just now" style label used by the web AutoRefresh control.</summary>
        public static string UpdatedLabel(DateTime fetchedAt, DateTime now)
        {
            if (fetchedAt == DateTime.MinValue)
            {
                return "";
            }
            double seconds = Math.Max(0, (now - fetchedAt).TotalSeconds);
            if (seconds < 5) return "updated just now";
            if (seconds < 60) return "updated " + ((int)Math.Round(seconds)) + "s ago";
            return "updated " + ((int)Math.Round(seconds / 60.0)) + "m ago";
        }

        public static string RelativeTime(DateTime at, DateTime now)
        {
            double minutes = (now - at).TotalMinutes;
            if (minutes < 1) return "just now";
            if (minutes < 60) return ((int)Math.Round(minutes)) + " min ago";
            double hours = minutes / 60.0;
            if (hours < 24) return ((int)Math.Round(hours)) + " h ago";
            return ((int)Math.Round(hours / 24.0)) + " d ago";
        }
    }
}
