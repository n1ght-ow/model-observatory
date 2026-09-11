using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Globalization;
using System.Windows.Forms;

namespace RouterMonitorTray
{
    /// <summary>
    /// The Select popups used by the Requests/Models filters and the Cmd-K
    /// command menu, drawn in the panel because a WinForms flyout has no DOM.
    /// </summary>
    internal sealed partial class PanelView
    {
        private sealed class Option
        {
            public string Value = "";
            public string Label = "";
            public string Meta = "";
        }

        private const float OptionH = 28f;
        private const float OptionPad = 4f;

        private void DrawPopups(Graphics g)
        {
            if (State.Popup.Length == 0)
            {
                return;
            }
            if (State.Popup == "command")
            {
                DrawCommandMenu(g);
                return;
            }
            if (State.Popup == "user")
            {
                DrawUserMenu(g);
                return;
            }
            DrawSelect(g, State.Popup);
        }

        private List<Option> BuildProviderOptions()
        {
            List<Option> options = new List<Option>();
            Option all = new Option();
            all.Value = "";
            all.Label = "All APIs";
            options.Add(all);
            if (Snap == null)
            {
                return options;
            }

            List<ProviderRow> rows = new List<ProviderRow>();
            for (int i = 0; i < Snap.AllModels.Count; i++)
            {
                ModelRow model = Snap.AllModels[i];
                string name = string.IsNullOrEmpty(model.Provider) ? "unknown" : model.Provider;
                int found = -1;
                for (int j = 0; j < rows.Count; j++)
                {
                    if (rows[j].Provider == name)
                    {
                        found = j;
                        break;
                    }
                }
                if (found < 0)
                {
                    ProviderRow row = new ProviderRow();
                    row.Provider = name;
                    row.Requests = model.Requests;
                    rows.Add(row);
                }
                else
                {
                    rows[found].Requests += model.Requests;
                }
            }
            rows.Sort(delegate (ProviderRow a, ProviderRow b)
            {
                int byRequests = b.Requests.CompareTo(a.Requests);
                return byRequests != 0 ? byRequests : string.CompareOrdinal(a.Provider, b.Provider);
            });

            for (int i = 0; i < rows.Count; i++)
            {
                Option option = new Option();
                option.Value = rows[i].Provider;
                option.Label = rows[i].Provider;
                // The web lists the provider's request count next to its name.
                option.Meta = Fmt.Int(rows[i].Requests);
                options.Add(option);
            }
            return options;
        }

        private List<Option> BuildModelOptions()
        {
            List<Option> options = new List<Option>();
            double total = 0;
            if (Snap != null)
            {
                for (int i = 0; i < Snap.AllModels.Count; i++)
                {
                    if (State.Provider.Length == 0 || Snap.AllModels[i].Provider == State.Provider)
                    {
                        total += Snap.AllModels[i].Requests;
                    }
                }
            }
            Option all = new Option();
            all.Value = "";
            all.Label = "All models";
            all.Meta = Fmt.Int(total);
            options.Add(all);
            if (Snap == null)
            {
                return options;
            }

            List<ModelRow> rows = new List<ModelRow>();
            List<int> providerCounts = new List<int>();
            for (int i = 0; i < Snap.AllModels.Count; i++)
            {
                ModelRow model = Snap.AllModels[i];
                if (State.Provider.Length > 0 && model.Provider != State.Provider)
                {
                    continue;
                }
                int found = -1;
                for (int j = 0; j < rows.Count; j++)
                {
                    if (rows[j].Model == model.Model)
                    {
                        found = j;
                        break;
                    }
                }
                if (found < 0)
                {
                    ModelRow copy = new ModelRow();
                    copy.Model = model.Model;
                    copy.Provider = model.Provider;
                    copy.Requests = model.Requests;
                    rows.Add(copy);
                    providerCounts.Add(1);
                }
                else
                {
                    rows[found].Requests += model.Requests;
                    providerCounts[found] = providerCounts[found] + 1;
                }
            }
            List<int> order = new List<int>();
            for (int i = 0; i < rows.Count; i++)
            {
                order.Add(i);
            }
            order.Sort(delegate (int a, int b)
            {
                int byRequests = rows[b].Requests.CompareTo(rows[a].Requests);
                if (byRequests != 0) return byRequests;
                return string.CompareOrdinal(rows[a].Model, rows[b].Model);
            });

            for (int i = 0; i < order.Count; i++)
            {
                int index = order[i];
                Option option = new Option();
                option.Value = rows[index].Model;
                option.Label = Fmt.Model(rows[index].Model);
                option.Meta = providerCounts[index] > 1 && State.Provider.Length == 0
                    ? providerCounts[index] + " APIs"
                    : Fmt.Int(rows[index].Requests);
                options.Add(option);
            }
            return options;
        }

