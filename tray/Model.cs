using System;
using System.Collections.Generic;
using System.Globalization;

namespace RouterMonitorTray
{
    internal sealed class Capabilities
    {
        public bool Latency;
        public bool FirstToken;
        public bool Cost;
        public bool StatusCode;
        public bool Balance;
        public bool Provider;
    }

    internal sealed class DailyRow
    {
        public string Date = "";
        public double Requests;
        public double Success;
        public double Failed;
        public double Tokens;
        public double AvgMs;
        public double Cost;
    }

    internal sealed class ModelRow
    {
        public string Model = "";
        public string Provider = "";
        public double Requests;
        public double Tokens;
        public double ErrorRate;
        public double AvgMs;
        public double Cost;
    }

    internal sealed class ProviderRow
    {
        public string Provider = "";
        public double Requests;
        public double Tokens;
        public double ErrorRate;
        public double Cost;
    }

    internal sealed class RecentRow
    {
        public DateTime At;
        public bool HasTime;
        public string Model = "";
        public string Provider = "";
        public int Status;
        public bool HasStatus;
        public double DurationMs;
        public double FirstTokenMs;
        public double InputTokens;
        public double OutputTokens;
        public double Tokens;
        public double Cost;
        public bool HasCost;
    }

    internal sealed class BalanceRow
    {
        public string Currency = "";
        public double Total;
        public double Granted;
        public double ToppedUp;
    }

    internal sealed class AccountInfo
    {
        public bool Configured;
        public bool Online;
        public bool Available;
        public string Error = "";
        public string KeySource = "";
        public double LatencyMs;
        public DateTime CheckedAt;
        public bool HasCheckedAt;
        public List<BalanceRow> Balances = new List<BalanceRow>();
    }

    internal sealed class HourPoint
    {
        public int Hour;
        public double Requests;
        public double Tokens;
    }

    internal sealed class ActivityDay
    {
        public string Date = "";
        public double Requests;
        public int Level;
    }

    internal sealed class Insights
    {
        public List<HourPoint> Hourly = new List<HourPoint>();
        public List<ActivityDay> Activity = new List<ActivityDay>();
        public int PeakHour;
        public bool HasPeakHour;
        public double PeakHourRequests;
        public double CurrentStreak;
        public double LongestStreak;
        public double ActiveDays;
        public string BusiestDay = "";
        public double BusiestDayRequests;
    }

    /// <summary>One of the two metric shapes: window (delta'd) and all-time totals.</summary>
    internal sealed class Totals
    {
        public double Requests;
        public double Success;
        public double Failed;
        public double SuccessRate;
        public double Tokens;
        public double InputTokens;
        public double OutputTokens;
        public double CacheTokens;
        public double Cost;
        public bool HasCost;
        /// <summary>DeepSeek's own CNY estimate, shown on the DeepSeek page.</summary>
        public double CostCny;
        public bool HasCostCny;
        public double AvgMs;
        public double AvgFirstTokenMs;
        public int Models;
        public int Providers;
        public int Days;
        public bool AllTime;

        public double DeltaRequests;
        public double DeltaTokens;
        public double DeltaLatency;
        public double DeltaSuccessRatePp;
    }

    /// <summary>One paced Command Code spending window.</summary>
    internal sealed class CommandWindow
    {
        public string Id = "";
        public string Label = "";
        public double Used;
        public double Cap;
        public double Remaining;
        public double UsedPct;
        public bool Exceeded;
        public DateTime ResetAt;
        public bool HasResetAt;
    }

    /// <summary>
    /// The DeepSeek page's scope banner: which upstream served each native
    /// api.deepseek.com request, split into the segments the web draws.
    /// </summary>
    internal sealed class UpstreamInfo
    {
        public string Label = "";
        public double Included;
        public double Excluded;
        public string Detail = "";
        public double NativeDirect;
        public double NativeViaRouter;
        public double Harness;
        public double CommandCode;
        public double OtherUpstream;
        public double Unclassified;

        public double Total
        {
            get { return Included + Excluded; }
        }
    }

    internal sealed class CommandUsage
    {
        public double TotalCount;
        public double TotalCost;
        public double AverageCost;
        public double SuccessRate;
        public double CompletedCount;
        public double FailedCount;
        public double TokensIn;
        public double TokensOut;
        public double Tokens;
        public double TotalCredits;
        public double FreeCredits;
        public double MonthlyCredits;
        public double PurchasedCredits;
    }

    /// <summary>
    /// The Command Code account report, attached to every snapshot because the
    /// account is independent of the active router profile.
    /// </summary>
    internal sealed class CommandCodeInfo
    {
        public string BaseUrl = "";
        public bool Configured;
        public bool Online;
        public bool Limited;
        public string Error = "";
        public double LatencyMs;
        public DateTime FetchedAt;
        public bool HasFetchedAt;
        public string CredentialHint = "";
        public string CredentialSource = "";
        public string AccountName = "";
        public string AccountUser = "";
        public string AccountEmail = "";
        public string AccountId = "";
        public string PlanId = "";
        public string SubscriptionStatus = "";
        public string SubscriptionId = "";
        public DateTime PeriodStart;
        public bool HasPeriodStart;
        public DateTime PeriodEnd;
        public bool HasPeriodEnd;
        public bool CancelAtPeriodEnd;
        public double Seats;
        public double Threshold;
        public bool BelowThreshold;
        public CommandUsage Usage;
        public List<CommandWindow> Windows = new List<CommandWindow>();
        public List<string> FailedEndpoints = new List<string>();
    }

