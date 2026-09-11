using System;
using System.Collections.Generic;
using System.Drawing;
using System.Globalization;

namespace RouterMonitorTray
{
    /// <summary>
    /// The Command Code page: the account's all-time usage tiles, its paced
    /// credit windows, remaining credits, the account identity, the billing
    /// subscription and the health of the four commandcode.ai endpoints.
    /// </summary>
    internal sealed partial class PanelView
    {
        // Measured on the live page: the four stat tiles are 113 tall (label,
        // value, then a 49px footer — this grid has no sparkline), the paced-window
        // row 400, the account row 310 and the endpoint-health row 195.
        private const float CcStatusH = 113f;
        private const float CcRowH = 400f;
        private const float CcAccountH = 310f;
        private const float CcHealthH = 195f;

        private RectangleF ccStats;
        private RectangleF ccWindows;
        private RectangleF ccCredits;
        private RectangleF ccAccount;
        private RectangleF ccSub;
        private RectangleF ccHealth;

        private void LayoutCommandCode()
        {
            float y = Mx.PagePad + Mx.PageHeaderH + Mx.CardGap + 1f;
            float gridX = PageX + 1f;
            float gridW = PageW - 2f;
            float col2 = (float)Math.Ceiling((gridW - 1f) / 2f);
            float col2b = gridW - 1f - col2;

            ccStats = new RectangleF(gridX, y, gridW, CcStatusH);
            y += CcStatusH + 1f;

            ccWindows = new RectangleF(gridX, y, col2, CcRowH);
            ccCredits = new RectangleF(gridX + col2 + 1f, y, col2b, CcRowH);
            y += CcRowH + 1f;

            ccAccount = new RectangleF(gridX, y, col2, CcAccountH);
            ccSub = new RectangleF(gridX + col2 + 1f, y, col2b, CcAccountH);
            y += CcAccountH + 1f;

            ccHealth = new RectangleF(gridX, y, gridW, CcHealthH);
            y += CcHealthH;

            contentHeight = y + Mx.PagePad;
        }

        private void DrawCommandCodePage(Graphics g)
        {
            CommandCodeInfo info = Snap.CommandCode;
            // The page header carries its own Docs and JSON buttons, like the web.
            PageHeader(g, "Command Code",
                "Account usage, credit balance, and the 5-hour, weekly and monthly limit windows.",
                false, false, new HeaderAction[]
                {
                    new HeaderAction("Docs", "external-link", "url:https://commandcode.ai/docs/resources/usage-limits"),
                    new HeaderAction("JSON", "refresh", "url:http://127.0.0.1:3000/api/command-code?fresh=1")
                });

            if (info == null || !info.Configured)
            {
                DrawCommandCodeEmpty(g, info);
                return;
            }

            GridRow(g, ccStats, 4);
            DrawCommandCodeStats(g, info);

            GridPair(g, ccWindows, ccCredits);
            DrawCreditWindows(g, info);
            DrawCredits(g, info);

            GridPair(g, ccAccount, ccSub);
            DrawCommandAccount(g, info);
            DrawSubscription(g, info);

            GridOutline(g, ccHealth);
            DrawEndpointHealth(g, info);
        }

        private void DrawCommandCodeEmpty(Graphics g, CommandCodeInfo info)
        {
            RectangleF card = new RectangleF(PageX + 1f, Mx.PagePad + Mx.PageHeaderH + Mx.CardGap + 1f,
                PageW - 2f, 200f);
            GridOutline(g, card);
            string detail = info != null && info.Error.Length > 0
                ? info.Error
                : "Add a Command Code API key to read usage and limits.";
            Cards.Empty(g, card, "key-round", "Command Code is not configured", detail);
        }

