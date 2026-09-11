using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Text;
using System.Globalization;
using System.Windows.Forms;

namespace RouterMonitorTray
{
    /// <summary>Which slice of the dashboard the flyout is currently showing.</summary>
    internal sealed class ViewState
    {
        public string Page = "overview";    // overview | requests | models | deepseek
        public string Source = "auto";      // auto | deepseek | router
        public string Range = "7";          // all | 30 | 7 | 1
        public string Provider = "";
        public string Model = "";
        public string Sort = "at";
        public bool SortAsc;
        public int TablePage = 1;
        public string Popup = "";           // "" | provider | model | command
        public int PopupScroll;
        /// <summary>Live filter text of the Cmd-K command menu.</summary>
        public string Query = "";
        /// <summary>Highlighted row of the filtered command list.</summary>
        public int CommandIndex;
        /// <summary>True when the panel draws the light theme (the default).</summary>
        public bool Light = true;
        /// <summary>The sidebar's "Live data source" card can be dismissed.</summary>
        public bool BannerClosed;
        /// <summary>collapsible="icon": the rail shrinks to icons only.</summary>
        public bool SidebarCollapsed;

        public int Days
        {
            get
            {
                if (Range == "all") return 0;
                int days;
                if (int.TryParse(Range, NumberStyles.Integer, CultureInfo.InvariantCulture, out days))
                {
                    return days;
                }
                return 7;
            }
        }

        public int Limit
        {
            get
            {
                if (Page == "requests") return 400;
                if (Page == "deepseek") return 50;
                return 12;
            }
        }

        /// <summary>The DeepSeek page always reads the native DeepSeek source.</summary>
        public string ApiSource
        {
            get { return Page == "deepseek" ? "deepseek" : Source; }
        }
    }

    /// <summary>
    /// The tray flyout, drawn so it reads as the same product as the web
    /// dashboard: the sidebar, the header, the hairline card grid, the web
    /// palette, the web typography scale, sparklines, recharts geometry and the
    /// full set of Overview / Requests / Models / DeepSeek cards.
    ///
    /// Layout is expressed in CSS-pixel-like units and scaled once at paint
    /// time, so the panel is identical at 100% and 150% display scaling.
    /// </summary>
    internal sealed partial class PanelView : Control
    {
        // Exactly the viewport the reference screenshots were taken at: 2523x1402
        // physical pixels at 1.5x DPR is 1682x935 CSS. At that width the web's
        // `max-w-(--app-wrapper-max-width)` — 80rem = 1280 — already caps the page
        // block and centres it, leaving the same 73px gutter on both sides, so the
        // grid lands on the same pixels as the browser.
        // Solved from the reference screenshots' card rules: at 1.5x DPR the grid
        // runs 534.5..2381 physical, i.e. CSS x 356..1587 — so the viewport is
        // 1688 CSS wide (the captures differ only by a scrollbar's worth) and 935
        // tall. With the rail at 16rem and the web's max-w-80rem cap, 1688
        // reproduces that origin and the 1232px grid exactly. The height is the
        // reference's 935 *plus* this flyout's own 46px control strip, so the page
        // area the cards are laid into is the same 879px the browser had.
        public const int LogicalWidth = 1688;
        public const int LogicalHeight = 981;

        private const float W = LogicalWidth;
        private const float H = LogicalHeight;

        private const float TopBarH = 56f;
        /// <summary>The tray's own control strip; the web page has no equivalent.</summary>
        private const float FooterH = 46f;

        // The web header is h-14 inclusive of its border-b, so its content band is
        // 56px tall and the rule occupies the final pixel (row 55). The page then
        // starts at y=56, which is what puts the h1 on 80 with a 24px padding.
        private const float ContentTop = TopBarH;
        private const float ContentBottom = H - FooterH - 1f;
        private const float Viewport = ContentBottom - ContentTop;

        /// <summary>The web sidebar is 16rem expanded, 3rem collapsed to icons.</summary>
        private float SidebarW
        {
            get { return State.SidebarCollapsed ? 48f : 256f; }
        }

        private float MainX
        {
            // The web's SidebarInset starts exactly at the rail's edge — measured
            // h1 x=280 for a 16rem rail plus md:p-6 — so the hairline is drawn on
            // the boundary rather than one pixel inside it.
            get { return SidebarW; }
        }

        private float MainW
        {
            get { return W - MainX; }
        }

        /// <summary>
        /// The page block is `mx-auto w-full max-w-80rem` (AppShell), so once the
        /// inset is wider than 1280 the block stops growing and centres. At the
        /// 1536 panel width the inset is exactly 1280 and no offset applies.
        /// </summary>
        private const float PageMaxW = 1280f;
        private const float PagePad = 24f;

        private float PageInset
        {
            get
            {
                float inset = MainW;
                return inset > PageMaxW ? PageMaxW : inset;
            }
        }

        private float PageX
        {
            get { return MainX + (MainW - PageInset) / 2f + PagePad; }
        }

        private float PageW
        {
            get { return PageInset - PagePad * 2f; }
        }

        private static readonly CultureInfo Inv = CultureInfo.InvariantCulture;

        // -- state ------------------------------------------------------------
        public Snapshot Snap;
        public bool Loading;
        public string Error;
        public readonly ViewState State = new ViewState();

        private Icon appIcon;

        private struct HitRegion
        {
            public string Key;
            public RectangleF Rect;
        }

        private readonly List<HitRegion> chromeHits = new List<HitRegion>();
        private readonly List<HitRegion> contentHits = new List<HitRegion>();

        private float contentHeight;
        private float scroll;
        private string hover = "";
        private string pressed = "";
        private PointF lastMouse;

        /// <summary>Mouse position expressed in scrolled content coordinates.</summary>
        private PointF ContentMouse
        {
            get { return new PointF(lastMouse.X, lastMouse.Y - ContentTop + scroll); }
        }

        // Layout scratch shared with the page renderers.
        private RectangleF selectProviderRect;
        private RectangleF selectModelRect;

        public event Action ReloadRequested;
        public event Action RefreshRequested;
        public event Action OpenWebRequested;
        public event Action<string> OpenUrlRequested;
        public event Action QuitRequested;

        public PanelView()
        {
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer |
                     ControlStyles.UserPaint | ControlStyles.ResizeRedraw | ControlStyles.Selectable, true);
            BackColor = Theme.Bg;
            TabStop = false;
        }

