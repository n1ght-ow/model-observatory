using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Windows.Forms;

namespace RouterMonitorTray
{
    /// <summary>
    /// The Cmd-K command menu. Unlike the filter dropdowns this one is a real
    /// dialog: the search field is an actual TextBox hosted over the painted
    /// panel, so typing, the caret, selection and IME all behave like the web's
    /// Input component instead of a picture of one.
    /// </summary>
    internal sealed partial class PanelView
    {
        private sealed class Command
        {
            public string Id = "";
            public string Label = "";
            public string Hint = "";
            public string Keywords = "";
            public string Glyph = "";
        }

        private const float CmdWidth = 420f;
        private const float CmdSearchH = 46f;
        private const float CmdItemH = 40f;
        private const int CmdMaxVisible = 6;

        private TextBox commandInput;
        private bool syncingInput;

        /// <summary>Set by the renderer so captures include the field's text.</summary>
        public bool DiagnosticText;

        private List<Command> CommandList()
        {
            List<Command> items = new List<Command>();
            items.Add(NewCommand("overview", "Overview", "Usage, latency and token trends",
                "overview home dashboard \u603b\u89c8", "layout-grid"));
            items.Add(NewCommand("requests", "Requests", "Browse the live request log",
                "requests log calls \u8bf7\u6c42", "activity"));
            items.Add(NewCommand("models", "Models", "Compare APIs and models by tokens",
                "models api routes \u6a21\u578b", "cpu"));
            items.Add(NewCommand("deepseek", "DeepSeek", "Account, balance and native usage",
                "deepseek account balance \u8d26\u6237 \u4f59\u989d", "sparkles"));
            items.Add(NewCommand("json", "Open JSON API", "Raw snapshot for /api/metrics",
                "json api data \u63a5\u53e3", "file-json"));
            items.Add(NewCommand("console", "Open Router console", "127.0.0.1:4200",
                "console terminal router \u63a7\u5236\u53f0", "terminal"));
            items.Add(NewCommand("refresh", "Refresh dashboard", "Reload the current view",
                "refresh reload \u5237\u65b0", "refresh"));
            items.Add(NewCommand("theme", "Switch theme", "Toggle appearance",
                "theme dark light \u4e3b\u9898", "sun"));
            return items;
        }

        private static Command NewCommand(string id, string label, string hint, string keywords, string glyph)
        {
            Command command = new Command();
            command.Id = id;
            command.Label = label;
            command.Hint = hint;
            command.Keywords = keywords;
            command.Glyph = glyph;
            return command;
        }

        /// <summary>Same filter the web applies: label + hint + keywords, lowercase.</summary>
        private List<Command> FilteredCommands()
        {
            List<Command> all = CommandList();
            string needle = (State.Query ?? "").Trim().ToLowerInvariant();
            if (needle.Length == 0)
            {
                return all;
            }
            List<Command> filtered = new List<Command>();
            for (int i = 0; i < all.Count; i++)
            {
                string haystack = (all[i].Label + " " + all[i].Hint + " " + all[i].Keywords).ToLowerInvariant();
                if (haystack.IndexOf(needle, StringComparison.Ordinal) >= 0)
                {
                    filtered.Add(all[i]);
                }
            }
            return filtered;
        }

        // -- the real input ---------------------------------------------------
        private RectangleF CommandBox()
        {
            float height = CmdSearchH + CmdMaxVisible * CmdItemH + 10f;
            return new RectangleF(MainX + (MainW - CmdWidth) / 2f, ContentTop + 24f, CmdWidth, height);
        }

        /// <summary>Search row in device pixels, where the TextBox has to live.</summary>
        private Rectangle InputBounds()
        {
            RectangleF box = CommandBox();
            float scale = ScaleFactor;
            return new Rectangle(
                (int)Math.Round((box.X + 34f) * scale) + 1,
                (int)Math.Round((box.Y + 8f) * scale),
                (int)Math.Round((box.Width - 34f - 52f) * scale),
                (int)Math.Round(30f * scale));
        }

        private void EnsureInput()
        {
            if (commandInput != null)
            {
                return;
            }
            commandInput = new TextBox();
            commandInput.BorderStyle = BorderStyle.None;
            commandInput.AutoSize = false;
            commandInput.ShortcutsEnabled = true;
            commandInput.Visible = false;
            commandInput.TextChanged += delegate
            {
                if (syncingInput)
                {
                    return;
                }
                State.Query = commandInput.Text;
                State.CommandIndex = 0;
                Invalidate();
            };
            commandInput.KeyDown += CommandInputKeyDown;
            Controls.Add(commandInput);
        }