        private void DrawCommandCodeStats(Graphics g, CommandCodeInfo info)
        {
            CommandUsage usage = info.Usage ?? new CommandUsage();
            float cell = (ccStats.Width - 3f) / 4f;
            string[] labels = new string[] { "Requests", "Success rate", "Total spend", "Tokens" };
            string[] glyphs = new string[] { "activity", "gauge", "circle-dollar", "coins" };
            string[] values = new string[]
            {
                Fmt.Int(usage.TotalCount),
                usage.SuccessRate.ToString("0.00", Inv) + "%",
                Fmt.Money("USD", usage.TotalCost),
                Theme.Compact(usage.Tokens)
            };
            string[] footers = new string[]
            {
                Fmt.Int(usage.FailedCount) + " failed \u00b7 " + Fmt.Int(usage.CompletedCount) + " completed",
                "all-time success rate",
                "credits billed all-time",
                Theme.Compact(usage.TokensIn) + " in \u00b7 " + Theme.Compact(usage.TokensOut) + " out"
            };

            for (int i = 0; i < 4; i++)
            {
                // CardHeader py-4 px-4 (title 16px), CardContent holding the 32px
                // value, then a 49px CardFooter: border-t + py-4 around a 16px line.
                RectangleF tile = new RectangleF(ccStats.X + i * (cell + 1f), ccStats.Y, cell, ccStats.Height);
                Theme.Text(g, labels[i], Mx.Small, FontStyle.Regular, Theme.Fg, tile.X + Mx.CardPad, tile.Y + 16f);
                Glyph.Draw(g, glyphs[i], new RectangleF(tile.Right - Mx.CardPad - 14f, tile.Y + 17f, 14f, 14f),
                    Theme.Muted, 1.5f);
                Theme.TextT(g, values[i], Mx.StatValue, FontStyle.Bold, Theme.Fg, tile.X + Mx.CardPad, tile.Y + 32f);
                float ruleY = tile.Bottom - 49f;
                Cards.Line(g, tile.X, ruleY, tile.Width, Theme.Border);
                Theme.Text(g, Theme.Fit(g, footers[i], Mx.Small, FontStyle.Regular, tile.Width - Mx.CardPad * 2f),
                    Mx.Small, FontStyle.Regular, Theme.Muted, tile.X + Mx.CardPad, ruleY + 17f);
            }
        }
        private void DrawCreditWindows(Graphics g, CommandCodeInfo info)
        {
            RectangleF card = ccWindows;
            List<CommandWindow> windows = info.Windows;
            float contentTop = Cards.Header(g, card, "Credit windows",
                "Command Code paces billing with a rolling 5-hour window, a weekly window, and the monthly credit grant of the current billing cycle.",
                true, Mx.TitleLineBase);
            Cards.Badge(g, card.X + Mx.CardPad +
                Theme.MeasureW(g, "Credit windows", Mx.CardTitle, 500) + 8f,
                card.Y + Mx.CardPad, windows.Count + " windows", BadgeKind.Outline);

            // The web's CardContent is px-6 py-4, so the first block sits 16px
            // under the header rule.
            float y = contentTop + 16f;
            if (windows.Count == 0)
            {
                Theme.Text(g, "No paced windows reported \u2014 extra credits are never limited.",
                    Mx.Body, FontStyle.Regular, Theme.Muted, card.X + Mx.CardPad, y + 6f);
                return;
            }
            float listRight = card.Right - Mx.CardPad;
            for (int i = 0; i < windows.Count; i++)
            {
                CommandWindow window = windows[i];
                Theme.Text(g, window.Label, Mx.Body, FontStyle.Regular, Theme.Fg, card.X + Mx.CardPad, y);
                float labelWidth = Theme.Measure(g, window.Label, Mx.Body, FontStyle.Regular);
                string pct = window.Cap <= 0 ? "no cap" : window.UsedPct.ToString("0.0", Inv) + "%";
                Cards.Badge(g, card.X + Mx.CardPad + labelWidth + 8f, y - 2f, pct, BadgeKind.Outline, null,
                    ToneColor(window.UsedPct));

                string amount = Fmt.Money("USD", window.Used) +
                    (window.Cap <= 0 ? "" : " / " + Fmt.Money("USD", window.Cap)) + " credits";
                Theme.TextRight(g, amount, Mx.Small, FontStyle.Regular, Theme.Muted, listRight, y + 2f);

                // Measured on the live block: flex-col gap-2, so a 20px label row,
                // the h-1.5 bar 8px under it, and the footer row 8px under that.
                RectangleF track = new RectangleF(card.X + Mx.CardPad, y + 28f, card.Width - Mx.CardPad * 2f, 6f);
                Theme.Fill(g, track, 3f, Theme.Secondary);
                float pctValue = (float)Math.Min(Math.Max(window.UsedPct, 0), 100);
                if (pctValue > 0.5f)
                {
                    Theme.Fill(g, new RectangleF(track.X, track.Y, track.Width * pctValue / 100f, track.Height),
                        3f, ToneColor(window.UsedPct));
                }

                Theme.Text(g, window.Cap <= 0 ? "unlimited credits" : Fmt.Money("USD", window.Remaining) + " credits left",
                    Mx.Small, FontStyle.Regular, Theme.Muted, card.X + Mx.CardPad, y + 42f);
                Theme.TextRight(g, ResetLabel(window), Mx.Small, FontStyle.Regular, Theme.Muted, listRight, y + 42f);
                // The block is 58 tall and the CardContent's gap-4 adds 16, so the
                // three windows pitch at 74 rather than the original 84.
                y += 74f;
            }

            // Pinned to the card's bottom, 61 tall because it holds a button
            // (border-t + py-4 around a 28px control, not a 16px text line).
            float footerY = card.Bottom - Cards.FooterWithButton;
            Cards.TileFooter(g, card, footerY);
            Theme.Text(g, "Checked " + (info.HasFetchedAt ? Fmt.AccountTime(info.FetchedAt) : "\u2014") +
                (info.LatencyMs > 0 ? " \u00b7 " + Fmt.Int(info.LatencyMs) + " ms" : ""),
                Mx.Small, FontStyle.Regular, Theme.Muted, card.X + Mx.CardPad,
                footerY + 1f + 16f + (Mx.BtnSmH - 16f) / 2f);
            float linkW = Cards.ButtonWidth(g, "How limits work", "external-link");
            RectangleF link = new RectangleF(card.Right - Mx.CardPad - linkW, footerY + 8f, linkW, Mx.BtnSmH);
            Cards.Button(g, link, "How limits work", BtnKind.Ghost, "external-link", hover == "cc-docs");
            Hit("url:https://commandcode.ai/docs/resources/usage-limits", link);
        }

