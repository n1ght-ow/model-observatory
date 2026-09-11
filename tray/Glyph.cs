using System;
using System.Drawing;
using System.Drawing.Drawing2D;

namespace RouterMonitorTray
{
    /// <summary>
    /// Lucide-style icons, redrawn on a 24x24 grid so the tray can use the same
    /// glyphs the web app pulls from lucide-react. Every icon is stroked with a
    /// constant device width, exactly like the web's "stroke-width: 2" scaled to
    /// the icon box.
    /// </summary>
    internal static class Glyph
    {
        public static void Draw(Graphics g, string name, RectangleF box, Color color, float weight)
        {
            if (box.Width <= 0f || box.Height <= 0f)
            {
                return;
            }
            float s = Math.Min(box.Width, box.Height) / 24f;
            GraphicsState state = g.Save();
            g.TranslateTransform(box.X + (box.Width - 24f * s) / 2f, box.Y + (box.Height - 24f * s) / 2f);
            g.ScaleTransform(s, s);
            // lucide draws every icon with stroke-width 2 inside the 24x24 viewBox,
            // so the device width follows the box rather than the call site.
            using (Pen pen = new Pen(color, 2f / s))
            {
                pen.StartCap = LineCap.Round;
                pen.EndCap = LineCap.Round;
                pen.LineJoin = LineJoin.Round;
                using (SolidBrush brush = new SolidBrush(color))
                {
                    Draw(g, name, pen, brush);
                }
            }
            g.Restore(state);
        }

