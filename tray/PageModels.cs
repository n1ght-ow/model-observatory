using System;
using System.Collections.Generic;
using System.Drawing;
using System.Globalization;

namespace RouterMonitorTray
{
    /// <summary>The Models page: the switch-model card and the usage table that
    /// compares every API/model route.</summary>
    internal sealed partial class PanelView
    {
        private RectangleF mdSwitch;
        private RectangleF mdUsage;

        private void LayoutModels()
        {
            float y = Mx.PagePad + Mx.PageHeaderH + Mx.CardGap;

            // Measured: a 156px filter card, then 78 + thead 40 + 35 x 48 + 16.
            float switchH = 156f;
            mdSwitch = new RectangleF(PageX, y, PageW, switchH);
            y += switchH + Mx.CardGap;

            int rows = Snap == null ? 0 : Snap.Models.Count;
            float usageH = 78f + Mx.HeadH + Math.Max(1, rows) * Mx.RowSingleH + Mx.CardPad;
            mdUsage = new RectangleF(PageX, y, PageW, usageH);
            y += usageH;

            contentHeight = y + Mx.PagePad;
        }

        private void DrawModelsPage(Graphics g)
        {
            PageHeader(g, "Models",
                "Usage per API and model. The same model can run on several APIs (e.g. deepseek vs opencode-go).",
                true, false);

            // Switch model card.
            RectangleF card = mdSwitch;
            Cards.Tile(g, card);
            float rowY = Cards.TileHeader(g, card, "Switch model",
                "Pick an API first, then a model it serves \u2014 filters sync to the URL.") + 8f;
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

            // Model usage card.
            card = mdUsage;
            Cards.Tile(g, card);
            List<ModelRow> models = SortedModels();
            string description = "Sorted by token usage. " + Fmt.Int(Snap.TotalsAll.Requests) + " requests \u00b7 " +
                Theme.Compact(Snap.TotalsAll.Tokens) + " tokens \u00b7 " +
                Snap.TotalsAll.SuccessRate.ToString("0.0", Inv) + "% success \u00b7 " +
                Fmt.Int(Snap.TotalsAll.Failed) + " failed";
            float contentTop = Cards.TileHeader(g, card, "Model usage", description);

            string routes = models.Count + " routes";
            float routesWidth = Cards.BadgeWidth(g, routes, null);
            Cards.Badge(g, card.Right - Mx.CardPad - routesWidth, card.Y + Mx.CardPad, routes, BadgeKind.Secondary);

            RectangleF table = new RectangleF(card.X, contentTop, card.Width, card.Height - (contentTop - card.Y) - Mx.CardPad);
            if (models.Count == 0)
            {
                Cards.Empty(g, table, "cpu", "No matching models",
                    "No calls were recorded for this API/model combination. Reset the filters or pick another route.");
                return;
            }
            Widgets.ModelUsageTable(g, table, models, true, Hit, hover, "row:md:");
        }

        private List<ModelRow> SortedModels()
        {
            List<ModelRow> models = Snap == null ? new List<ModelRow>() : new List<ModelRow>(Snap.Models);
            models.Sort(delegate (ModelRow a, ModelRow b)
            {
                int byTokens = b.Tokens.CompareTo(a.Tokens);
                if (byTokens != 0) return byTokens;
                int byRequests = b.Requests.CompareTo(a.Requests);
                if (byRequests != 0) return byRequests;
                return string.CompareOrdinal(a.Model, b.Model);
            });
            return models;
        }
    }
}