        public void SetIcon(Icon icon)
        {
            appIcon = icon;
        }

        public void UpdateState(Snapshot snapshot, bool loading, string error)
        {
            if (snapshot != null)
            {
                Snap = snapshot;
            }
            Loading = loading;
            Error = error;
            MeasureContent();
            Invalidate();
        }

        /// <summary>Used by the diagnostic renderer to capture the scrolled view.</summary>
        public void ScrollTo(float offset)
        {
            scroll = Clamp(offset);
            Invalidate();
        }

        public float ScrollOffset
        {
            get { return scroll; }
        }

        public float ContentHeight
        {
            get { return contentHeight; }
        }

        // -- geometry ---------------------------------------------------------
        private float ScaleFactor
        {
            get
            {
                float scale = ClientSize.Width / W;
                return scale <= 0f ? 1f : scale;
            }
        }

        /// <summary>One device pixel expressed in layout units.</summary>
        private float Px
        {
            get { return 1f / ScaleFactor; }
        }

        private float S(float value)
        {
            float scale = ScaleFactor;
            return (float)(Math.Round(value * scale) / scale);
        }

        private float Clamp(float value)
        {
            float max = Math.Max(0f, contentHeight - Viewport);
            if (value < 0f) return 0f;
            if (value > max) return max;
            return value;
        }

        private void Hit(string key, RectangleF rect)
        {
            HitRegion region = new HitRegion();
            region.Key = key;
            region.Rect = rect;
            contentHits.Add(region);
        }

        private void ChromeHit(string key, RectangleF rect)
        {
            HitRegion region = new HitRegion();
            region.Key = key;
            region.Rect = rect;
            chromeHits.Add(region);
        }

        private string HitTest(PointF logical)
        {
            for (int i = chromeHits.Count - 1; i >= 0; i--)
            {
                if (chromeHits[i].Rect.Contains(logical))
                {
                    return chromeHits[i].Key;
                }
            }
            PointF content = new PointF(logical.X, logical.Y - ContentTop + scroll);
            for (int i = contentHits.Count - 1; i >= 0; i--)
            {
                if (contentHits[i].Rect.Contains(content))
                {
                    return contentHits[i].Key;
                }
            }
            return "";
        }

        public bool PopupOpen
        {
            get { return State.Popup.Length > 0; }
        }

        /// <summary>Forces a hover key; used by the diagnostic renderer.</summary>
        public void ForceHover(string key)
        {
            hover = key;
            Invalidate();
        }

        /// <summary>Opens a popup by name; used by the diagnostic renderer.</summary>
        public void OpenPopup(string which)
        {
            State.Popup = which;
            State.PopupScroll = 0;
            if (which == "command")
            {
                ShowCommandInput();
            }
            Invalidate();
        }

        /// <summary>Escape closes the popup first, then the flyout (host's job).</summary>
        public bool ClosePopup()
        {
            if (State.Popup.Length == 0)
            {
                return false;
            }
            State.Popup = "";
            State.PopupScroll = 0;
            State.Query = "";
            State.CommandIndex = 0;
            HideCommandInput();
            Invalidate();
            return true;
        }

        public bool HandleKey(Keys key)
        {
            if (key == Keys.Escape && ClosePopup())
            {
                return true;
            }
            if (key == Keys.K && (ModifierKeys & Keys.Control) == Keys.Control)
            {
                if (State.Popup == "command")
                {
                    ClosePopup();
                }
                else
                {
                    State.Popup = "command";
                    State.PopupScroll = 0;
                    State.Query = "";
                    State.CommandIndex = 0;
                    ShowCommandInput();
                    Invalidate();
                }
                return true;
            }
            return false;
        }

        // -- painting ---------------------------------------------------------
        protected override void OnPaint(PaintEventArgs e)
        {
            Graphics g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.PixelOffsetMode = PixelOffsetMode.HighQuality;
            g.InterpolationMode = InterpolationMode.HighQualityBicubic;
            g.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;

            chromeHits.Clear();
            contentHits.Clear();

            g.Clear(Theme.Bg);
            g.ScaleTransform(ScaleFactor, ScaleFactor);

            DrawSidebar(g);
            DrawTopBar(g);
            DrawFooter(g);

            GraphicsState state = g.Save();
            g.TranslateTransform(0f, ContentTop - scroll);
            g.SetClip(new RectangleF(MainX, scroll, MainW, Viewport), CombineMode.Replace);
            DrawContent(g);
            g.Restore(state);

            DrawPopups(g);
            DrawScrollbar(g);
            DrawFrame(g);
        }

        private void DrawFrame(Graphics g)
        {
            Theme.Stroke(g, new RectangleF(Px, Px, W - Px * 2f, H - Px * 2f), 12f, Theme.Border, Px);
        }

        private void DrawScrollbar(Graphics g)
        {
            float max = Math.Max(0f, contentHeight - Viewport);
            if (max <= 0f)
            {
                return;
            }
            float trackH = Viewport - 8f;
            float thumbH = Math.Max(28f, trackH * (Viewport / contentHeight));
            float top = ContentTop + 4f + (trackH - thumbH) * (scroll / max);
            Theme.Fill(g, new RectangleF(W - 6f, top, 4f, thumbH), 2f, Theme.Alpha(Theme.Fg, 60));
        }