        private void DrawSelect(Graphics g, string which)
        {
            bool isProvider = which == "provider";
            RectangleF anchor = isProvider ? selectProviderRect : selectModelRect;
            if (anchor.Width <= 0f)
            {
                return;
            }
            List<Option> options = isProvider ? BuildProviderOptions() : BuildModelOptions();
            string selected = isProvider ? State.Provider : State.Model;

            float width = Math.Max(isProvider ? 240f : 288f, anchor.Width);
            if (width > W - 32f)
            {
                width = W - 32f;
            }
            float maxList = 280f;
            float listHeight = Math.Min(maxList, options.Count * OptionH + OptionPad * 2f);
            float x = anchor.X;
            if (x + width > W - 16f)
            {
                x = W - 16f - width;
            }
            float y = anchor.Bottom - scroll + ContentTop + 4f;
            if (y + listHeight + 8f > H - FooterH)
            {
                y = Math.Max(ContentTop + 4f, anchor.Y - scroll + ContentTop - listHeight - 4f);
            }

            RectangleF box = new RectangleF(x, y, width, listHeight);
            // The popup floats above the page, so it fills the panel background.
            Theme.Fill(g, box, 10f, Theme.Dark ? Color.FromArgb(30, 30, 30) : Color.White);
            Theme.Stroke(g, box, 10f, Theme.Dark ? Color.FromArgb(60, 60, 60) : Color.FromArgb(220, 220, 220), 1f);
            ChromeHit("popup-close", box);

            float maxScroll = Math.Max(0f, options.Count * OptionH + OptionPad * 2f - listHeight);
            float popupScroll = State.PopupScroll;
            if (popupScroll > maxScroll) popupScroll = maxScroll;
            State.PopupScroll = (int)popupScroll;

            GraphicsState state = g.Save();
            g.SetClip(box);
            float itemY = box.Y + OptionPad - popupScroll;
            for (int i = 0; i < options.Count; i++)
            {
                RectangleF item = new RectangleF(box.X + 4f, itemY, box.Width - 8f, OptionH);
                itemY += OptionH;
                if (item.Bottom < box.Y || item.Y > box.Bottom)
                {
                    continue;
                }
                string key = "opt:" + which + ":" + options[i].Value;
                bool active = options[i].Value == selected;
                if (hover == key)
                {
                    Theme.Fill(g, item, 6f, Theme.Secondary);
                }
                Theme.Text(g, Theme.Fit(g, options[i].Label, Mx.Body, FontStyle.Regular, item.Width - 80f),
                    Mx.Body, FontStyle.Regular, Theme.Fg, item.X + 6f,
                    Theme.CenterY(g, item.Y, item.Bottom, Mx.Body, FontStyle.Regular));
                if (options[i].Meta.Length > 0)
                {
                    Theme.TextRight(g, options[i].Meta, Mx.Small, FontStyle.Regular, Theme.Muted, item.Right - 24f,
                        Theme.CenterY(g, item.Y, item.Bottom, Mx.Small, FontStyle.Regular));
                }
                if (active)
                {
                    Glyph.Draw(g, "check", new RectangleF(item.Right - 22f, item.Y + 7f, 14f, 14f), Theme.Fg, 1.6f);
                }
                ChromeHit(key, item);
            }
            g.Restore(state);
        }