        private void DrawCredits(Graphics g, CommandCodeInfo info)
        {
            RectangleF card = ccCredits;
            CommandUsage usage = info.Usage ?? new CommandUsage();
            float contentTop = Cards.Header(g, card, "Credits", "Remaining credits returned by /alpha/billing/credits.", true, Mx.TitleLineBase);
            Cards.Badge(g, card.X + Mx.CardPad +
                Theme.Measure(g, "Credits", Mx.CardTitle, FontStyle.Regular) + 8f,
                card.Y + Mx.CardPad, info.PlanId.Length > 0 ? info.PlanId : "no active plan", BadgeKind.Secondary);

            // Measured on the live card: the bordered box is 154 tall starting 16px
            // under the header rule, and the four stat pairs sit on a 44px pitch.
            float y = contentTop + 16f;
            RectangleF box = new RectangleF(card.X + Mx.CardPad, y, card.Width - Mx.CardPad * 2f, 154f);
            Theme.Stroke(g, box, 8f, Theme.Border, 1f);
            Theme.Text(g, "Remaining this cycle", Mx.Body, FontStyle.Regular, Theme.Muted, box.X + 16f, box.Y + 27f);
            Theme.TextRightW(g, Fmt.Money("USD", usage.MonthlyCredits), 24f, 600, Theme.Fg,
                box.Right - 16f, box.Y + 17f);

            float half = (box.Width - 44f) / 2f + 12f;
            string[] labels = new string[] { "Purchased", "Free", "Spent this cycle", "Credit threshold" };
            string[] values = new string[]
            {
                Fmt.Money("USD", usage.PurchasedCredits),
                Fmt.Money("USD", usage.FreeCredits),
                Fmt.Money("USD", usage.TotalCredits),
                Fmt.Money("USD", info.Threshold)
            };
            float textY = box.Y + 61f;
            for (int i = 0; i < 4; i++)
            {
                float cx = box.X + 16f + (i % 2) * half;
                float cy = textY + (i / 2) * 44f;
                Theme.Text(g, labels[i], Mx.Small, FontStyle.Regular, Theme.Muted, cx, cy);
                Theme.TextW(g, values[i], Mx.Body, 500, Theme.Fg, cx, cy + 16f);
            }

            if (info.BelowThreshold)
            {
                RectangleF warn = new RectangleF(card.X + Mx.CardPad, box.Bottom + 12f, box.Width, 32f);
                Theme.Fill(g, warn, 6f, Theme.RedSoft);
                Theme.Text(g, "Balance is below the configured credit threshold.", Mx.Small, FontStyle.Regular,
                    Theme.Destructive, warn.X + 12f, Theme.CenterY(g, warn.Y, warn.Bottom, Mx.Small, FontStyle.Regular));
            }

            // This card's footer follows its content (the row is taller because the
            // paced-window card beside it is): 186 of content, so 72px blank below.
            float footerY = contentTop + 186f;
            float footerBottom = footerY + Cards.FooterWithButton;
            Cards.TileFooter(g, card, footerY);
            Theme.Text(g, (info.BelowThreshold ? "below threshold" : "above threshold") +
                (info.HasPeriodEnd ? " \u00b7 cycle ends " + Fmt.AccountTime(info.PeriodEnd) : ""),
                Mx.Small, FontStyle.Regular, Theme.Muted, card.X + Mx.CardPad,
                Theme.CenterY(g, footerY, footerBottom, Mx.Small, FontStyle.Regular));
            float jsonW = Cards.ButtonWidth(g, "JSON", "refresh");
            RectangleF json = new RectangleF(card.Right - Mx.CardPad - jsonW, footerY + 8f, jsonW, Mx.BtnSmH);
            Cards.Button(g, json, "JSON", BtnKind.Ghost, "refresh", hover == "cc-json");
            Hit("url:http://127.0.0.1:3000/api/command-code", json);
        }
        private void DrawCommandAccount(Graphics g, CommandCodeInfo info)
        {
            RectangleF card = ccAccount;
            float contentTop = Cards.Header(g, card, "Account", info.BaseUrl + " \u00b7 /alpha/whoami", true, Mx.TitleLineBase);
            float titleW = Theme.Measure(g, "Account", Mx.CardTitle, FontStyle.Regular);
            string badge = !info.Configured ? "not configured" : (info.Online ? "live" : "unreachable");
            bool bad = info.Configured && !info.Online;
            Cards.Badge(g, card.X + Mx.CardPad + titleW + 8f, card.Y + Mx.CardPad, badge,
                !info.Configured ? BadgeKind.Outline : (bad ? BadgeKind.Destructive : BadgeKind.Secondary),
                bad || !info.Configured ? "circle-alert" : "circle-check",
                bad ? Theme.Destructive : Theme.Emerald);

            float y = contentTop + 16f;
            string[][] rows = new string[][]
            {
                new string[] { "Name", info.AccountName.Length > 0 ? info.AccountName : "\u2014" },
                new string[] { "Username", info.AccountUser.Length > 0 ? info.AccountUser : "\u2014" },
                new string[] { "Email", info.AccountEmail.Length > 0 ? info.AccountEmail : "\u2014" },
                new string[] { "User id", info.AccountId.Length > 0 ? info.AccountId : "\u2014" },
                new string[] { "Credential", info.CredentialHint.Length > 0
                    ? info.CredentialHint + " (" + info.CredentialSource + ")" : "not configured" }
            };
            for (int i = 0; i < rows.Length; i++)
            {
                Theme.Text(g, rows[i][0], Mx.Body, FontStyle.Regular, Theme.Muted, card.X + Mx.CardPad, y);
                float maxW = card.Width - Mx.CardPad * 2f - 130f;
                Theme.TextRight(g, Theme.Fit(g, rows[i][1], Mx.Body, FontStyle.Regular, maxW), Mx.Body,
                    FontStyle.Regular, Theme.Fg, card.Right - Mx.CardPad, y);
                y += 32f;
            }
            if (info.Error.Length > 0)
            {
                RectangleF warn = new RectangleF(card.X + Mx.CardPad, y, card.Width - Mx.CardPad * 2f, 32f);
                Theme.Fill(g, warn, 6f, Theme.RedSoft);
                Theme.Text(g, Theme.Fit(g, info.Error, Mx.Small, FontStyle.Regular, warn.Width - 24f), Mx.Small,
                    FontStyle.Regular, Theme.Destructive, warn.X + 12f,
                    Theme.CenterY(g, warn.Y, warn.Bottom, Mx.Small, FontStyle.Regular));
            }

            float footerY = card.Bottom - Mx.FooterH;
            Cards.TileFooter(g, card, footerY);
            Theme.Text(g, "Checked " + (info.HasFetchedAt ? Fmt.AccountTime(info.FetchedAt) : "\u2014"),
                Mx.Small, FontStyle.Regular, Theme.Muted, card.X + Mx.CardPad,
                Theme.CenterY(g, footerY, card.Bottom, Mx.Small, FontStyle.Regular));
            float iconX = card.Right - Mx.CardPad - 46f;
            string[] footerGlyphs = new string[] { "user", "mail", "wallet" };
            for (int i = 0; i < footerGlyphs.Length; i++)
            {
                Glyph.Draw(g, footerGlyphs[i], new RectangleF(iconX + i * 16f, footerY + 18f, 12f, 12f),
                    Theme.Muted, 1.4f);
            }
        }