        // -- sidebar ----------------------------------------------------------
        private void DrawSidebar(Graphics g)
        {
            // AppSidebar paints the inner rail with bg-background, not --sidebar,
            // so the rail and the page share the same 10,10,10 surface; only the
            // active item lifts off it with --sidebar-accent.
            Theme.FillRect(g, new RectangleF(0f, 0f, RailW, H), Theme.Bg);
            if (Theme.Dark)
            {
                // dark:bg-[radial-gradient(60%_18%_at_10%_0%,foreground/.08,transparent)]
                using (LinearGradientBrush brush = new LinearGradientBrush(
                    new RectangleF(0f, 0f, RailW, 210f), Theme.Alpha(Theme.Fg, 18), Theme.Alpha(Theme.Fg, 0),
                    LinearGradientMode.Vertical))
                {
                    g.FillRectangle(brush, 0f, 0f, RailW, 210f);
                }
            }

            // SidebarHeader: h-14, border-b, px-2, menu button h-8.
            Cards.Line(g, 0f, TopBarH - 1f, RailW, Theme.Border);
            // The web header renders LogoIcon; only the notification-area icon uses
            // the simplified .ico, which is too dense to read inside the panel.
            // Measured: LogoIcon is a 16x16 box at (16, 20), the wordmark at x=40.
            RectangleF mark = State.SidebarCollapsed
                ? new RectangleF((RailW - 16f) / 2f, 20f, 16f, 16f)
                : new RectangleF(16f, 20f, 16f, 16f);
            Logo.Draw(g, mark, Theme.Fg);
            if (!State.SidebarCollapsed)
            {
                Theme.Text(g, "Router Monitor", Mx.Body, FontStyle.Regular, Theme.Fg, 40f,
                    Theme.CenterY(g, 0f, TopBarH, Mx.Body, FontStyle.Regular));
            }

            // Measured off the live rail: items are h-8 with no gap between them,
            // Overview starts at y=96 and the fifth (Command Code) ends at 256;
            // then a 16px gap, the Data label's h-8, and JSON API at 304.
            float y = 64f;
            y = SidebarGroup(g, y, "Router");
            y = SidebarItem(g, y, "overview", "layout-grid", "Overview");
            y = SidebarItem(g, y, "requests", "activity", "Requests");
            y = SidebarItem(g, y, "models", "cpu", "Models");
            y = SidebarItem(g, y, "deepseek", "sparkles", "DeepSeek");
            y = SidebarItem(g, y, "command-code", "gauge", "Command Code");
            y += 16f;
            y = SidebarGroup(g, y, "Data");
            y = SidebarItem(g, y, "json", "file-json", "JSON API");

            if (State.SidebarCollapsed)
            {
                return;
            }

            // The sidebar footer is pinned to the bottom of the *browser* viewport,
            // which is 46px shorter than this panel: the flyout's own control strip
            // is not part of the page. Measured on the live page at 935px: the
            // LatestChange border at 745, the menu's top border at 853, the Router
            // console row 862..890 and the year line at 914.
            float footerBottom = H - FooterH;
            float menuY = footerBottom - 82f;
            Cards.Line(g, 0f, menuY, RailW, Theme.Border);
            RectangleF console = new RectangleF(8f, menuY + 8f, CollapsedItemW, Mx.BtnSmH);
            DrawSidebarRow(g, console, "console", "terminal", "Router console", false, true);
            ChromeHit("nav:console", console);

            Theme.Text(g, "Local \u00b7 " + DateTime.Now.Year.ToString(Inv), 9f, FontStyle.Regular, Theme.Muted,
                16f, footerBottom - 21f);

            if (State.BannerClosed)
            {
                return;
            }

            float bannerY = menuY - 108f;
            Cards.Line(g, 0f, bannerY, RailW, Theme.Border);
            // LatestChange: font-mono text-[10px] badge, then title, then a
            // description line and the "View requests" link.
            // Measured against the live spans: DATA SOURCE at 760, the title at 779,
            // the description at 799 and the View requests button at 818..846.
            Theme.TextMono(g, "DATA SOURCE", Mx.Tiny, FontStyle.Regular, Theme.Muted, 16f, bannerY + 17f);
            Theme.Text(g, "Live data source", Mx.Small, FontStyle.Regular, Theme.Fg, 16f, bannerY + 34f);
            Theme.Text(g, Theme.Fit(g, "Reads the active profile's request log", Mx.Tiny, FontStyle.Regular, RailW - 32f),
                Mx.Tiny, FontStyle.Regular, Theme.Muted, 16f, bannerY + 55f);
            RectangleF viewRect = new RectangleF(16f, bannerY + 73f, 96f, 28f);
            if (hover == "view-requests")
            {
                Theme.Fill(g, viewRect, 4f, Theme.SidebarAccent);
            }
            Theme.Text(g, "View requests", Mx.Small, FontStyle.Regular, Theme.Fg, viewRect.X, viewRect.Y + 7f);
            ChromeHit("nav:requests", viewRect);

            // The web's LatestChange close button is opacity-0 until the card is
            // hovered (group-hover/latest-change:opacity-100), so it stays hidden
            // unless the pointer is actually over it.
            RectangleF closeRect = new RectangleF(RailW - 32f, bannerY + 9f, 24f, 24f);
            if (hover == "banner-close")
            {
                Theme.Fill(g, closeRect, 12f, Theme.SidebarAccent);
                Glyph.Draw(g, "x", new RectangleF(closeRect.X + 7f, closeRect.Y + 7f, 10f, 10f), Theme.Muted, 1.5f);
            }
            ChromeHit("banner-close", closeRect);
        }

        /// <summary>The rail's painted width; the separator sits on its last pixel.</summary>
        private float RailW
        {
            get { return SidebarW - 1f; }
        }

        /// <summary>SidebarMenuButton: w-full inside the rail's p-2 padding.</summary>
        private float CollapsedItemW
        {
            get { return SidebarW - 17f; }
        }

        private float SidebarGroup(Graphics g, float y, string label)
        {
            if (State.SidebarCollapsed)
            {
                return y + 10f;
            }
            // SidebarGroupLabel: h-8, px-2, text-xs font-medium, sidebar-foreground/70.
            Color color = Theme.Dark ? Color.FromArgb(178, 178, 178) : Color.FromArgb(64, 64, 64);
            Theme.Text(g, label, Mx.Small, FontStyle.Regular, color, 16f,
                Theme.CenterY(g, y, y + 32f, Mx.Small, FontStyle.Regular));
            return y + 32f;
        }

        private float SidebarItem(Graphics g, float y, string key, string glyph, string label)
        {
            RectangleF rect = State.SidebarCollapsed
                ? new RectangleF((SidebarW - 32f) / 2f, y, 32f, 32f)
                : new RectangleF(8f, y, CollapsedItemW, 32f);
            bool active = State.Page == key;
            DrawSidebarRow(g, rect, key, glyph, label, active, false);
            ChromeHit("nav:" + key, rect);
            return y + 32f;
        }