        private static void Draw(Graphics g, string name, Pen pen, SolidBrush brush)
        {
            switch (name)
            {
                // -- navigation -------------------------------------------------
                case "layout-grid":
                    R(g, pen, 3f, 3f, 7f, 7f, 1f);
                    R(g, pen, 14f, 3f, 7f, 7f, 1f);
                    R(g, pen, 14f, 14f, 7f, 7f, 1f);
                    R(g, pen, 3f, 14f, 7f, 7f, 1f);
                    break;
                case "activity":
                    Path(g, pen, "M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2");
                    break;
                case "cpu":
                    Path(g, pen, "M12 20v2M12 2v2M17 20v2M17 2v2M2 12h2M2 17h2M2 7h2M20 12h2M20 17h2M20 7h2M7 20v2M7 2v2");
                    R(g, pen, 4f, 4f, 16f, 16f, 2f);
                    R(g, pen, 8f, 8f, 8f, 8f, 1f);
                    break;
                case "sparkles":
                    Path(g, pen, "M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z");
                    Path(g, pen, "M20 2v4M22 4h-4");
                    Circle(g, pen, 4f, 20f, 2f);
                    break;
                case "file-json":
                    Path(g, pen, "M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z");
                    Path(g, pen, "M14 2v5a1 1 0 0 0 1 1h5");
                    Path(g, pen, "M10 12a1 1 0 0 0-1 1v1a1 1 0 0 1-1 1 1 1 0 0 1 1 1v1a1 1 0 0 0 1 1");
                    Path(g, pen, "M14 18a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1 1 1 0 0 1-1-1v-1a1 1 0 0 0-1-1");
                    break;
                case "terminal":
                    Path(g, pen, "M12 19h8");
                    Path(g, pen, "m4 17 6-6-6-6");
                    break;
                case "panel":
                    R(g, pen, 3f, 3f, 18f, 18f, 2f);
                    Path(g, pen, "M9 3v18");
                    break;
                case "search":
                    Path(g, pen, "m21 21-4.34-4.34");
                    Circle(g, pen, 11f, 11f, 8f);
                    break;
                case "sun":
                    Circle(g, pen, 12f, 12f, 4f);
                    Path(g, pen, "M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41");
                    break;
                case "moon":
                    Path(g, pen, "M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401");
                    break;
                case "server":
                    R(g, pen, 2f, 2f, 20f, 8f, 2f);
                    R(g, pen, 2f, 14f, 20f, 8f, 2f);
                    Path(g, pen, "M6 6h.01M6 18h.01");
                    break;
                case "refresh":
                    Path(g, pen, "M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8");
                    Path(g, pen, "M21 3v5h-5");
                    Path(g, pen, "M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16");
                    Path(g, pen, "M8 16H3v5");
                    break;
                case "filter":
                    Path(g, pen, "M10 20a1 1 0 0 0 .553.895l2 1A1 1 0 0 0 14 21v-7a2 2 0 0 1 .517-1.341L21.74 4.67A1 1 0 0 0 21 3H3a1 1 0 0 0-.742 1.67l7.225 7.989A2 2 0 0 1 10 14z");
                    break;
                case "rotate-ccw":
                    Path(g, pen, "M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8");
                    Path(g, pen, "M3 3v5h5");
                    break;
                case "download":
                    Path(g, pen, "M12 15V3");
                    Path(g, pen, "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4");
                    Path(g, pen, "m7 10 5 5 5-5");
                    break;

                // -- chrome -----------------------------------------------------
                case "chevron-down":
                    Path(g, pen, "m6 9 6 6 6-6");
                    break;
                case "chevron-up":
                    Path(g, pen, "m18 15-6-6-6 6");
                    break;
                case "chevron-left":
                    Path(g, pen, "m15 18-6-6 6-6");
                    break;
                case "chevron-right":
                    Path(g, pen, "m9 18 6-6-6-6");
                    break;
                case "arrow-right":
                    Path(g, pen, "M5 12h14m-7-7 7 7-7 7");
                    break;
                case "arrow-up":
                    Path(g, pen, "m5 12 7-7 7 7M12 19V5");
                    break;
                case "arrow-down":
                    Path(g, pen, "M12 5v14m7-7-7 7-7-7");
                    break;
                case "arrow-up-down":
                    Path(g, pen, "m21 16-4 4-4-4M17 20V4m-14 4 4-4 4 4M7 4v16");
                    break;
                case "trending-up":
                    Path(g, pen, "M16 7h6v6m0-6-8.5 8.5-5-5L2 17");
                    break;
                case "trending-down":
                    Path(g, pen, "M16 17h6v-6m0 6-8.5-8.5-5 5L2 7");
                    break;
                case "minus":
                    Path(g, pen, "M5 12h14");
                    break;
                case "x":
                    Path(g, pen, "M18 6 6 18m0-12 12 12");
                    break;
                case "check":
                    Path(g, pen, "M20 6 9 17l-5-5");
                    break;

                // -- status -----------------------------------------------------
                case "circle-check":
                    Circle(g, pen, 12f, 12f, 10f);
                    Path(g, pen, "m16 9-5.5 5.5L8 12");
                    break;
                case "circle-alert":
                    Circle(g, pen, 12f, 12f, 10f);
                    Path(g, pen, "M12 8v4M12 16h.01");
                    break;
                case "circle-slash":
                    Circle(g, pen, 12f, 12f, 10f);
                    Path(g, pen, "m9 15 6-6");
                    break;
                case "external-link":
                    Path(g, pen, "M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6");
                    break;
                case "calendar":
                    Path(g, pen, "M8 2v3M16 2v3");
                    R(g, pen, 3f, 3f, 18f, 18f, 2f);
                    Path(g, pen, "M3 9h18M8 13h.01M12 13h.01M16 13h.01M8 17h.01M12 17h.01M16 17h.01");
                    break;
                case "clock":
                    Circle(g, pen, 12f, 12f, 10f);
                    Path(g, pen, "M12 6v6l4 2");
                    break;
                case "flame":
                    Path(g, pen, "M12 3q1 4 4 6.5t3 5.5a1 1 0 0 1-14 0 5 5 0 0 1 1-3 1 1 0 0 0 5 0c0-2-1.5-3-1.5-5q0-2 2.5-4");
                    break;
                case "zap":
                    Path(g, pen, "M15.914 4a1.5 1.5 0 0 0-2.474-1.561l-9 9A1.5 1.5 0 0 0 5.5 14h4.002a.5.5 0 0 1 .471.666L8.086 20a1.5 1.5 0 0 0 2.475 1.56l9-9A1.5 1.5 0 0 0 18.5 10h-3.997a.5.5 0 0 1-.472-.667z");
                    break;
                case "gauge":
                    Path(g, pen, "m12 14 4-4M3.34 19a10 10 0 1 1 17.32 0");
                    break;
                case "key-round":
                    Path(g, pen, "M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z");
                    Circle(g, pen, 16.5f, 7.5f, 0.5f);
                    break;
                case "circle-dollar":
                    Circle(g, pen, 12f, 12f, 10f);
                    Path(g, pen, "M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8M12 18V6");
                    break;
                case "coins":
                    Circle(g, pen, 8f, 8f, 6f);
                    Path(g, pen, "M18.09 10.37A6 6 0 1 1 10.34 18M7 6h1v4M16.71 13.88l.7.71-2.82 2.82");
                    break;
                case "user":
                    Path(g, pen, "M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2");
                    Circle(g, pen, 12f, 7f, 4f);
                    break;
                case "mail":
                    Path(g, pen, "M2 4h20v16H2zM22 6l-10 7L2 6");
                    break;
                case "wallet":
                    Path(g, pen, "M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1");
                    Path(g, pen, "M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4");
                    break;
            }
        }


