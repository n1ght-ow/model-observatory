import type { CommandCodeReport } from "@/lib/commandcode/types";

export type MetricSourceId = "all" | "deepseek" | "router" | "harness";

export type SourceStatus = "live" | "syncing" | "unavailable" | "error";

export type MetricCapabilities = {
	latency: boolean;
	firstToken: boolean;
	cost: boolean;
	statusCode: boolean;
	balance: boolean;
	provider: boolean;
};

export type RequestRecord = {
	at: string;
	model: string;
	provider: string;
	status: number;
	durationMs?: number;
	firstTokenMs?: number;
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens?: number;
	totalTokens: number;
	costUsd?: number;
	/** Estimated cost in CNY from DeepSeek's official price list. */
	costCny?: number;
	dataSource?: string;
};

export type DailyPoint = {
	date: string;
	requests: number;
	success: number;
	failed: number;
	tokens: number;
	avgDurationMs: number;
	costUsd?: number;
};

export type ModelUsage = {
	model: string;
	provider: string;
	requests: number;
	tokens: number;
	avgDurationMs: number;
	errorRate: number;
	costUsd?: number;
};

export type ProviderUsage = {
	provider: string;
	requests: number;
	tokens: number;
	errorRate: number;
	costUsd?: number;
};

export type HourlyPoint = {
	hour: number;
	requests: number;
	tokens: number;
};

export type DailyActivity = {
	date: string;
	requests: number;
	level: 0 | 1 | 2 | 3 | 4;
};

export type UsageInsights = {
	hourly: HourlyPoint[];
	activity: DailyActivity[];
	peakHour: number | null;
	peakHourRequests: number;
	currentStreak: number;
	longestStreak: number;
	activeDays: number;
	busiestDay: string | null;
	busiestDayRequests: number;
};

export type MetricsTotals = {
	requests: number;
	success: number;
	failed: number;
	successRate: number;
	totalTokens: number;
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens?: number;
	totalCostUsd?: number;
	/** Estimated CNY spend (DeepSeek official pricing); absent for other sources. */
	totalCostCny?: number;
	avgDurationMs: number;
	avgFirstTokenMs: number;
	models: number;
	providers: number;
};

export type MetricsWindow = MetricsTotals & {
	days: number;
	allTime: boolean;
	deltaRequestsPct: number;
	deltaTokensPct: number;
	deltaLatencyPct: number;
	deltaSuccessRatePp: number;
};

export type SourceHealth = {
	ok: boolean;
	label: string;
	detail: string;
	checkedAt: string;
	latencyMs?: number;
	providers?: { name: string; credentialPresent: boolean }[];
};

export type DeepSeekBalance = {
	currency: string;
	totalBalance: number;
	grantedBalance: number;
	toppedUpBalance: number;
};

export type DeepSeekAccount = {
	configured: boolean;
	online: boolean;
	isAvailable: boolean;
	balances: DeepSeekBalance[];
	checkedAt: string;
	latencyMs: number;
	error: string | null;
	keySource: "env" | "file" | null;
};

export type MetricsFilters = {
	provider?: string | null;
	model?: string | null;
	modelContains?: string | null;
};

export type SnapshotOptions = {
	windowDays?: number;
	filters?: MetricsFilters;
	recentCount?: number;
};

export type MetricsSnapshot = {
	source: MetricSourceId;
	sourceLabel: string;
	status: SourceStatus;
	statusDetail: string;
	generatedAt: string;
	capabilities: MetricCapabilities;
	totals: MetricsTotals;
	window: MetricsWindow;
	daily: DailyPoint[];
	models: ModelUsage[];
	windowModels: ModelUsage[];
	allModels: ModelUsage[];
	providers: ProviderUsage[];
	windowProviders: ProviderUsage[];
	insights: UsageInsights;
	recent: RequestRecord[];
	health: SourceHealth | null;
	account?: DeepSeekAccount;
	/**
	 * Command Code account usage and paced windows, attached for every source
	 * because the account is independent of the active router profile. Null
	 * when the report could not be produced.
	 */
	commandCode?: CommandCodeReport | null;
	/** Which upstreams a source kept, when it filters by upstream. */
	upstream?: UpstreamFilterInfo | null;
	/**
	 * How the "all" view was assembled, so the page can explain why its totals
	 * differ from the sum of the three tabs. Absent for every other source.
	 */
	allScope?: AllScopeInfo | null;
};

/**
 * The "all" tab is a union of three readers, not a sum of three tabs.
 *
 * Each request is owned by exactly one reader — the router log owns everything that
 * went through the router, the harness owns every DSH turn, and CC Switch contributes
 * only the Codex sessions that did *not* go through the router. Adding the three tabs
 * together would count roughly a thousand rows twice, because router traffic and
 * harness turns are each visible to two readers.
 */
export type AllScopeInfo = {
	/** Requests contributed by each reader. */
	sources: {
		/** Rows from the Codex Router's own event log. */
		router: number;
		/** Turns read from the DeepSeek Harness session logs. */
		harness: number;
		/** Codex rows CC Switch recorded that the router never saw. */
		codexDirect: number;
	};
	/**
	 * Codex rows dropped because the router log already contains them.
	 *
	 * This is the only genuine overlap between readers. Harness turns are *not*
	 * duplicated here — they only look that way when the three tabs are added up,
	 * because /deepseek chooses to merge the DeepSeek-hosted ones into itself.
	 */
	dedupedViaRouter: number;
	/** Rows whose Codex rollout is gone, so their route cannot be known. */
	unknownUpstream: number;
	detail: string;
};

export type UpstreamFilterInfo = {
	/** Human readable scope, e.g. "native api.deepseek.com only". */
	label: string;
	included: number;
	/** Requests dropped because another upstream (Command Code, …) served them. */
	excluded: number;
	detail: string;
	/** Where every row went, so the exclusion is auditable. */
	breakdown: {
		/** Codex sessions configured to call api.deepseek.com directly. */
		nativeDirect: number;
		/** Codex Router sessions the router forwarded to DeepSeek. */
		nativeViaRouter: number;
		/** DeepSeek Harness turns sent straight to api.deepseek.com. */
		harness: number;
		/** Router sessions the router forwarded to Command Code. */
		commandCode: number;
		/** Sessions served by another host (api.apikey.fun, OpenAI, …). */
		otherUpstream: number;
		/** Rows whose Codex session could not be found. */
		unclassified: number;
	};
};