        private void DrawSubscription(Graphics g, CommandCodeInfo info)
        {
            RectangleF card = ccSub;
            float contentTop = Cards.Header(g, card, "Subscription", "Billing cycle returned by /alpha/billing/subscriptions.", true, Mx.TitleLineBase);
            float titleW = Theme.Measure(g, "Subscription", Mx.CardTitle, FontStyle.Regular);
            string status = info.SubscriptionStatus.Length > 0 ? info.SubscriptionStatus : "unknown";
            Cards.Badge(g, card.X + Mx.CardPad + titleW + 8f, card.Y + Mx.CardPad, status,
                status == "active" ? BadgeKind.Secondary : BadgeKind.Outline);

            float y = contentTop + 16f;
            string[][] rows = new string[][]
            {
                new string[] { "Plan", info.PlanId.Length > 0 ? info.PlanId : "\u2014" },
                new string[] { "Cycle start", info.HasPeriodStart ? Fmt.AccountTime(info.PeriodStart) : "\u2014" },
                new string[] { "Cycle end", info.HasPeriodEnd ? Fmt.AccountTime(info.PeriodEnd) : "\u2014" },
                new string[] { "Renews", info.CancelAtPeriodEnd ? "cancels at period end" : "auto" },
                new string[] { "Seats", Fmt.Int(info.Seats) }
            };
            for (int i = 0; i < rows.Length; i++)
            {
                Theme.Text(g, rows[i][0], Mx.Body, FontStyle.Regular, Theme.Muted, card.X + Mx.CardPad, y);
                float maxW = card.Width - Mx.CardPad * 2f - 130f;
                Theme.TextRight(g, Theme.Fit(g, rows[i][1], Mx.Body, FontStyle.Regular, maxW), Mx.Body,
                    FontStyle.Regular, Theme.Fg, card.Right - Mx.CardPad, y);
                y += 32f;
            }

            float footerY = card.Bottom - Mx.FooterH;
            Cards.TileFooter(g, card, footerY);
            Glyph.Draw(g, "calendar", new RectangleF(card.X + Mx.CardPad, footerY + 18f, 12f, 12f), Theme.Muted, 1.4f);
            Theme.Text(g, Theme.Fit(g, info.SubscriptionId.Length > 0 ? info.SubscriptionId : "no subscription id",
                    Mx.Small, FontStyle.Regular, card.Width - Mx.CardPad * 2f - 20f),
                Mx.Small, FontStyle.Regular, Theme.Muted, card.X + Mx.CardPad + 16f,
                Theme.CenterY(g, footerY, card.Bottom, Mx.Small, FontStyle.Regular));
        }