        private static void P(Graphics g, Pen pen, params float[] xy)
        {
            for (int i = 0; i + 3 < xy.Length; i += 2)
            {
                g.DrawLine(pen, xy[i], xy[i + 1], xy[i + 2], xy[i + 3]);
            }
        }

        private static void Circle(Graphics g, Pen pen, float cx, float cy, float r)
        {
            g.DrawEllipse(pen, cx - r, cy - r, r * 2f, r * 2f);
        }

        private static void Dot(Graphics g, SolidBrush brush, float cx, float cy)
        {
            g.FillEllipse(brush, cx - 1f, cy - 1f, 2f, 2f);
        }

        private static void R(Graphics g, Pen pen, float x, float y, float w, float h, float r)
        {
            using (GraphicsPath path = Theme.Rounded(new RectangleF(x, y, w, h), r))
            {
                g.DrawPath(pen, path);
            }
        }

        private static void Star(Graphics g, Pen pen, float cx, float cy, float r)
        {
            using (GraphicsPath path = new GraphicsPath())
            {
                path.AddBezier(cx, cy - r, cx + r * 0.2f, cy - r * 0.2f, cx + r * 0.2f, cy - r * 0.2f, cx + r, cy);
                path.AddBezier(cx + r, cy, cx + r * 0.2f, cy + r * 0.2f, cx + r * 0.2f, cy + r * 0.2f, cx, cy + r);
                path.AddBezier(cx, cy + r, cx - r * 0.2f, cy + r * 0.2f, cx - r * 0.2f, cy + r * 0.2f, cx - r, cy);
                path.AddBezier(cx - r, cy, cx - r * 0.2f, cy - r * 0.2f, cx - r * 0.2f, cy - r * 0.2f, cx, cy - r);
                path.CloseFigure();
                g.DrawPath(pen, path);
            }
        }
        /// <summary>
        /// Minimal SVG-subset path renderer: absolute and relative M/L/H/V/C/A/Z,
        /// with repeated parameter groups, which is what the lucide paths use.
        /// </summary>
        private static void Path(Graphics g, Pen pen, string d)
        {
            using (GraphicsPath path = new GraphicsPath())
            {
                AppendSvgPath(path, d);
                g.DrawPath(pen, path);
            }
        }

