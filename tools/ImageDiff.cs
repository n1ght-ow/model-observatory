using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.Globalization;
using System.Runtime.InteropServices;

// Alignment-aware comparison of the tray against the reference screenshots.
//
// The four references were captured in a real browser at slightly different
// widths (1671..1691 CSS px), so a page can sit a few pixels off against the
// tray through no fault of the layout. This searches a small translation window
// first, scores at the best alignment, and writes the heat map there too.
//
// Everything works on locked 32bpp buffers: GetPixel/SetPixel are far too slow
// for a million-pixel scan across a 25-position window.
//
// usage: ImageDiff <reference.png> <tray.png> [--map out.png] [--scale 1.5]
//                 [--skip-bottom 47] [--mask x0,y0,x1,y1]
internal static class Program
{
    private const int Threshold = 40;
    private const int Strong = 150;

    private static int Main(string[] args)
    {
        if (args.Length < 2)
        {
            Console.Error.WriteLine("usage: ImageDiff <reference.png> <tray.png> [--map out.png] [--scale 1.5] [--skip-bottom 47] [--mask x0,y0,x1,y1]");
            return 2;
        }

        string refPath = args[0];
        string trayPath = args[1];
        string mapPath = null;
        float scale = 1.5f;
        int skipBottom = 47;
        int mx0 = -1, my0 = 0, mx1 = 0, my1 = 0;
        int regions = 0;
        int topRegions = 8;

        for (int i = 2; i < args.Length; i++)
        {
            switch (args[i])
            {
                case "--map": mapPath = args[++i]; break;
                case "--scale": scale = float.Parse(args[++i], CultureInfo.InvariantCulture); break;
                case "--skip-bottom": skipBottom = int.Parse(args[++i], CultureInfo.InvariantCulture); break;
                case "--mask":
                    string[] parts = args[++i].Split(',');
                    mx0 = int.Parse(parts[0]); my0 = int.Parse(parts[1]);
                    mx1 = int.Parse(parts[2]); my1 = int.Parse(parts[3]);
                    break;
                case "--regions":
                    regions = int.Parse(args[++i], CultureInfo.InvariantCulture);
                    break;
                case "--top":
                    topRegions = int.Parse(args[++i], CultureInfo.InvariantCulture);
                    break;
            }
        }

        using (Bitmap raw = new Bitmap(refPath))
        using (Bitmap trayImage = new Bitmap(trayPath))
        {
            int cw = (int)Math.Round(raw.Width / scale);
            int ch = (int)Math.Round(raw.Height / scale);
            using (Bitmap reference = new Bitmap(cw, ch, PixelFormat.Format32bppArgb))
            {
                using (Graphics g = Graphics.FromImage(reference))
                {
                    g.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBicubic;
                    g.PixelOffsetMode = System.Drawing.Drawing2D.PixelOffsetMode.HighQuality;
                    g.Clear(Color.White);
                    g.DrawImage(raw, 0, 0, cw, ch);
                }

                Vitals v = new Vitals();
                v.Reference = Pixels(reference);
                v.Tray = Pixels(trayImage);
                v.SkipBottom = skipBottom;
                v.MaskX0 = mx0; v.MaskY0 = my0; v.MaskX1 = mx1; v.MaskY1 = my1;

                Console.WriteLine("ref " + cw + "x" + ch + "   tray " + trayImage.Width + "x" + trayImage.Height);

                Result zero = Measure(v, 0, 0);
                Console.WriteLine("  dx=  0 dy=  0  diff=" + zero.Diff.ToString("0.00") + "%  strong=" + zero.Strong.ToString("0.00") + "%");

                int bestDx = 0, bestDy = 0;
                double best = double.MaxValue;
                for (int dy = -6; dy <= 6; dy++)
                {
                    for (int dx = -12; dx <= 12; dx++)
                    {
                        Result r = Measure(v, dx, dy);
                        if (r.Scored == 0) continue;
                        if (r.Strong < best) { best = r.Strong; bestDx = dx; bestDy = dy; }
                    }
                }

                Result winner = Measure(v, bestDx, bestDy);
                string suffix = v.MaskX0 >= 0 ? "   (masked " + winner.Masked + " px)" : "";
                Console.WriteLine("  dx=" + bestDx.ToString().PadLeft(3) + " dy=" + bestDy.ToString().PadLeft(3) +
                    "  diff=" + winner.Diff.ToString("0.00") + "%  strong=" + winner.Strong.ToString("0.00") + "%" + suffix);

                if (mapPath != null && mapPath != "-") WriteMap(v, bestDx, bestDy, mapPath);
                if (regions > 0) ReportRegions(v, bestDx, bestDy, regions, topRegions);
            }
        }
        return 0;
    }