        private void DrawSidebarRow(Graphics g, RectangleF rect, string key, string glyph, string label, bool active,
            bool small)
        {
            bool hovered = hover == "nav:" + key || hover == key;
            if (active)
            {
                Theme.Fill(g, rect, 8f, Theme.SidebarAccent);
            }
            else if (hovered)
            {
                Theme.Fill(g, rect, 8f, Theme.Alpha(Theme.SidebarAccent, 160));
            }
            // The rail paints its labels with text-foreground/75, which composites
            // to ~190 over the 10,10,10 background.
            Color color = active || hovered ? Theme.Fg : Color.FromArgb(190, 190, 190);
            if (!Theme.Dark && !active)
            {
                color = hovered ? Theme.Fg : Color.FromArgb(90, 90, 90);
            }
            float glyphSize = small ? 14f : 16f;
            if (State.SidebarCollapsed)
            {
                Glyph.Draw(g, glyph, new RectangleF(rect.X + (rect.Width - 16f) / 2f, rect.Y + 8f, 16f, 16f), color, 1.6f);
                return;
            }
            Glyph.Draw(g, glyph, new RectangleF(rect.X + 8f, rect.Y + (rect.Height - glyphSize) / 2f, glyphSize, glyphSize),
                color, 1.6f);
            Theme.Text(g, label, small ? Mx.Small : Mx.Body, FontStyle.Regular, color, rect.X + 32f,
                Theme.CenterY(g, rect.Y, rect.Bottom, small ? Mx.Small : Mx.Body, FontStyle.Regular));
        }

        // -- top bar ----------------------------------------------------------
        // Measured on the live header at 1440x900: the trigger at x=280, the
        // separator at 320, the breadcrumb at 341, the search field 1193..1319,
        // the theme button at 1331, the second separator at 1371 and the avatar
        // at 1384 (32px). Everything is vertically centred on the 56px bar.
        private const float TopBarRight = 1384f + 32f + 8f;

        private void DrawTopBar(Graphics g)
        {
            Theme.FillRect(g, new RectangleF(MainX, 0f, MainW, TopBarH), Theme.Bg);
            Cards.Line(g, MainX, TopBarH - 1f, MainW, Theme.Border);
            // SidebarInset draws the boundary on the rail's final pixel (255).
            Cards.VLine(g, RailW, 0f, H, Theme.Border);

            // Right cluster, laid out from the avatar leftwards.
            float avatarX = W - 24f - 32f;
            RectangleF avatar = new RectangleF(avatarX, 12f, 32f, 32f);
            Theme.Fill(g, avatar, 16f, Theme.Secondary);
            Glyph.Draw(g, "server", new RectangleF(avatar.X + 8f, avatar.Y + 8f, 16f, 16f), Theme.Fg, 1.6f);
            // Avatar root always paints after:border after:border-border.
            Theme.Stroke(g, avatar, 16f, hover == "avatar" ? Theme.Input : Theme.Border, 1f);
            ChromeHit("avatar", avatar);

            Cards.VLine(g, avatarX - 13f, 20f, 16f, Theme.Border);

            RectangleF themeBtn = new RectangleF(avatarX - 13f - 12f - 28f, 14f, 28f, 28f);
            Cards.Button(g, themeBtn, "", BtnKind.Outline, null, hover == "theme");
            Glyph.Draw(g, State.Light ? "moon" : "sun",
                new RectangleF(themeBtn.X + 7f, themeBtn.Y + 7f, 14f, 14f), Theme.Fg, 1.5f);
            ChromeHit("theme", themeBtn);

            // CommandMenu trigger: h-7, rounded-lg, bordered, with the KbdGroup.
            RectangleF search = new RectangleF(themeBtn.X - 12f - 126f, 14f, 126f, 28f);
            Theme.Fill(g, search, 8f, hover == "search" ? Theme.Secondary : Theme.Bg);
            Theme.Stroke(g, search, 8f, Theme.Border, 1f);
            Glyph.Draw(g, "search", new RectangleF(search.X + 8f, search.Y + 7f, 14f, 14f), Theme.Muted, 1.5f);
            Theme.Text(g, "Search", Mx.Small, FontStyle.Regular, Theme.Muted, search.X + 27f,
                Theme.CenterY(g, search.Y, search.Bottom, Mx.Small, FontStyle.Regular));
            // KbdGroup: two 20px keys, the second 4px after the first.
            float kbdX = search.Right - 54f;
            Kbd(g, kbdX, search.Y + 4f, "\u2318", 21f);
            Kbd(g, kbdX + 25f, search.Y + 4f, "K", 20f);
            ChromeHit("search", search);

            // Left cluster: the sidebar trigger, its separator and the breadcrumb.
            RectangleF trigger = new RectangleF(MainX + 24f, 14f, 28f, 28f);
            if (hover == "sidebar")
            {
                Theme.Fill(g, trigger, 6f, Theme.Secondary);
            }
            Glyph.Draw(g, "panel", new RectangleF(trigger.X + 6f, trigger.Y + 6f, 16f, 16f), Theme.Fg, 1.6f);
            ChromeHit("sidebar", trigger);

            Cards.VLine(g, trigger.X + 40f, 20f, 16f, Theme.Border);

            PageDef page = PageInfo();
            float glyphX = trigger.X + 61f;
            Glyph.Draw(g, page.Glyph, new RectangleF(glyphX, 21f, 14f, 14f), Theme.Fg, 1.5f);
            Theme.Text(g, page.Title, Mx.Body, FontStyle.Regular, Theme.Fg, glyphX + 20f,
                Theme.CenterY(g, 0f, TopBarH, Mx.Body, FontStyle.Regular));

            if (Loading)
            {
                // The web's AutoRefresh spins the icon while a refresh is pending.
                Glyph.Draw(g, "refresh", new RectangleF(search.X - 26f, 21f, 14f, 14f), Theme.Muted, 1.5f);
            }
        }

        private void KbdWide(Graphics g, float x, float y, string label)
        {
            float width = Theme.Measure(g, label, 10f, FontStyle.Regular) + 8f;
            RectangleF box = new RectangleF(x - width, y, width, 16f);
            Theme.Fill(g, box, 4f, Theme.Secondary);
            Theme.TextCenter(g, label, 10f, FontStyle.Regular, Theme.Muted, box.X + box.Width / 2f, box.Y + 3f);
        }

        private void Kbd(Graphics g, float x, float y, string label)
        {
            Kbd(g, x, y, label, 20f);
        }

