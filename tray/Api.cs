using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Net;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

namespace RouterMonitorTray
{
    internal sealed class ApiException : Exception
    {
        public ApiException(string message) : base(message) { }
    }

    /// <summary>One metric read: which source, which window and which filters.</summary>
    internal sealed class LoadRequest
    {
        /// <summary>"auto" follows the active CC Switch profile.</summary>
        public string Source = "auto";
        /// <summary>0 means "all time", which the API spells as days=all.</summary>
        public int Days = 7;
        public int Limit = 12;
        public string Provider = "";
        public string Model = "";

        public string Query()
        {
            StringBuilder query = new StringBuilder();
            query.Append("?source=").Append(Uri.EscapeDataString(Source));
            query.Append("&days=").Append(Days <= 0 ? "all" : Days.ToString(CultureInfo.InvariantCulture));
            query.Append("&limit=").Append(Limit.ToString(CultureInfo.InvariantCulture));
            if (!string.IsNullOrEmpty(Provider))
            {
                query.Append("&provider=").Append(Uri.EscapeDataString(Provider));
            }
            if (!string.IsNullOrEmpty(Model))
            {
                query.Append("&model=").Append(Uri.EscapeDataString(Model));
            }
            return query.ToString();
        }
    }

    /// <summary>
    /// Thin client over the dashboard's local JSON API. The tray app talks to
    /// the already-running Next.js process instead of opening a browser window.
    /// </summary>
    internal static class Api
    {
        public static string BaseUrl = "http://127.0.0.1:3000";
        public static string ProjectRoot = @"D:\dashboard";
        private static readonly JavaScriptSerializer Serializer = new JavaScriptSerializer();

        public static string Get(string path, int timeoutMs)
        {
            HttpWebRequest request = (HttpWebRequest)WebRequest.Create(BaseUrl + path);
            // The machine runs a system-wide proxy; local traffic must go direct.
            request.Proxy = null;
            request.Timeout = timeoutMs;
            request.ReadWriteTimeout = timeoutMs;
            request.KeepAlive = false;
            request.UserAgent = "RouterMonitorTray/1.0";
            using (HttpWebResponse response = (HttpWebResponse)request.GetResponse())
            using (Stream stream = response.GetResponseStream())
            using (StreamReader reader = new StreamReader(stream, Encoding.UTF8))
            {
                return reader.ReadToEnd();
            }
        }

        public static bool ServerUp(int timeoutMs)
        {
            try
            {
                Get("/api/sources", timeoutMs);
                return true;
            }
            catch
            {
                return false;
            }
        }

        /// <summary>Starts the hidden dashboard host if it is not answering yet.</summary>
        public static bool EnsureServer(int waitMs, out string detail)
        {
            detail = "";
            if (ServerUp(1500))
            {
                return true;
            }

            // The host has no logon task of its own: it starts on demand, either
            // here or from open-dashboard.ps1.
            string starter = Path.Combine(ProjectRoot, @"scripts\start-dashboard.ps1");
            if (!ServerUp(1200) && File.Exists(starter))
            {
                if (!WaitForServer(6000))
                {
                    try
                    {
                        ProcessStartInfo psi = new ProcessStartInfo(
                            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), @"WindowsPowerShell\v1.0\powershell.exe"));
                        psi.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"" + starter + "\" -Port 3000";
                        psi.CreateNoWindow = true;
                        psi.UseShellExecute = false;
                        psi.WindowStyle = ProcessWindowStyle.Hidden;
                        psi.WorkingDirectory = ProjectRoot;
                        Process.Start(psi);
                    }
                    catch (Exception ex)
                    {
                        detail = ex.Message;
                    }
                }
            }