    /// <summary>
    /// Everything the tray panel needs, flattened out of /api/metrics and
    /// /api/sources so the drawing code never touches JSON.
    /// </summary>
    internal sealed class Snapshot
    {
        public string Source = "deepseek";
        public string SourceLabel = "DeepSeek API";
        public string Status = "unavailable";
        public string StatusDetail = "";
        public string ProfileLabel = "";
        public Capabilities Caps = new Capabilities();

        public Totals Window = new Totals();
        public Totals TotalsAll = new Totals();

        public List<DailyRow> Daily = new List<DailyRow>();
        public List<ModelRow> WindowModels = new List<ModelRow>();
        public List<ModelRow> Models = new List<ModelRow>();
        public List<ModelRow> AllModels = new List<ModelRow>();
        public List<ProviderRow> WindowProviders = new List<ProviderRow>();
        public List<RecentRow> Recent = new List<RecentRow>();
        public Insights Insights = new Insights();
        public AccountInfo Account;
        public CommandCodeInfo CommandCode;
        public UpstreamInfo Upstream;

        public DateTime FetchedAt = DateTime.MinValue;
        public DateTime GeneratedAt = DateTime.MinValue;
        public int Limit;

        /// <summary>"all" | "30" | "7" | "1" — the range switcher selection.</summary>
        public string Range = "7";
        public string Provider = "";
        public string Model = "";

        public bool HasCost
        {
            get { return Window.HasCost || TotalsAll.HasCost; }
        }
    }

    internal static class Fmt
    {
        private static readonly CultureInfo Inv = CultureInfo.InvariantCulture;

        public static string Count(double value)
        {
            return Theme.Compact(value);
        }

        public static string Int(double value)
        {
            return value.ToString("#,0", Inv);
        }

        public static string Percent(double value)
        {
            return value.ToString("0.0", Inv) + "%";
        }

        public static string Money(string currency, double value)
        {
            string symbol = string.Equals(currency, "CNY", StringComparison.OrdinalIgnoreCase) ? "\u00a5" : "$";
            return symbol + value.ToString("0.00", Inv);
        }

        public static string Duration(double ms)
        {
            if (ms <= 0) return "\u2014";
            return Math.Round(ms).ToString("#,0", Inv) + " ms";
        }

        public static string Delta(double value, string suffix)
        {
            if (Math.Abs(value) < 0.05) return "0.0" + suffix;
            return Math.Abs(value).ToString("0.0", Inv) + suffix;
        }

        public static string Clock(DateTime local)
        {
            return local.ToString("HH:mm:ss", Inv);
        }

        public static string ShortTime(DateTime local)
        {
            return local.ToString("HH:mm", Inv);
        }

        /// <summary>Intl.DateTimeFormat en-US {month,day,hour,minute} → "Sep 11, 01:08 AM".</summary>
        public static string TableTime(DateTime local)
        {
            return local.ToString("MMM d, hh:mm tt", Inv);
        }

        /// <summary>Intl.DateTimeFormat zh-CN for the DeepSeek account card → "9月11日 01:57:21".</summary>
        public static string AccountTime(DateTime local)
        {
            return local.ToString("M\u6708d\u65e5 HH:mm:ss", Inv);
        }

        /// <summary>recharts tooltip label → "Mon, Sep 8".</summary>
        public static string TooltipDate(string iso)
        {
            DateTime parsed;
            if (string.IsNullOrEmpty(iso) || !DateTime.TryParseExact(iso, "yyyy-MM-dd", Inv,
                    DateTimeStyles.None, out parsed))
            {
                return iso;
            }
            return parsed.ToString("ddd, MMM d", Inv);
        }

        public static string ShortDate(string iso)
        {
            if (string.IsNullOrEmpty(iso) || iso.Length < 10) return iso;
            return iso.Substring(5, 5);
        }

        /// <summary>Day + month, used by Usage insights ("7 Sep").</summary>
        public static string DayMonth(string iso)
        {
            DateTime parsed;
            if (string.IsNullOrEmpty(iso) || !DateTime.TryParseExact(iso, "yyyy-MM-dd", Inv,
                    DateTimeStyles.None, out parsed))
            {
                return "\u2014";
            }
            return parsed.ToString("d MMM", Inv);
        }

        public static string Hour12(int hour)
        {
            string suffix = hour < 12 ? "AM" : "PM";
            int display = hour % 12;
            if (display == 0) display = 12;
            return display + " " + suffix;
        }

        public static string Model(string model)
        {
            if (string.IsNullOrEmpty(model)) return "\u672a\u77e5\u6a21\u578b";
            int slash = model.LastIndexOf('/');
            if (slash >= 0 && slash + 1 < model.Length) return model.Substring(slash + 1);
            return model;
        }
    }
}