        /// <summary>Kbd: 20px box, rounded-sm, bg-muted, text-xs.</summary>
        private void Kbd(Graphics g, float x, float y, string label, float width)
        {
            RectangleF box = new RectangleF(x, y, width, 20f);
            Theme.Fill(g, box, 4f, Theme.Secondary);
            Theme.TextCenter(g, label, 10f, FontStyle.Regular, Theme.Muted, box.X + box.Width / 2f, box.Y + 5f);
        }

        private struct PageDef
        {
            public string Title;
            public string Glyph;
        }

        private PageDef PageInfo()
        {
            PageDef page = new PageDef();
            if (State.Page == "requests")
            {
                page.Title = "Requests";
                page.Glyph = "activity";
            }
            else if (State.Page == "models")
            {
                page.Title = "Models";
                page.Glyph = "cpu";
            }
            else if (State.Page == "deepseek")
            {
                page.Title = "DeepSeek";
                page.Glyph = "sparkles";
            }
            else if (State.Page == "command-code")
            {
                page.Title = "Command Code";
                page.Glyph = "gauge";
            }
            else
            {
                page.Title = "Overview";
                page.Glyph = "layout-grid";
            }
            return page;
        }

        // -- footer -----------------------------------------------------------
        private void DrawFooter(Graphics g)
        {
            Theme.FillRect(g, new RectangleF(MainX, H - FooterH, MainW, FooterH), Theme.Bg);
            Cards.Line(g, MainX, H - FooterH - 1f, MainW, Theme.Border);

            float y = H - FooterH + 9f;
            float h = 28f;
            float x = MainX + 16f;

            float w1 = Cards.ButtonWidth(g, "Open dashboard", null) + 8f;
            RectangleF open = new RectangleF(x, y, w1, h);
            Cards.Button(g, open, "Open dashboard", BtnKind.Primary, null, hover == "web");
            ChromeHit("web", open);
            x = open.Right + 8f;

            float w2 = Cards.ButtonWidth(g, "Refresh", "refresh");
            RectangleF refresh = new RectangleF(x, y, w2, h);
            Cards.Button(g, refresh, "Refresh", BtnKind.Outline, "refresh", hover == "refresh");
            ChromeHit("refresh", refresh);
            x = refresh.Right + 8f;

            float w3 = Cards.ButtonWidth(g, "Quit", null);
            RectangleF quit = new RectangleF(x, y, w3, h);
            Cards.Button(g, quit, "Quit", BtnKind.Ghost, null, hover == "quit");
            ChromeHit("quit", quit);

            string note;
            Color noteColor;
            if (Error != null && Snap != null)
            {
                note = "offline \u00b7 showing last data";
                noteColor = Theme.Amber;
            }
            else if (Snap != null && Snap.FetchedAt != DateTime.MinValue)
            {
                note = "updated " + Fmt.Clock(Snap.FetchedAt);
                noteColor = Theme.Muted;
            }
            else
            {
                note = "";
                noteColor = Theme.Muted;
            }
            if (note.Length > 0)
            {
                Theme.TextRight(g, note, Mx.Small, FontStyle.Regular, noteColor, W - 16f,
                    Theme.CenterY(g, y, y + h, Mx.Small, FontStyle.Regular));
            }

            // Source health chip, the tray's own affordance for the header badge.
            if (Snap != null)
            {
                bool isRouter = Snap.Source == "router";
                string status = Theme.StatusText(Snap.Status, isRouter);
                float width = Cards.BadgeWidth(g, status, null) + 8f;
                RectangleF badge = new RectangleF(W - 16f - 0f - width, y + 4f, width, Mx.BadgeH);
                float noteWidth = note.Length > 0 ? Theme.Measure(g, note, Mx.Small, FontStyle.Regular) + 16f : 0f;
                badge.X = W - 16f - noteWidth - width;
                bool bad = isRouter && Snap.Status != "live";
                Theme.Pill(g, badge, bad ? Theme.RedSoft : Theme.Secondary, Color.Empty);
                using (SolidBrush brush = new SolidBrush(bad ? Theme.Red : Theme.Emerald))
                {
                    g.FillEllipse(brush, badge.X + 8f, badge.Y + 7.5f, 5f, 5f);
                }
                Theme.Text(g, status, Mx.Small, FontStyle.Regular, bad ? Theme.Red : Theme.Fg, badge.X + 18f,
                    Theme.CenterY(g, badge.Y, badge.Bottom, Mx.Small, FontStyle.Regular));
            }
        }

        // -- content ----------------------------------------------------------
        private void DrawContent(Graphics g)
        {
            if (Snap == null)
            {
                DrawEmpty(g);
                return;
            }
            if (State.Page == "requests")
            {
                DrawRequestsPage(g);
            }
            else if (State.Page == "models")
            {
                DrawModelsPage(g);
            }
            else if (State.Page == "deepseek")
            {
                DrawDeepSeekPage(g);
            }
            else if (State.Page == "command-code")
            {
                DrawCommandCodePage(g);
            }
            else
            {
                DrawOverviewPage(g);
            }
        }

        private void DrawEmpty(Graphics g)
        {
            RectangleF card = new RectangleF(PageX, Mx.Pad, PageW, 170f);
            Theme.Stroke(g, card, Mx.Radius, Theme.Border, 1f);
            Cards.Empty(g, card, "circle-alert", "Dashboard host is not answering",
                Error != null ? Error : "Waiting for http://127.0.0.1:3000 to come up.");
        }

        /// <summary>
        /// The page header: the web's h1 + description on the left and the
        /// switch/refresh cluster pinned to the right, exactly like the
        /// sm:flex-row sm:items-end sm:justify-between header block.
        /// </summary>
        /// <summary>Measured on the live header at 1440x900: the control row y.</summary>
        private const float PageControlY = 43f;
        /// <summary>gap-2 between the switch, the range group, the label and Refresh.</summary>
        private const float PageControlGap = 8f;

        /// <summary>A named outline button in the page header's right cluster.</summary>
        private struct HeaderAction
        {
            public string Label;
            public string Glyph;
            public string Key;

            public HeaderAction(string label, string glyph, string key)
            {
                Label = label;
                Glyph = glyph;
                Key = key;
            }
        }

        private float PageHeader(Graphics g, string title, string description, bool showSource, bool showRange)
        {
            return PageHeader(g, title, description, showSource, showRange, null);
        }