        private void StyleInput()
        {
            if (commandInput == null)
            {
                return;
            }
            float scale = ScaleFactor;
            commandInput.BackColor = Theme.Dark ? Color.FromArgb(28, 28, 28) : Color.White;
            commandInput.ForeColor = Theme.Fg;
            float px = Mx.Body * scale;
            if (px < 8f) px = 8f;
            commandInput.Font = Theme.Get(px, FontStyle.Regular, false);
        }

        private void LayoutInput()
        {
            if (commandInput == null)
            {
                return;
            }
            commandInput.Bounds = InputBounds();
            StyleInput();
        }

        private void ShowCommandInput()
        {
            EnsureInput();
            syncingInput = true;
            commandInput.Text = State.Query ?? "";
            syncingInput = false;
            LayoutInput();
            commandInput.Visible = true;
            commandInput.BringToFront();
            commandInput.Focus();
        }

        /// <summary>Diagnostics hooks for the hosted search field.</summary>
        public bool CommandInputVisible
        {
            get { return commandInput != null && commandInput.Visible; }
        }

        public string CommandInputText
        {
            get { return commandInput == null ? "" : commandInput.Text; }
        }

        public RectangleF CommandInputProbe()
        {
            if (commandInput == null)
            {
                return new RectangleF(0f, 0f, 0f, 0f);
            }
            return new RectangleF(commandInput.Left, commandInput.Top, commandInput.Width, commandInput.Height);
        }

        /// <summary>Seeds the filter exactly as if the user had typed it.</summary>
        public void SetQuery(string text)
        {
            State.Query = text ?? "";
            State.CommandIndex = 0;
            if (commandInput != null)
            {
                syncingInput = true;
                commandInput.Text = State.Query;
                syncingInput = false;
            }
            Invalidate();
        }

        /// <summary>
        /// Diagnostics render head-less, so the hosted TextBox is removed again
        /// and the paint code draws the seeded query itself.
        /// </summary>
        public void CloseInputForRender()
        {
            if (commandInput != null)
            {
                commandInput.Visible = false;
            }
            Invalidate();
        }

        private void HideCommandInput()
        {
            if (commandInput == null)
            {
                return;
            }
            commandInput.Visible = false;
            Focus();
        }

        /// <summary>
        /// Arrow keys and Enter belong to the list, not the text box, so they are
        /// handled here while every other key (and IME) reaches the field.
        /// </summary>
        private void CommandInputKeyDown(object sender, KeyEventArgs e)
        {
            List<Command> items = FilteredCommands();
            if (e.KeyCode == Keys.Down)
            {
                if (items.Count > 0)
                {
                    State.CommandIndex = (State.CommandIndex + 1) % items.Count;
                }
                e.Handled = true;
                e.SuppressKeyPress = true;
                Invalidate();
                return;
            }
            if (e.KeyCode == Keys.Up)
            {
                if (items.Count > 0)
                {
                    State.CommandIndex = (State.CommandIndex - 1 + items.Count) % items.Count;
                }
                e.Handled = true;
                e.SuppressKeyPress = true;
                Invalidate();
                return;
            }
            if (e.KeyCode == Keys.Enter)
            {
                if (State.CommandIndex >= 0 && State.CommandIndex < items.Count)
                {
                    RunCommand(items[State.CommandIndex].Id);
                }
                e.Handled = true;
                e.SuppressKeyPress = true;
                return;
            }
            if (e.KeyCode == Keys.Escape)
            {
                e.Handled = true;
                e.SuppressKeyPress = true;
                ClosePopup();
            }
        }

        private void RunCommand(string id)
        {
            State.Query = "";
            if (commandInput != null)
            {
                syncingInput = true;
                commandInput.Text = "";
                syncingInput = false;
            }
            ExecuteCommand(id);
        }

        protected override void OnResize(EventArgs e)
        {
            base.OnResize(e);
            LayoutInput();
        }