        /// <summary>
        /// Parses one SVG path into an existing GraphicsPath. Used both by the
        /// stroked icons above and by Logo, whose mark is a filled path.
        /// </summary>
        public static void AppendSvgPath(GraphicsPath path, string d)
        {
            {
                float x = 0f, y = 0f, sx = 0f, sy = 0f;
                float controlX = 0f, controlY = 0f;
                bool hasControl = false;
                int i = 0;
                char command = ' ';
                bool relative = false;

                while (i < d.Length)
                {
                    char c = d[i];
                    if (char.IsLetter(c))
                    {
                        if (c == 'Z' || c == 'z')
                        {
                            path.CloseFigure();
                            x = sx;
                            y = sy;
                            i++;
                            continue;
                        }
                        command = char.ToUpperInvariant(c);
                        relative = char.IsLower(c);
                        i++;
                        continue;
                    }
                    if (char.IsWhiteSpace(c) || c == ',')
                    {
                        i++;
                        continue;
                    }
                    if (command == ' ')
                    {
                        i++;
                        continue;
                    }

                    if (command == 'M')
                    {
                        float mx, my;
                        if (!Number(d, ref i, out mx) || !Number(d, ref i, out my))
                        {
                            break;
                        }
                        if (relative)
                        {
                            mx += x;
                            my += y;
                        }
                        x = mx;
                        y = my;
                        sx = x;
                        sy = y;
                        path.StartFigure();
                        command = 'L';
                        continue;
                    }
                    if (command == 'L')
                    {
                        float lx, ly;
                        if (!Number(d, ref i, out lx) || !Number(d, ref i, out ly))
                        {
                            break;
                        }
                        if (relative)
                        {
                            lx += x;
                            ly += y;
                        }
                        path.AddLine(x, y, lx, ly);
                        hasControl = false;
                        x = lx;
                        y = ly;
                        continue;
                    }
                    if (command == 'H')
                    {
                        float hx;
                        if (!Number(d, ref i, out hx))
                        {
                            break;
                        }
                        if (relative)
                        {
                            hx += x;
                        }
                        path.AddLine(x, y, hx, y);
                        x = hx;
                        continue;
                    }
                    if (command == 'V')
                    {
                        float vy;
                        if (!Number(d, ref i, out vy))
                        {
                            break;
                        }
                        if (relative)
                        {
                            vy += y;
                        }
                        path.AddLine(x, y, x, vy);
                        y = vy;
                        continue;
                    }
                    if (command == 'C')
                    {
                        float[] v = new float[6];
                        bool ok = true;
                        for (int k = 0; k < 6 && ok; k++)
                        {
                            ok = Number(d, ref i, out v[k]);
                        }
                        if (!ok)
                        {
                            break;
                        }
                        if (relative)
                        {
                            for (int k = 0; k < 6; k += 2)
                            {
                                v[k] += x;
                                v[k + 1] += y;
                            }
                        }
                        path.AddBezier(x, y, v[0], v[1], v[2], v[3], v[4], v[5]);
                        controlX = v[2];
                        controlY = v[3];
                        hasControl = true;
                        x = v[4];
                        y = v[5];
                        continue;
                    }
                    if (command == 'S')
                    {
                        float[] v = new float[4];
                        bool ok = true;
                        for (int k = 0; k < 4 && ok; k++)
                        {
                            ok = Number(d, ref i, out v[k]);
                        }
                        if (!ok)
                        {
                            break;
                        }
                        if (relative)
                        {
                            for (int k = 0; k < 4; k += 2)
                            {
                                v[k] += x;
                                v[k + 1] += y;
                            }
                        }
                        float c1x = hasControl ? 2f * x - controlX : x;
                        float c1y = hasControl ? 2f * y - controlY : y;
                        path.AddBezier(x, y, c1x, c1y, v[0], v[1], v[2], v[3]);
                        controlX = v[0];
                        controlY = v[1];
                        hasControl = true;
                        x = v[2];
                        y = v[3];
                        continue;
                    }
                    if (command == 'Q' || command == 'T')
                    {
                        float cx = 0f, cy = 0f, qx = 0f, qy = 0f;
                        if (command == 'Q')
                        {
                            bool ok = Number(d, ref i, out cx) && Number(d, ref i, out cy) &&
                                Number(d, ref i, out qx) && Number(d, ref i, out qy);
                            if (!ok)
                            {
                                break;
                            }
                            if (relative)
                            {
                                cx += x;
                                cy += y;
                                qx += x;
                                qy += y;
                            }
                        }
                        else
                        {
                            bool ok = Number(d, ref i, out qx) && Number(d, ref i, out qy);
                            if (!ok)
                            {
                                break;
                            }
                            if (relative)
                            {
                                qx += x;
                                qy += y;
                            }
                            cx = hasControl ? 2f * x - controlX : x;
                            cy = hasControl ? 2f * y - controlY : y;
                        }
                        // Quadratic to cubic: both controls sit two thirds of the way
                        // from an endpoint towards the quadratic control point.
                        path.AddBezier(x, y,
                            x + 2f / 3f * (cx - x), y + 2f / 3f * (cy - y),
                            qx + 2f / 3f * (cx - qx), qy + 2f / 3f * (cy - qy),
                            qx, qy);
                        controlX = cx;
                        controlY = cy;
                        hasControl = true;
                        x = qx;
                        y = qy;
                        continue;
                    }
                    if (command == 'A')
                    {
                        float[] v = new float[7];
                        bool ok = true;
                        for (int k = 0; k < 7 && ok; k++)
                        {
                            ok = Number(d, ref i, out v[k]);
                        }
                        if (!ok)
                        {
                            break;
                        }
                        float ex = v[5];
                        float ey = v[6];
                        if (relative)
                        {
                            ex += x;
                            ey += y;
                        }
                        Arc(path, x, y, v[0], v[3], v[4], ex, ey);
                        x = ex;
                        y = ey;
                        continue;
                    }
                    i++;
                }
            }
        }