        private float PageHeader(Graphics g, string title, string description, bool showSource, bool showRange,
            HeaderAction[] actions)
        {
            // h1 at the page's p-6 inset, its description 4px below (gap-1).
            float y = Mx.PagePad;
            Theme.TextW(g, title, Mx.PageTitle, 600, Theme.Fg, PageX, y);
            Theme.Text(g, Theme.Fit(g, description, Mx.Body, FontStyle.Regular, PageW), Mx.Body,
                FontStyle.Regular, Theme.Muted, PageX, y + 28f + Mx.TitleGap);

            // The right cluster is items-center gap-2: source switch, range group,
            // the updated label and Refresh, right-aligned to the page content box.
            float right = PageX + PageW;
            float controlY = PageControlY;

            float refreshW = Cards.ButtonWidth(g, "Refresh", "refresh");
            RectangleF refresh = new RectangleF(right - refreshW, controlY, refreshW, Mx.BtnSmH);
            Cards.Button(g, refresh, "Refresh", BtnKind.Outline, "refresh", hover == "page-refresh");
            ChromeHit("refresh", refresh);
            right = refresh.X - PageControlGap;

            // Pages may add their own outline buttons (Docs, JSON) left of Refresh.
            if (actions != null)
            {
                for (int i = actions.Length - 1; i >= 0; i--)
                {
                    float width = Cards.ButtonWidth(g, actions[i].Label, actions[i].Glyph);
                    RectangleF button = new RectangleF(right - width, controlY, width, Mx.BtnSmH);
                    Cards.Button(g, button, actions[i].Label, BtnKind.Outline, actions[i].Glyph,
                        hover == actions[i].Key);
                    ChromeHit(actions[i].Key, button);
                    right = button.X - PageControlGap;
                }
            }

            string updated = Theme.UpdatedLabel(Snap.FetchedAt, DateTime.Now);
            float updatedW = Theme.Measure(g, updated, Mx.Small, FontStyle.Regular);
            Theme.TextRight(g, updated, Mx.Small, FontStyle.Regular, Theme.Muted, right,
                Theme.CenterY(g, controlY, controlY + Mx.BtnSmH, Mx.Small, FontStyle.Regular));
            right -= updatedW + PageControlGap;

            if (showRange)
            {
                right = RangeSwitcher(g, right, controlY) - PageControlGap;
            }
            if (showSource)
            {
                SourceSwitcher(g, right, controlY);
            }
            return Mx.PagePad + Mx.PageHeaderH;
        }

        /// <summary>Measured: SourceSwitcher is a p-1 box holding two h-7 buttons.</summary>
        private const float SwitcherPad = 4f;
        /// <summary>ToggleGroup size="sm" spacing 1 -> 4px between the range items.</summary>
        private const float RangeGap = 4f;

        /// <summary>The SourceSwitcher's buttons, in the reference's order.</summary>
        private static readonly string[] SourceIds = new string[] { "deepseek", "router", "harness" };
        private static readonly string[] SourceLabels = new string[]
        {
            "DeepSeek API", "Codex Router API", "DeepSeek Harness"
        };

        private float SourceSwitcherWidth(Graphics g)
        {
            float total = SwitcherPad * 2f;
            for (int i = 0; i < SourceLabels.Length; i++)
            {
                total += Theme.Measure(g, SourceLabels[i], Mx.Small, FontStyle.Regular) + 20f;
                if (i > 0)
                {
                    total += RangeGap;
                }
            }
            return total;
        }

        private float RangeItemWidth(Graphics g, string label)
        {
            return Theme.Measure(g, label, Mx.Small, FontStyle.Regular) + 20f;
        }

        private float RangeSwitcherWidth(Graphics g)
        {
            float total = 0f;
            string[] labels = new string[] { "All", "30d", "7d", "24h" };
            for (int i = 0; i < labels.Length; i++)
            {
                total += RangeItemWidth(g, labels[i]);
                if (i > 0)
                {
                    total += RangeGap;
                }
            }
            return total;
        }

        private float SourceSwitcher(Graphics g, float right, float y)
        {
            string active = Snap != null ? Snap.Source : "deepseek";

            float total = SourceSwitcherWidth(g);
            RectangleF box = new RectangleF(right - total, y, total, Mx.BtnH);
            Theme.Stroke(g, box, 8f, Theme.Border, 1f);

            float x = box.X + SwitcherPad;
            for (int i = 0; i < SourceIds.Length; i++)
            {
                float width = Theme.Measure(g, SourceLabels[i], Mx.Small, FontStyle.Regular) + 20f;
                RectangleF item = new RectangleF(x, box.Y + SwitcherPad, width, Mx.BtnH - SwitcherPad * 2f);
                bool activeItem = SourceIds[i] == active;
                string key = "source:" + SourceIds[i];
                if (activeItem)
                {
                    Theme.Fill(g, item, 6f, Theme.Secondary);
                }
                else if (hover == key)
                {
                    Theme.Fill(g, item, 6f, Theme.Alpha(Theme.Secondary, 120));
                }
                Theme.TextCenter(g, SourceLabels[i], Mx.Small, FontStyle.Regular, activeItem ? Theme.Fg : Theme.Muted,
                    item.X + item.Width / 2f, Theme.CenterY(g, item.Y, item.Bottom, Mx.Small, FontStyle.Regular));
                ChromeHit(key, item);
                x += width + RangeGap;
            }
            return box.X;
        }

        private float RangeSwitcher(Graphics g, float right, float y)
        {
            string[] labels = new string[] { "All", "30d", "7d", "24h" };
            string[] ids = new string[] { "all", "30", "7", "1" };
            float total = RangeSwitcherWidth(g);
            float start = right - total;
            for (int i = 0; i < 4; i++)
            {
                float width = RangeItemWidth(g, labels[i]);
                RectangleF item = new RectangleF(start, y, width, Mx.BtnSmH);
                bool active = ids[i] == State.Range;
                string key = "range:" + ids[i];
                if (active)
                {
                    Theme.Fill(g, item, 8f, Theme.Secondary);
                    Theme.Stroke(g, item, 8f, Theme.Input, 1f);
                }
                else
                {
                    Theme.Stroke(g, item, 8f, Theme.Border, 1f);
                    if (hover == key)
                    {
                        Theme.Fill(g, item, 8f, Theme.Alpha(Theme.Secondary, 120));
                    }
                }
                Theme.TextCenter(g, labels[i], Mx.Small, FontStyle.Regular, active ? Theme.Fg : Theme.Muted,
                    item.X + item.Width / 2f, Theme.CenterY(g, item.Y, item.Bottom, Mx.Small, FontStyle.Regular));
                ChromeHit(key, item);
                start += width + RangeGap;
            }
            return right - total;
        }