        /// <summary>
        /// The header's account menu: the web NavUser dropdown with the account
        /// label, its separator and the four endpoint shortcuts.
        /// </summary>
        private void DrawUserMenu(Graphics g)
        {
            float width = 248f;
            float x = W - 16f - width;
            float y = ContentTop + 8f;

            string[] labels = new string[] { "Router console", "Router health", "Usage JSON", "Reload data" };
            string[] glyphs = new string[] { "terminal", "server", "file-json", "refresh" };
            string[] hints = new string[] { "127.0.0.1:4200", "127.0.0.1:4202/v1/health", "/api/metrics", "Reload the current view" };
            string[] keys = new string[] { "user:console", "user:health", "user:json", "user:reload" };

            float headH = 66f;
            float itemH = 34f;
            float height = headH + 9f + labels.Length * itemH + 8f;
            RectangleF box = new RectangleF(x, y, width, height);

            // Anything outside the menu closes it, the way a dropdown backdrop does.
            ChromeHit("popup-close", new RectangleF(0f, 0f, W, box.Y));
            ChromeHit("popup-close", new RectangleF(0f, box.Bottom, W, H - box.Bottom));
            ChromeHit("popup-close", new RectangleF(0f, box.Y, box.X, box.Height));
            ChromeHit("popup-close", new RectangleF(box.Right, box.Y, W - box.Right, box.Height));

            Theme.Fill(g, box, 10f, Theme.Dark ? Color.FromArgb(30, 30, 30) : Color.White);
            Theme.Stroke(g, box, 10f, Theme.Dark ? Color.FromArgb(60, 60, 60) : Color.FromArgb(220, 220, 220), 1f);

            RectangleF avatar = new RectangleF(box.X + 12f, box.Y + 12f, 40f, 40f);
            Theme.Fill(g, avatar, 20f, Theme.Secondary);
            Glyph.Draw(g, "server", new RectangleF(avatar.X + 12f, avatar.Y + 12f, 16f, 16f), Theme.Fg, 1.6f);
            Theme.Text(g, "Codex Router", Mx.Body, FontStyle.Regular, Theme.Fg, avatar.Right + 12f, box.Y + 18f);
            Theme.Text(g, "localhost:4202", Mx.Small, FontStyle.Regular, Theme.Muted, avatar.Right + 12f, box.Y + 38f);

            Cards.Line(g, box.X + 8f, box.Y + headH, box.Width - 16f, Theme.Border);

            float itemY = box.Y + headH + 9f;
            for (int i = 0; i < labels.Length; i++)
            {
                RectangleF item = new RectangleF(box.X + 6f, itemY, box.Width - 12f, itemH - 2f);
                itemY += itemH;
                string key = keys[i];
                if (hover == key)
                {
                    Theme.Fill(g, item, 6f, Theme.Secondary);
                }
                Glyph.Draw(g, glyphs[i], new RectangleF(item.X + 8f, item.Y + 8f, 16f, 16f), Theme.Fg, 1.6f);
                Theme.Text(g, labels[i], Mx.Body, FontStyle.Regular, Theme.Fg, item.X + 32f,
                    Theme.CenterY(g, item.Y, item.Bottom, Mx.Body, FontStyle.Regular));
                if (hover == key)
                {
                    Theme.TextRight(g, hints[i], Mx.Small, FontStyle.Regular, Theme.Muted, item.Right - 8f,
                        Theme.CenterY(g, item.Y, item.Bottom, Mx.Small, FontStyle.Regular));
                }
                ChromeHit(key, item);
            }
        }
    }
}