        private void DrawEndpointHealth(Graphics g, CommandCodeInfo info)
        {
            RectangleF card = ccHealth;
            float contentTop = Cards.Header(g, card, "Endpoint health", "The four Command Code API endpoints backing this page.", true, Mx.TitleLineBase);
            float titleW = Theme.Measure(g, "Endpoint health", Mx.CardTitle, FontStyle.Regular);
            Cards.Badge(g, card.X + Mx.CardPad + titleW + 8f, card.Y + Mx.CardPad,
                info.FailedEndpoints.Count + " failed", BadgeKind.Outline);

            string[] paths = new string[]
            {
                "/alpha/whoami", "/alpha/usage/summary", "/alpha/billing/credits", "/alpha/billing/subscriptions"
            };
            float y = contentTop + 16f;
            float inner = card.Width - Mx.CardPad * 2f;
            float cell = (inner - 3f) / 4f;
            for (int i = 0; i < paths.Length; i++)
            {
                RectangleF box = new RectangleF(card.X + Mx.CardPad + i * (cell + 1f), y, cell, 62f);
                Theme.Stroke(g, box, 8f, Theme.Border, 1f);
                bool failed = info.FailedEndpoints.Contains(paths[i]);
                Glyph.Draw(g, failed ? "circle-alert" : "circle-check",
                    new RectangleF(box.X + 12f, box.Y + 12f, 14f, 14f),
                    failed ? Theme.Destructive : Theme.Emerald, 1.5f);
                Theme.Text(g, Theme.Fit(g, paths[i], Mx.Small, FontStyle.Regular, box.Width - 44f), Mx.Small,
                    FontStyle.Regular, Theme.Fg, box.X + 32f, box.Y + 11f);
                Theme.Text(g, failed ? "failed" : "ok", Mx.Small, FontStyle.Regular, Theme.Muted,
                    box.X + 12f, box.Y + 34f);
            }
        }

        /// <summary>Progress tones: green under 60%, amber from 60%, red from 85%.</summary>
        private Color ToneColor(double usedPct)
        {
            if (usedPct >= 85) return Theme.Red;
            if (usedPct >= 60) return Theme.Amber;
            return Theme.Emerald;
        }

        /// <summary>resets in 2h 15m - Sep 12, 04:00, relative for near windows.</summary>
        private string ResetLabel(CommandWindow window)
        {
            if (!window.HasResetAt)
            {
                return "no reset scheduled";
            }
            TimeSpan left = window.ResetAt - DateTime.Now;
            if (left.TotalSeconds <= 0)
            {
                return "rolling over now";
            }
            string relative;
            int minutes = (int)Math.Round(left.TotalMinutes);
            if (minutes < 60)
            {
                relative = minutes + "m";
            }
            else if (minutes < 60 * 48)
            {
                relative = (minutes / 60) + "h " + (minutes % 60) + "m";
            }
            else
            {
                relative = Math.Round(minutes / 1440.0).ToString("0", Inv) + "d";
            }
            return "resets in " + relative + " \u00b7 " + window.ResetAt.ToString("MMM d, HH:mm", Inv);
        }
    }
}