        // -- interaction ------------------------------------------------------
        private PointF ToLogical(Point point)
        {
            float scale = ScaleFactor;
            return new PointF(point.X / scale, point.Y / scale);
        }

        protected override void OnMouseMove(MouseEventArgs e)
        {
            base.OnMouseMove(e);
            lastMouse = ToLogical(e.Location);
            string key = HitTest(lastMouse);
            if (key != hover)
            {
                hover = key;
                Cursor = key.Length > 0 && !key.StartsWith("bar:") ? Cursors.Hand : Cursors.Default;
                Invalidate();
            }
        }

        protected override void OnMouseLeave(EventArgs e)
        {
            base.OnMouseLeave(e);
            if (hover.Length > 0)
            {
                hover = "";
                Cursor = Cursors.Default;
                Invalidate();
            }
        }

        protected override void OnMouseDown(MouseEventArgs e)
        {
            base.OnMouseDown(e);
            if (e.Button != MouseButtons.Left)
            {
                return;
            }
            lastMouse = ToLogical(e.Location);
            pressed = HitTest(lastMouse);
        }

        protected override void OnMouseUp(MouseEventArgs e)
        {
            base.OnMouseUp(e);
            if (e.Button != MouseButtons.Left)
            {
                return;
            }
            PointF logical = ToLogical(e.Location);
            lastMouse = logical;
            string key = HitTest(logical);
            if (key != pressed)
            {
                pressed = "";
                return;
            }
            pressed = "";
            if (key.Length == 0 && logical.Y < TopBarH && logical.X > MainX)
            {
                ReleaseCapture();
                SendMessage(Handle, WM_NCLBUTTONDOWN, (IntPtr)HTCAPTION, IntPtr.Zero);
                return;
            }
            if (key.Length == 0)
            {
                ClosePopup();
                return;
            }
            Dispatch(key);
        }

        protected override void OnMouseWheel(MouseEventArgs e)
        {
            base.OnMouseWheel(e);
            HandleWheel(e.Delta);
        }

        /// <summary>
        /// Shared with the host form: the wheel message goes to whichever
        /// window holds focus, which is not always this control.
        /// </summary>
        public void HandleWheel(int delta)
        {
            if (State.Popup.Length > 0)
            {
                State.PopupScroll -= (int)(delta / 120f) * 40;
                if (State.PopupScroll < 0) State.PopupScroll = 0;
                Invalidate();
                return;
            }
            float max = Math.Max(0f, contentHeight - Viewport);
            if (max <= 0f)
            {
                return;
            }
            float next = scroll - (delta / 120f) * 56f;
            float scale = ScaleFactor;
            next = (float)(Math.Round(next * scale) / scale);
            if (next < 0f) next = 0f;
            if (next > max) next = max;
            if (Math.Abs(next - scroll) > 0.01f)
            {
                scroll = next;
                Invalidate();
            }
        }

        private void GoToPage(string page)
        {
            if (State.Page == page)
            {
                return;
            }
            State.Page = page;
            State.TablePage = 1;
            State.Popup = "";
            scroll = 0f;
            MeasureContent();
            Invalidate();
            if (ReloadRequested != null)
            {
                ReloadRequested();
            }
        }

        private void SetSource(string source)
        {
            if (State.Source == source)
            {
                return;
            }
            State.Source = source;
            scroll = 0f;
            Invalidate();
            if (ReloadRequested != null)
            {
                ReloadRequested();
            }
        }

        private void SetRange_(string range)
        {
            if (State.Range == range)
            {
                return;
            }
            State.Range = range;
            scroll = 0f;
            Invalidate();
            if (ReloadRequested != null)
            {
                ReloadRequested();
            }
        }

        private void SetFilter(string provider, string model)
        {
            State.Provider = provider ?? "";
            State.Model = model ?? "";
            State.TablePage = 1;
            State.Popup = "";
            scroll = 0f;
            Invalidate();
            if (ReloadRequested != null)
            {
                ReloadRequested();
            }
        }