    private sealed class Buffer
    {
        public byte[] Data;
        public int Width;
        public int Height;
        public int Stride;
    }

    private static Buffer Pixels(Bitmap image)
    {
        Buffer buffer = new Buffer();
        buffer.Width = image.Width;
        buffer.Height = image.Height;
        BitmapData data = image.LockBits(new Rectangle(0, 0, image.Width, image.Height),
            ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
        buffer.Stride = data.Stride;
        buffer.Data = new byte[data.Stride * image.Height];
        Marshal.Copy(data.Scan0, buffer.Data, 0, buffer.Data.Length);
        image.UnlockBits(data);
        return buffer;
    }

    private sealed class Vitals
    {
        public Buffer Reference;
        public Buffer Tray;
        public int SkipBottom;
        public int MaskX0 = -1, MaskY0, MaskX1, MaskY1;
    }

    private sealed class Result
    {
        public double Diff;
        public double Strong;
        public int Scored;
        public int Masked;
    }

    // Scores every destination pixel the tray owns, sampling the reference at
    // (x+dx, y+dy); the mask rectangle is excluded from both streams.
    private static Result Measure(Vitals v, int dx, int dy)
    {
        Result result = new Result();
        int changed = 0, strong = 0, scored = 0, masked = 0;
        int tw = v.Tray.Width, th = v.Tray.Height - v.SkipBottom;
        int rw = v.Reference.Width, rh = v.Reference.Height;
        int rStride = v.Reference.Stride, tStride = v.Tray.Stride;
        byte[] r = v.Reference.Data, t = v.Tray.Data;

        for (int y = 0; y < th; y++)
        {
            int sy = y + dy;
            if (sy < 0 || sy >= rh) continue;
            int rRow = sy * rStride, tRow = y * tStride;
            for (int x = 0; x < tw; x++)
            {
                int sx = x + dx;
                if (sx < 0 || sx >= rw) continue;
                if (v.MaskX0 >= 0 && x >= v.MaskX0 && x < v.MaskX1 && y >= v.MaskY0 && y < v.MaskY1) { masked++; continue; }
                scored++;
                int ia = rRow + sx * 4, ib = tRow + x * 4;
                int d = Math.Abs(r[ia] - t[ib]) + Math.Abs(r[ia + 1] - t[ib + 1]) + Math.Abs(r[ia + 2] - t[ib + 2]);
                if (d > Strong) { changed++; strong++; }
                else if (d > Threshold) { changed++; }
            }
        }
        result.Scored = scored;
        result.Masked = masked;
        result.Diff = scored == 0 ? 0 : 100.0 * changed / scored;
        result.Strong = scored == 0 ? 0 : 100.0 * strong / scored;
        return result;
    }

    /// <summary>
    /// Splits the page into an N x N grid and prints the worst cells by strong
    /// difference. Naming the hot cells beats eyeballing a heat map: it is how the
    /// missing staleness banner and the unstyled trend bars were found.
    /// </summary>
    private static void ReportRegions(Vitals v, int dx, int dy, int n, int top)
    {
        int tw = v.Tray.Width, th = v.Tray.Height - v.SkipBottom;
        int rw = v.Reference.Width, rh = v.Reference.Height;
        int rStride = v.Reference.Stride, tStride = v.Tray.Stride;
        byte[] r = v.Reference.Data, t = v.Tray.Data;
        int cellW = (tw + n - 1) / n;
        int cellH = (th + n - 1) / n;
        List<string> lines = new List<string>();

        for (int gy = 0; gy < n; gy++)
        {
            for (int gx = 0; gx < n; gx++)
            {
                int x0 = gx * cellW, x1 = Math.Min(tw, x0 + cellW);
                int y0 = gy * cellH, y1 = Math.Min(th, y0 + cellH);
                int strong = 0, scored = 0;
                for (int y = y0; y < y1; y++)
                {
                    int sy = y + dy;
                    if (sy < 0 || sy >= rh) continue;
                    int rRow = sy * rStride, tRow = y * tStride;
                    for (int x = x0; x < x1; x++)
                    {
                        int sx = x + dx;
                        if (sx < 0 || sx >= rw) continue;
                        if (v.MaskX0 >= 0 && x >= v.MaskX0 && x < v.MaskX1 && y >= v.MaskY0 && y < v.MaskY1) continue;
                        scored++;
                        int ia = rRow + sx * 4, ib = tRow + x * 4;
                        int d = Math.Abs(r[ia] - t[ib]) + Math.Abs(r[ia + 1] - t[ib + 1]) + Math.Abs(r[ia + 2] - t[ib + 2]);
                        if (d > Strong) strong++;
                    }
                }
                if (scored == 0) continue;
                double pct = 100.0 * strong / scored;
                if (pct < 1.0) continue;
                lines.Add(pct.ToString("0.0").PadLeft(5) + "%  x " + x0.ToString().PadLeft(4) + ".." +
                    x1.ToString().PadLeft(4) + "   y " + y0.ToString().PadLeft(4) + ".." + y1.ToString().PadLeft(4));
            }
        }

        lines.Sort(delegate (string a, string b)
        {
            double pa = double.Parse(a.Substring(0, 5).Trim(), CultureInfo.InvariantCulture);
            double pb = double.Parse(b.Substring(0, 5).Trim(), CultureInfo.InvariantCulture);
            return pb.CompareTo(pa);
        });
        Console.WriteLine("  worst of " + (n * n) + " cells (strong >= 1%):");
        for (int i = 0; i < Math.Min(top, lines.Count); i++)
        {
            Console.WriteLine("   " + lines[i]);
        }
    }

    private static void WriteMap(Vitals v, int dx, int dy, string path)
    {
        int tw = v.Tray.Width, th = v.Tray.Height - v.SkipBottom;
        int rw = v.Reference.Width, rh = v.Reference.Height;
        int rStride = v.Reference.Stride, tStride = v.Tray.Stride;
        byte[] r = v.Reference.Data, t = v.Tray.Data;
        byte[] outData = new byte[tStride * th];

        for (int y = 0; y < th; y++)
        {
            int sy = y + dy;
            int rRow = sy * rStride, tRow = y * tStride;
            for (int x = 0; x < tw; x++)
            {
                int sx = x + dx;
                int o = tRow + x * 4;
                byte bb, gg, rr;
                bool outside = sx < 0 || sx >= rw || sy < 0 || sy >= rh;
                bool inMask = v.MaskX0 >= 0 && x >= v.MaskX0 && x < v.MaskX1 && y >= v.MaskY0 && y < v.MaskY1;
                if (outside || inMask)
                {
                    rr = 70; gg = 60; bb = 130;
                }
                else
                {
                    int ia = rRow + sx * 4, ib = tRow + x * 4;
                    int d = Math.Abs(r[ia] - t[ib]) + Math.Abs(r[ia + 1] - t[ib + 1]) + Math.Abs(r[ia + 2] - t[ib + 2]);
                    if (d > Strong) { rr = 255; gg = 70; bb = 70; }
                    else if (d > Threshold) { rr = 200; gg = 130; bb = 40; }
                    else { rr = 16; gg = 16; bb = 20; }
                }
                outData[o] = bb; outData[o + 1] = gg; outData[o + 2] = rr; outData[o + 3] = 255;
            }
        }

        using (Bitmap map = new Bitmap(tw, th, PixelFormat.Format32bppArgb))
        {
            BitmapData data = map.LockBits(new Rectangle(0, 0, tw, th), ImageLockMode.WriteOnly, PixelFormat.Format32bppArgb);
            Marshal.Copy(outData, 0, data.Scan0, outData.Length);
            map.UnlockBits(data);
            map.Save(path, ImageFormat.Png);
        }
    }
}