        // -- painting ---------------------------------------------------------
        private void DrawCommandMenu(Graphics g)
        {
            List<Command> items = FilteredCommands();
            RectangleF box = CommandBox();
            float listH = CmdMaxVisible * CmdItemH;
            float shown = Math.Min(items.Count, CmdMaxVisible);
            float height = CmdSearchH + Math.Max(1, shown) * CmdItemH + 10f;
            box = new RectangleF(box.X, box.Y, box.Width, height);

            // DialogPrimitive.Backdrop: bg-black/20 over the page behind it.
            Theme.FillRect(g, new RectangleF(MainX, 0f, MainW, H), Theme.Alpha(Color.Black, 51));
            ChromeHit("popup-close", new RectangleF(0f, 0f, W, box.Y));
            ChromeHit("popup-close", new RectangleF(0f, box.Bottom, W, H - box.Bottom));
            ChromeHit("popup-close", new RectangleF(0f, box.Y, box.X, box.Height));
            ChromeHit("popup-close", new RectangleF(box.Right, box.Y, W - box.Right, box.Height));

            Theme.Fill(g, box, 12f, Theme.Dark ? Color.FromArgb(28, 28, 28) : Color.White);
            Theme.Stroke(g, box, 12f, Theme.Dark ? Color.FromArgb(60, 60, 60) : Color.FromArgb(220, 220, 220), 1f);

            Glyph.Draw(g, "search", new RectangleF(box.X + 12f, box.Y + 15f, 16f, 16f), Theme.Muted, 1.6f);
            KbdWide(g, box.Right - 42f, box.Y + 15f, "Esc");
            Cards.Line(g, box.X, box.Y + CmdSearchH, box.Width, Theme.Border);

            // When the real input is up it paints its own text and caret. The
            // capture path cannot record a child control's text, so it asks the
            // paint code to draw the same string instead.
            bool ownsText = commandInput != null && commandInput.Visible && !DiagnosticText;
            if (!ownsText)
            {
                string text = State.Query ?? "";
                if (text.Length == 0)
                {
                    Theme.Text(g, "Search pages, models, actions\u2026", Mx.Body, FontStyle.Regular, Theme.Muted,
                        box.X + 36f, Theme.CenterY(g, box.Y, box.Y + CmdSearchH, Mx.Body, FontStyle.Regular));
                }
                else
                {
                    Theme.Text(g, text, Mx.Body, FontStyle.Regular, Theme.Fg, box.X + 36f,
                        Theme.CenterY(g, box.Y, box.Y + CmdSearchH, Mx.Body, FontStyle.Regular));
                }
            }

            if (items.Count == 0)
            {
                Theme.TextCenter(g, "No matching commands", Mx.Body, FontStyle.Regular, Theme.Muted,
                    box.X + box.Width / 2f, box.Y + CmdSearchH + 26f);
                return;
            }

            if (State.CommandIndex >= items.Count)
            {
                State.CommandIndex = items.Count - 1;
            }
            if (State.CommandIndex < 0)
            {
                State.CommandIndex = 0;
            }

            // Scroll so the highlighted row is always on screen.
            int first = 0;
            if (State.CommandIndex >= CmdMaxVisible)
            {
                first = State.CommandIndex - CmdMaxVisible + 1;
            }
            if (first > items.Count - CmdMaxVisible)
            {
                first = Math.Max(0, items.Count - CmdMaxVisible);
            }

            GraphicsState clip = g.Save();
            g.SetClip(new RectangleF(box.X, box.Y + CmdSearchH, box.Width, Math.Min(listH, shown * CmdItemH)));
            float itemY = box.Y + CmdSearchH + 4f;
            for (int i = 0; i < shown; i++)
            {
                Command command = items[first + i];
                RectangleF item = new RectangleF(box.X + 6f, itemY, box.Width - 12f, CmdItemH - 4f);
                itemY += CmdItemH;
                string key = "cmd:" + command.Id;
                bool active = first + i == State.CommandIndex;
                if (active || hover == key)
                {
                    Theme.Fill(g, item, 8f, Theme.Secondary);
                }
                RectangleF iconBox = new RectangleF(item.X + 4f, item.Y + 8f, 24f, 24f);
                Theme.Fill(g, iconBox, 6f, Theme.Bg);
                Theme.Stroke(g, iconBox, 6f, Theme.Border, 1f);
                string glyph = command.Id == "theme" ? (State.Light ? "moon" : "sun") : command.Glyph;
                Glyph.Draw(g, glyph, new RectangleF(iconBox.X + 5f, iconBox.Y + 5f, 14f, 14f), Theme.Fg, 1.5f);
                Theme.Text(g, command.Label, Mx.Body, FontStyle.Regular, Theme.Fg, iconBox.Right + 12f, item.Y + 6f);
                string hint = command.Id == "theme"
                    ? (State.Light ? "Switch to dark theme" : "Switch to light theme")
                    : command.Hint;
                Theme.Text(g, Theme.Fit(g, hint, Mx.Small, FontStyle.Regular, item.Width - 90f), Mx.Small,
                    FontStyle.Regular, Theme.Muted, iconBox.Right + 12f, item.Y + 24f);
                Glyph.Draw(g, "arrow-right", new RectangleF(item.Right - 22f, item.Y + 13f, 14f, 14f), Theme.Muted, 1.5f);
                ChromeHit(key, item);
            }
            g.Restore(clip);

            if (items.Count > CmdMaxVisible)
            {
                float trackH = shown * CmdItemH;
                float thumbH = Math.Max(24f, trackH * CmdMaxVisible / items.Count);
                float top = box.Y + CmdSearchH + (trackH - thumbH) * first / Math.Max(1, items.Count - CmdMaxVisible);
                Theme.Fill(g, new RectangleF(box.Right - 5f, top, 3f, thumbH), 1.5f, Theme.Alpha(Theme.Fg, 50));
            }
        }
    }
}