        private void Dispatch(string key)
        {
            // Any interaction that leaves the dialog closes its search field too.
            if (State.Popup != "command")
            {
                HideCommandInput();
            }
            if (key.StartsWith("url:"))
            {
                if (OpenUrlRequested != null)
                {
                    OpenUrlRequested(key.Substring(4));
                }
                return;
            }
            if (key.StartsWith("nav:"))
            {
                string page = key.Substring(4);
                if (page == "console")
                {
                    if (OpenUrlRequested != null)
                    {
                        OpenUrlRequested("http://127.0.0.1:4200");
                    }
                    return;
                }
                if (page == "json")
                {
                    if (OpenUrlRequested != null)
                    {
                        OpenUrlRequested(Api.BaseUrl + "/api/metrics?source=" + State.ApiSource);
                    }
                    return;
                }
                GoToPage(page);
                return;
            }
            if (key.StartsWith("source:"))
            {
                SetSource(key.Substring(7));
                return;
            }
            if (key.StartsWith("range:"))
            {
                SetRange_(key.Substring(6));
                return;
            }
            if (key == "refresh")
            {
                if (RefreshRequested != null)
                {
                    RefreshRequested();
                }
                return;
            }
            if (key == "web")
            {
                if (OpenWebRequested != null)
                {
                    OpenWebRequested();
                }
                return;
            }
            if (key == "quit")
            {
                if (QuitRequested != null)
                {
                    QuitRequested();
                }
                return;
            }
            if (key == "theme")
            {
                State.Light = !State.Light;
                Theme.SetDark(!State.Light);
                Invalidate();
                return;
            }
            if (key == "search")
            {
                State.Popup = "command";
                State.PopupScroll = 0;
                State.Query = "";
                State.CommandIndex = 0;
                ShowCommandInput();
                Invalidate();
                return;
            }
            if (key == "avatar")
            {
                State.Popup = State.Popup == "user" ? "" : "user";
                Invalidate();
                return;
            }
            if (key.StartsWith("user:"))
            {
                string target = key.Substring(5);
                State.Popup = "";
                if (target == "console" && OpenUrlRequested != null)
                {
                    OpenUrlRequested("http://127.0.0.1:4200");
                }
                else if (target == "health" && OpenUrlRequested != null)
                {
                    OpenUrlRequested("http://127.0.0.1:4202/v1/health");
                }
                else if (target == "json" && OpenUrlRequested != null)
                {
                    OpenUrlRequested(Api.BaseUrl + "/api/metrics?source=" + State.ApiSource);
                }
                else if (target == "reload" && ReloadRequested != null)
                {
                    ReloadRequested();
                }
                Invalidate();
                return;
            }
            if (key == "banner-close")
            {
                State.BannerClosed = true;
                Invalidate();
                return;
            }
            if (key == "sidebar")
            {
                State.SidebarCollapsed = !State.SidebarCollapsed;
                MeasureContent();
                Invalidate();
                return;
            }
            if (key == "popup-close")
            {
                ClosePopup();
                return;
            }
            if (key.StartsWith("select:"))
            {
                string which = key.Substring(7);
                State.Popup = State.Popup == which ? "" : which;
                State.PopupScroll = 0;
                Invalidate();
                return;
            }
            if (key.StartsWith("opt:"))
            {
                int split = key.IndexOf(':', 4);
                string which = key.Substring(4, split - 4);
                string value = key.Substring(split + 1);
                if (which == "provider")
                {
                    string model = State.Model;
                    if (value.Length > 0 && model.Length > 0 && !RouteExists(value, model))
                    {
                        model = "";
                    }
                    SetFilter(value, model);
                }
                else
                {
                    SetFilter(State.Provider, value);
                }
                return;
            }
            if (key == "reset")
            {
                SetFilter("", "");
                return;
            }
            if (key.StartsWith("sort:"))
            {
                string sort = key.Substring(5);
                if (State.Sort == sort)
                {
                    State.SortAsc = !State.SortAsc;
                }
                else
                {
                    State.Sort = sort;
                    State.SortAsc = false;
                }
                State.TablePage = 1;
                Invalidate();
                return;
            }
            if (key == "table:prev")
            {
                if (State.TablePage > 1)
                {
                    State.TablePage--;
                    Invalidate();
                }
                return;
            }
            if (key == "table:next")
            {
                State.TablePage++;
                Invalidate();
                return;
            }
            if (key == "export")
            {
                ExportCsv();
                return;
            }
            if (key.StartsWith("json:"))
            {
                if (OpenUrlRequested != null)
                {
                    OpenUrlRequested(Api.BaseUrl + "/api/metrics?source=" + key.Substring(5));
                }
                return;
            }
            if (key.StartsWith("cmd:"))
            {
                ExecuteCommand(key.Substring(4));
                return;
            }
        }

        private bool RouteExists(string provider, string model)
        {
            if (Snap == null)
            {
                return false;
            }
            for (int i = 0; i < Snap.AllModels.Count; i++)
            {
                if (Snap.AllModels[i].Provider == provider && Snap.AllModels[i].Model == model)
                {
                    return true;
                }
            }
            return false;
        }

        private void ExecuteCommand(string id)
        {
            State.Popup = "";
            State.Query = "";
            HideCommandInput();
            if (id == "overview" || id == "requests" || id == "models" || id == "deepseek")
            {
                GoToPage(id);
            }
            else if (id == "json")
            {
                if (OpenUrlRequested != null)
                {
                    OpenUrlRequested(Api.BaseUrl + "/api/metrics?source=" + State.ApiSource);
                }
            }
            else if (id == "console")
            {
                if (OpenUrlRequested != null)
                {
                    OpenUrlRequested("http://127.0.0.1:4200");
                }
            }
            else if (id == "refresh")
            {
                if (RefreshRequested != null)
                {
                    RefreshRequested();
                }
            }
            else if (id == "theme")
            {
                State.Light = !State.Light;
                Theme.SetDark(!State.Light);
            }
            Invalidate();
        }

        private void ExportCsv()
        {
            try
            {
                List<RecentRow> rows = SortedRecent();
                System.Text.StringBuilder builder = new System.Text.StringBuilder();
                builder.AppendLine("time,model,provider,status,durationMs,inputTokens,outputTokens,totalTokens");
                for (int i = 0; i < rows.Count; i++)
                {
                    RecentRow row = rows[i];
                    builder.Append(Csv(row.HasTime ? row.At.ToUniversalTime().ToString("o", Inv) : "")).Append(',');
                    builder.Append(Csv(row.Model)).Append(',');
                    builder.Append(Csv(row.Provider)).Append(',');
                    builder.Append(row.Status.ToString(Inv)).Append(',');
                    builder.Append(((int)row.DurationMs).ToString(Inv)).Append(',');
                    builder.Append(((int)row.InputTokens).ToString(Inv)).Append(',');
                    builder.Append(((int)row.OutputTokens).ToString(Inv)).Append(',');
                    builder.Append(((int)row.Tokens).ToString(Inv));
                    builder.AppendLine();
                }
                string dir = System.IO.Path.Combine(Api.ProjectRoot, "logs");
                System.IO.Directory.CreateDirectory(dir);
                string file = System.IO.Path.Combine(dir,
                    "router-requests-" + DateTime.Now.ToString("yyyy-MM-dd-HHmmss", Inv) + ".csv");
                System.IO.File.WriteAllText(file, builder.ToString(), System.Text.Encoding.UTF8);
                System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(file) { UseShellExecute = true });
            }
            catch
            {
            }
        }

        private static string Csv(string value)
        {
            if (value == null)
            {
                return "";
            }
            if (value.IndexOf(',') >= 0 || value.IndexOf('"') >= 0 || value.IndexOf('\n') >= 0)
            {
                return "\"" + value.Replace("\"", "\"\"") + "\"";
            }
            return value;
        }

        private const int WM_NCLBUTTONDOWN = 0xA1;
        private const int HTCAPTION = 2;

        [System.Runtime.InteropServices.DllImport("user32.dll")]
        private static extern bool ReleaseCapture();

        [System.Runtime.InteropServices.DllImport("user32.dll")]
        private static extern IntPtr SendMessage(IntPtr hWnd, int msg, IntPtr wParam, IntPtr lParam);
    }
}