        /// <summary>SVG arc (circular, no x-axis rotation), which is all the icons need.</summary>
        private static void Arc(GraphicsPath path, float x, float y, float r, float largeArc, float sweep,
            float ex, float ey)
        {
            float dx = ex - x;
            float dy = ey - y;
            float chord = (float)Math.Sqrt(dx * dx + dy * dy);
            if (chord < 0.001f || r <= 0.001f)
            {
                path.AddLine(x, y, ex, ey);
                return;
            }
            if (chord > 2f * r)
            {
                r = chord / 2f;
            }
            float half = chord / 2f;
            float h = (float)Math.Sqrt(Math.Max(0f, r * r - half * half));
            float midX = (x + ex) / 2f;
            float midY = (y + ey) / 2f;
            float nx = -dy / chord;
            float ny = dx / chord;
            float sign = (largeArc > 0.5f) == (sweep > 0.5f) ? -1f : 1f;
            float cx = midX + nx * h * sign;
            float cy = midY + ny * h * sign;
            float startAngle = (float)(Math.Atan2(y - cy, x - cx) * 180.0 / Math.PI);
            float endAngle = (float)(Math.Atan2(ey - cy, ex - cx) * 180.0 / Math.PI);
            float sweepAngle = endAngle - startAngle;
            if (sweep > 0.5f && sweepAngle < 0f)
            {
                sweepAngle += 360f;
            }
            if (sweep < 0.5f && sweepAngle > 0f)
            {
                sweepAngle -= 360f;
            }
            path.AddArc(cx - r, cy - r, r * 2f, r * 2f, startAngle, sweepAngle);
        }

        /// <summary>Reads one SVG number, stopping at a second decimal point.</summary>
        private static bool Number(string d, ref int i, out float value)
        {
            value = 0f;
            while (i < d.Length && (char.IsWhiteSpace(d[i]) || d[i] == ','))
            {
                i++;
            }
            int start = i;
            if (i < d.Length && (d[i] == '-' || d[i] == '+'))
            {
                i++;
            }
            bool dot = false;
            while (i < d.Length)
            {
                char c = d[i];
                if (char.IsDigit(c))
                {
                    i++;
                }
                else if (c == '.' && !dot)
                {
                    dot = true;
                    i++;
                }
                else if ((c == 'e' || c == 'E') && i + 1 < d.Length)
                {
                    i++;
                    if (d[i] == '-' || d[i] == '+')
                    {
                        i++;
                    }
                }
                else
                {
                    break;
                }
            }
            if (i == start)
            {
                return false;
            }
            return float.TryParse(d.Substring(start, i - start), System.Globalization.NumberStyles.Float,
                System.Globalization.CultureInfo.InvariantCulture, out value);
        }
    }
}