            bool ok = WaitForServer(waitMs);
            if (!ok && detail.Length == 0)
            {
                detail = "\u672c\u5730\u670d\u52a1\u672a\u5728 " + (waitMs / 1000) + " \u79d2\u5185\u5c31\u7eea";
            }
            return ok;
        }

        private static bool WaitForServer(int waitMs)
        {
            int waited = 0;
            while (waited < waitMs)
            {
                Thread.Sleep(500);
                waited += 500;
                if (ServerUp(1200))
                {
                    return true;
                }
            }
            return ServerUp(1500);
        }

        public static Snapshot Load(LoadRequest request)
        {
            if (request == null)
            {
                request = new LoadRequest();
            }
            Snapshot snapshot = new Snapshot();
            snapshot.Range = request.Days <= 0 ? "all" : request.Days.ToString(CultureInfo.InvariantCulture);
            snapshot.Provider = request.Provider ?? "";
            snapshot.Model = request.Model ?? "";
            snapshot.Limit = request.Limit;

            string sourcesRaw;
            try
            {
                sourcesRaw = Get("/api/sources", 10000);
            }
            catch (Exception ex)
            {
                throw new ApiException("\u65e0\u6cd5\u8fde\u63a5\u672c\u5730\u670d\u52a1\uff1a" + ex.Message);
            }

            Dictionary<string, object> sources = AsObject(Parse(sourcesRaw));
            string active = AsString(sources, "active");
            if (active.Length == 0)
            {
                active = "deepseek";
            }

            Dictionary<string, object> profile = AsObject(Get(sources, "profile"));
            if (profile != null)
            {
                snapshot.ProfileLabel = AsString(profile, "name");
            }

            string source = string.IsNullOrEmpty(request.Source) || request.Source == "auto"
                ? active
                : request.Source;

            object[] sourceList = AsArray(Get(sources, "sources"));
            for (int i = 0; i < sourceList.Length; i++)
            {
                Dictionary<string, object> entry = AsObject(sourceList[i]);
                if (entry == null || AsString(entry, "id") != source)
                {
                    continue;
                }
                snapshot.SourceLabel = AsString(entry, "label");
                Dictionary<string, object> caps = AsObject(Get(entry, "capabilities"));
                if (caps != null)
                {
                    snapshot.Caps.Latency = AsBool(caps, "latency");
                    snapshot.Caps.FirstToken = AsBool(caps, "firstToken");
                    snapshot.Caps.Cost = AsBool(caps, "cost");
                    snapshot.Caps.StatusCode = AsBool(caps, "statusCode");
                    snapshot.Caps.Balance = AsBool(caps, "balance");
                    snapshot.Caps.Provider = AsBool(caps, "provider");
                }
            }
            snapshot.Source = source;

            string metricsRaw;
            try
            {
                metricsRaw = Get("/api/metrics" + request.Query(), 30000);
            }
            catch (Exception ex)
            {
                throw new ApiException("\u8bfb\u53d6\u6307\u6807\u5931\u8d25\uff1a" + ex.Message);
            }

            Dictionary<string, object> data = AsObject(Parse(metricsRaw));
            string label = AsString(data, "sourceLabel");
            if (label.Length > 0)
            {
                snapshot.SourceLabel = label;
            }
            snapshot.Status = AsString(data, "status");
            snapshot.StatusDetail = AsString(data, "statusDetail");
            snapshot.GeneratedAt = ParseDate(AsString(data, "generatedAt"));

            ReadTotals(AsObject(Get(data, "window")), snapshot.Window, true);
            ReadTotals(AsObject(Get(data, "totals")), snapshot.TotalsAll, false);
            if (snapshot.Window.Days <= 0)
            {
                snapshot.Window.Days = request.Days <= 0 ? 0 : request.Days;
                snapshot.Window.AllTime = request.Days <= 0;
            }

            object[] daily = AsArray(Get(data, "daily"));
            for (int i = 0; i < daily.Length; i++)
            {
                Dictionary<string, object> row = AsObject(daily[i]);
                if (row == null)
                {
                    continue;
                }
                DailyRow point = new DailyRow();
                point.Date = AsString(row, "date");
                point.Requests = AsNumber(row, "requests");
                point.Success = AsNumber(row, "success");
                point.Failed = AsNumber(row, "failed");
                point.Tokens = AsNumber(row, "tokens");
                point.AvgMs = AsNumber(row, "avgDurationMs");
                point.Cost = AsNumber(row, "costUsd");
                snapshot.Daily.Add(point);
            }

            ReadModels(AsArray(Get(data, "windowModels")), snapshot.WindowModels);
            ReadModels(AsArray(Get(data, "models")), snapshot.Models);
            ReadModels(AsArray(Get(data, "allModels")), snapshot.AllModels);
            ReadProviders(AsArray(Get(data, "windowProviders")), snapshot.WindowProviders);

            ReadInsights(AsObject(Get(data, "insights")), snapshot.Insights);

            object[] recent = AsArray(Get(data, "recent"));
            for (int i = 0; i < recent.Length; i++)
            {
                Dictionary<string, object> row = AsObject(recent[i]);
                if (row == null)
                {
                    continue;
                }
                RecentRow item = new RecentRow();
                DateTime parsed = ParseDate(AsString(row, "at"));
                if (parsed != DateTime.MinValue)
                {
                    item.At = parsed.ToLocalTime();
                    item.HasTime = true;
                }
                item.Model = AsString(row, "model");
                item.Provider = AsString(row, "provider");
                if (HasKey(row, "status"))
                {
                    item.Status = (int)AsNumber(row, "status");
                    item.HasStatus = true;
                }
                item.DurationMs = AsNumber(row, "durationMs");
                item.FirstTokenMs = AsNumber(row, "firstTokenMs");
                item.InputTokens = AsNumber(row, "inputTokens");
                item.OutputTokens = AsNumber(row, "outputTokens");
                item.Tokens = AsNumber(row, "totalTokens");
                if (HasKey(row, "costUsd"))
                {
                    item.Cost = AsNumber(row, "costUsd");
                    item.HasCost = true;
                }
                snapshot.Recent.Add(item);
            }

            Dictionary<string, object> account = AsObject(Get(data, "account"));
            if (account != null)
            {
                AccountInfo info = new AccountInfo();
                info.Configured = AsBool(account, "configured");
                info.Online = AsBool(account, "online");
                info.Available = AsBool(account, "isAvailable");
                info.Error = AsString(account, "error");
                info.KeySource = AsString(account, "keySource");
                info.LatencyMs = AsNumber(account, "latencyMs");
                DateTime checkedAt = ParseDate(AsString(account, "checkedAt"));
                if (checkedAt != DateTime.MinValue)
                {
                    info.CheckedAt = checkedAt.ToLocalTime();
                    info.HasCheckedAt = true;
                }
                object[] balances = AsArray(Get(account, "balances"));
                for (int i = 0; i < balances.Length; i++)
                {
                    Dictionary<string, object> entry = AsObject(balances[i]);
                    if (entry == null)
                    {
                        continue;
                    }
                    BalanceRow balance = new BalanceRow();
                    balance.Currency = AsString(entry, "currency");
                    balance.Total = AsNumber(entry, "totalBalance");
                    balance.Granted = AsNumber(entry, "grantedBalance");
                    balance.ToppedUp = AsNumber(entry, "toppedUpBalance");
                    info.Balances.Add(balance);
                }
                snapshot.Account = info;
            }

            ReadCommandCode(AsObject(Get(data, "commandCode")), snapshot);
            ReadUpstream(AsObject(Get(data, "upstream")), snapshot);

            if (snapshot.Status.Length == 0)
            {
                Dictionary<string, object> health = AsObject(Get(data, "health"));
                if (health != null)
                {
                    snapshot.Status = AsBool(health, "ok") ? "live" : "unavailable";
                    snapshot.StatusDetail = AsString(health, "detail");
                }
            }
            if (snapshot.Status.Length == 0)
            {
                snapshot.Status = "unavailable";
            }

            snapshot.FetchedAt = DateTime.Now;
            return snapshot;
        }

        private static void ReadTotals(Dictionary<string, object> map, Totals totals, bool window)
        {
            if (map == null)
            {
                return;
            }
            totals.Requests = AsNumber(map, "requests");
            totals.Success = AsNumber(map, "success");
            totals.Failed = AsNumber(map, "failed");
            totals.SuccessRate = AsNumber(map, "successRate");
            totals.Tokens = AsNumber(map, "totalTokens");
            totals.InputTokens = AsNumber(map, "inputTokens");
            totals.OutputTokens = AsNumber(map, "outputTokens");
            totals.CacheTokens = AsNumber(map, "cacheReadTokens");
            totals.AvgMs = AsNumber(map, "avgDurationMs");
            totals.AvgFirstTokenMs = AsNumber(map, "avgFirstTokenMs");
            totals.Models = (int)AsNumber(map, "models");
            totals.Providers = (int)AsNumber(map, "providers");
            if (HasKey(map, "totalCostUsd"))
            {
                totals.Cost = AsNumber(map, "totalCostUsd");
                totals.HasCost = true;
            }
            if (HasKey(map, "totalCostCny"))
            {
                totals.CostCny = AsNumber(map, "totalCostCny");
                totals.HasCostCny = true;
            }
            if (window)
            {
                totals.Days = (int)AsNumber(map, "days");
                totals.AllTime = AsBool(map, "allTime");
                totals.DeltaRequests = AsNumber(map, "deltaRequestsPct");
                totals.DeltaTokens = AsNumber(map, "deltaTokensPct");
                totals.DeltaLatency = AsNumber(map, "deltaLatencyPct");
                totals.DeltaSuccessRatePp = AsNumber(map, "deltaSuccessRatePp");
            }
        }

        private static void ReadModels(object[] rows, List<ModelRow> target)
        {
            for (int i = 0; i < rows.Length; i++)
            {
                Dictionary<string, object> row = AsObject(rows[i]);
                if (row == null)
                {
                    continue;
                }
                ModelRow model = new ModelRow();
                model.Model = AsString(row, "model");
                model.Provider = AsString(row, "provider");
                model.Requests = AsNumber(row, "requests");
                model.Tokens = AsNumber(row, "tokens");
                model.ErrorRate = AsNumber(row, "errorRate");
                model.AvgMs = AsNumber(row, "avgDurationMs");
                model.Cost = AsNumber(row, "costUsd");
                target.Add(model);
            }
        }

        private static void ReadProviders(object[] rows, List<ProviderRow> target)
        {
            for (int i = 0; i < rows.Length; i++)
            {
                Dictionary<string, object> row = AsObject(rows[i]);
                if (row == null)
                {
                    continue;
                }
                ProviderRow provider = new ProviderRow();
                provider.Provider = AsString(row, "provider");
                provider.Requests = AsNumber(row, "requests");
                provider.Tokens = AsNumber(row, "tokens");
                provider.ErrorRate = AsNumber(row, "errorRate");
                provider.Cost = AsNumber(row, "costUsd");
                target.Add(provider);
            }
        }

        /// <summary>The DeepSeek page's request-scope breakdown.</summary>
        private static void ReadUpstream(Dictionary<string, object> map, Snapshot snapshot)
        {
            if (map == null)
            {
                return;
            }
            UpstreamInfo info = new UpstreamInfo();
            info.Label = AsString(map, "label");
            info.Included = AsNumber(map, "included");
            info.Excluded = AsNumber(map, "excluded");
            info.Detail = AsString(map, "detail");
            Dictionary<string, object> breakdown = AsObject(Get(map, "breakdown"));
            if (breakdown != null)
            {
                info.NativeDirect = AsNumber(breakdown, "nativeDirect");
                info.NativeViaRouter = AsNumber(breakdown, "nativeViaRouter");
                info.Harness = AsNumber(breakdown, "harness");
                info.CommandCode = AsNumber(breakdown, "commandCode");
                info.OtherUpstream = AsNumber(breakdown, "otherUpstream");
                info.Unclassified = AsNumber(breakdown, "unclassified");
            }
            snapshot.Upstream = info;
        }

        /// <summary>
        /// The commandcode.ai report rides along on every metrics response; it is
        /// independent of the active router profile, so it is read once here.
        /// </summary>
        private static void ReadCommandCode(Dictionary<string, object> map, Snapshot snapshot)
        {
            if (map == null)
            {
                return;
            }
            CommandCodeInfo info = new CommandCodeInfo();
            info.BaseUrl = AsString(map, "baseUrl");
            info.Configured = AsBool(map, "configured");
            info.Online = AsBool(map, "online");
            info.Error = AsString(map, "error");
            info.LatencyMs = AsNumber(map, "latencyMs");
            DateTime fetched = ParseDate(AsString(map, "fetchedAt"));
            if (fetched != DateTime.MinValue)
            {
                info.FetchedAt = fetched.ToLocalTime();
                info.HasFetchedAt = true;
            }

            Dictionary<string, object> credential = AsObject(Get(map, "credential"));
            if (credential != null)
            {
                info.CredentialHint = AsString(credential, "hint");
                info.CredentialSource = AsString(credential, "source");
            }

            Dictionary<string, object> account = AsObject(Get(map, "account"));
            if (account != null)
            {
                info.AccountName = AsString(account, "name");
                info.AccountUser = AsString(account, "userName");
                info.AccountEmail = AsString(account, "email");
                info.AccountId = AsString(account, "id");
            }

            Dictionary<string, object> usage = AsObject(Get(map, "usage"));
            if (usage != null)
            {
                CommandUsage summary = new CommandUsage();
                summary.TotalCount = AsNumber(usage, "totalCount");
                summary.TotalCost = AsNumber(usage, "totalCost");
                summary.AverageCost = AsNumber(usage, "averageCost");
                summary.SuccessRate = AsNumber(usage, "successRate");
                summary.CompletedCount = AsNumber(usage, "completedCount");
                summary.FailedCount = AsNumber(usage, "failedCount");
                summary.TokensIn = AsNumber(usage, "totalTokensIn");
                summary.TokensOut = AsNumber(usage, "totalTokensOut");
                summary.Tokens = AsNumber(usage, "totalTokens");
                summary.TotalCredits = AsNumber(usage, "totalCredits");
                summary.FreeCredits = AsNumber(usage, "totalFreeCredits");
                summary.MonthlyCredits = AsNumber(usage, "totalMonthlyCredits");
                summary.PurchasedCredits = AsNumber(usage, "totalPurchasedCredits");
                info.Usage = summary;
            }

            Dictionary<string, object> credits = AsObject(Get(map, "credits"));
            if (credits != null)
            {
                info.BelowThreshold = AsBool(credits, "belowThreshold");
                info.Threshold = AsNumber(credits, "creditThreshold");
                if (info.Usage == null)
                {
                    info.Usage = new CommandUsage();
                }
                info.Usage.MonthlyCredits = AsNumber(credits, "monthlyCredits");
                info.Usage.PurchasedCredits = AsNumber(credits, "purchasedCredits");
                info.Usage.FreeCredits = AsNumber(credits, "freeCredits");
            }

            Dictionary<string, object> limits = AsObject(Get(map, "limits"));
            if (limits != null)
            {
                info.Limited = AsBool(limits, "limited");
            }

            object[] windows = AsArray(Get(map, "windows"));
            for (int i = 0; i < windows.Length; i++)
            {
                Dictionary<string, object> row = AsObject(windows[i]);
                if (row == null)
                {
                    continue;
                }
                CommandWindow window = new CommandWindow();
                window.Id = AsString(row, "id");
                window.Label = AsString(row, "label");
                window.Used = AsNumber(row, "used");
                window.Cap = AsNumber(row, "cap");
                window.Remaining = AsNumber(row, "remaining");
                window.UsedPct = AsNumber(row, "usedPct");
                window.Exceeded = AsBool(row, "exceeded");
                DateTime reset = ParseDate(AsString(row, "resetAt"));
                if (reset != DateTime.MinValue)
                {
                    window.ResetAt = reset.ToLocalTime();
                    window.HasResetAt = true;
                }
                info.Windows.Add(window);
            }

            Dictionary<string, object> subscription = AsObject(Get(map, "subscription"));
            if (subscription != null)
            {
                info.PlanId = AsString(subscription, "planId");
                info.SubscriptionStatus = AsString(subscription, "status");
                info.SubscriptionId = AsString(subscription, "id");
                info.CancelAtPeriodEnd = AsBool(subscription, "cancelAtPeriodEnd");
                info.Seats = AsNumber(subscription, "quantity");
                DateTime start = ParseDate(AsString(subscription, "currentPeriodStart"));
                if (start != DateTime.MinValue)
                {
                    info.PeriodStart = start.ToLocalTime();
                    info.HasPeriodStart = true;
                }
                DateTime end = ParseDate(AsString(subscription, "currentPeriodEnd"));
                if (end != DateTime.MinValue)
                {
                    info.PeriodEnd = end.ToLocalTime();
                    info.HasPeriodEnd = true;
                }
            }

            object[] failures = AsArray(Get(map, "failures"));
            for (int i = 0; i < failures.Length; i++)
            {
                Dictionary<string, object> row = AsObject(failures[i]);
                if (row != null)
                {
                    info.FailedEndpoints.Add(AsString(row, "endpoint"));
                }
            }

            snapshot.CommandCode = info;
        }

        private static void ReadInsights(Dictionary<string, object> map, Insights insights)
        {
            if (map == null)
            {
                return;
            }
            object[] hourly = AsArray(Get(map, "hourly"));
            for (int i = 0; i < hourly.Length; i++)
            {
                Dictionary<string, object> row = AsObject(hourly[i]);
                if (row == null)
                {
                    continue;
                }
                HourPoint point = new HourPoint();
                point.Hour = (int)AsNumber(row, "hour");
                point.Requests = AsNumber(row, "requests");
                point.Tokens = AsNumber(row, "tokens");
                insights.Hourly.Add(point);
            }
            object[] activity = AsArray(Get(map, "activity"));
            for (int i = 0; i < activity.Length; i++)
            {
                Dictionary<string, object> row = AsObject(activity[i]);
                if (row == null)
                {
                    continue;
                }
                ActivityDay day = new ActivityDay();
                day.Date = AsString(row, "date");
                day.Requests = AsNumber(row, "requests");
                day.Level = (int)AsNumber(row, "level");
                insights.Activity.Add(day);
            }
            if (HasKey(map, "peakHour"))
            {
                insights.PeakHour = (int)AsNumber(map, "peakHour");
                insights.HasPeakHour = true;
            }
            insights.PeakHourRequests = AsNumber(map, "peakHourRequests");
            insights.CurrentStreak = AsNumber(map, "currentStreak");
            insights.LongestStreak = AsNumber(map, "longestStreak");
            insights.ActiveDays = AsNumber(map, "activeDays");
            insights.BusiestDay = AsString(map, "busiestDay");
            insights.BusiestDayRequests = AsNumber(map, "busiestDayRequests");
        }

        private static DateTime ParseDate(string value)
        {
            DateTime parsed;
            if (!string.IsNullOrEmpty(value) && DateTime.TryParse(value, CultureInfo.InvariantCulture,
                    DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal, out parsed))
            {
                return parsed;
            }
            return DateTime.MinValue;
        }

        private static object Parse(string json)
        {
            try
            {
                return Serializer.DeserializeObject(json);
            }
            catch (Exception ex)
            {
                throw new ApiException("\u8fd4\u56de\u5185\u5bb9\u4e0d\u662f\u5408\u6cd5 JSON\uff1a" + ex.Message);
            }
        }

        private static Dictionary<string, object> AsObject(object value)
        {
            return value as Dictionary<string, object>;
        }

        private static object[] AsArray(object value)
        {
            object[] array = value as object[];
            return array ?? new object[0];
        }

        private static object Get(Dictionary<string, object> map, string key)
        {
            object value;
            if (map != null && map.TryGetValue(key, out value))
            {
                return value;
            }
            return null;
        }

        private static bool HasKey(Dictionary<string, object> map, string key)
        {
            return map != null && map.ContainsKey(key) && map[key] != null;
        }

        private static string AsString(Dictionary<string, object> map, string key)
        {
            object value = Get(map, key);
            if (value == null)
            {
                return "";
            }
            return Convert.ToString(value, CultureInfo.InvariantCulture);
        }

        private static double AsNumber(Dictionary<string, object> map, string key)
        {
            object value = Get(map, key);
            if (value == null)
            {
                return 0;
            }
            if (value is double) return (double)value;
            if (value is decimal) return (double)(decimal)value;
            if (value is int) return (int)value;
            if (value is long) return (long)value;
            double parsed;
            if (double.TryParse(Convert.ToString(value, CultureInfo.InvariantCulture),
                    NumberStyles.Any, CultureInfo.InvariantCulture, out parsed))
            {
                return parsed;
            }
            return 0;
        }

        private static bool AsBool(Dictionary<string, object> map, string key)
        {
            object value = Get(map, key);
            if (value is bool)
            {
                return (bool)value;
            }
            bool parsed;
            if (bool.TryParse(Convert.ToString(value, CultureInfo.InvariantCulture), out parsed))
            {
                return parsed;
            }
            return false;
        }
    }
}
