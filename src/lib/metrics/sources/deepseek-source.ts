import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
	getCodexSessionIndex,
	type CodexRow,
} from "@/lib/codex/session-upstream";
import {
	type CodexRequestRow,
	readCodexRows,
} from "@/lib/metrics/sources/codex-rows";
import { DEEPSEEK_LABEL as DEEPSEEK } from "@/lib/metrics/provider";
import {
	DSH_NATIVE_DEEPSEEK_PROVIDER,
	readDshUsageEvents,
	toDshRequestRecords,
} from "@/lib/dsh/session-usage";
import {
	aggregateRequests,
	buildDaily,
	buildInsights,
	buildModels,
	buildProviders,
	filterRequests,
	pctChange,
} from "@/lib/metrics/aggregate";
import type { MetricSource } from "@/lib/metrics/source";
import {
	calendarDaysBetween,
	startOfDayUtc,
	startOfDayUtcForTime,
} from "@/lib/metrics/time";
import type {
	DeepSeekAccount,
	DeepSeekBalance,
	MetricCapabilities,
	MetricsSnapshot,
	RequestRecord,
	SnapshotOptions,
} from "@/lib/metrics/types";

const ROUTER_DIR = join(homedir(), ".codex", "codex-router");
const DEEPSEEK_KEY_PATH = join(ROUTER_DIR, "deepseek-api-key.secret");
const DEEPSEEK_BALANCE_URL = "https://api.deepseek.com/user/balance";
const ACCOUNT_CACHE_TTL_MS = 30_000;

const DEEPSEEK_CAPABILITIES: MetricCapabilities = {
	latency: false,
	firstToken: false,
	cost: true,
	statusCode: true,
	balance: true,
	provider: false,
};

/**
 * Turns DSH sent straight to api.deepseek.com.
 *
 * Labelled exactly like the Codex rows on this page: they are the same upstream on the
 * same account, and giving them their own label is what stopped \`deepseek-flash\` from
 * merging with itself — two rows, one model, one upstream, listed twice.
 */
const HARNESS_PROVIDER = DEEPSEEK;

/**
 * Plain-language account of what the upstream filter kept and dropped, so the
 * page can state exactly where the excluded requests went.
 */
function upstreamDetail(
	stats: {
		nativeDirect: number;
		nativeViaRouter: number;
		commandCode: number;
		otherUpstream: number;
		unclassified: number;
	},
	total: number,
	harness: number
): string {
	const count = (value: number) => value.toLocaleString("en-US");
	const harnessNote =
		harness > 0
			? ` The view also adds ${count(harness)} harness turns sent straight to api.deepseek.com.`
			: "";
	const excluded = total - stats.nativeDirect - stats.nativeViaRouter;
	if (excluded <= 0) {
		return `Every DeepSeek-model request in the Codex log went to api.deepseek.com.${harnessNote}`;
	}
	const parts: string[] = [];
	if (stats.commandCode > 0) {
		parts.push(`${count(stats.commandCode)} to Command Code`);
	}
	if (stats.otherUpstream > 0) {
		parts.push(`${count(stats.otherUpstream)} to another host`);
	}
	if (stats.unclassified > 0) {
		parts.push(`${count(stats.unclassified)} with no matching Codex session`);
	}
	return `${count(excluded)} of ${count(total)} Codex DeepSeek-model requests excluded: ${parts.join(", ")}.${harnessNote}`;
}

function toNumber(value: unknown): number {
	if (typeof value === "number" && Number.isFinite(value)) {
		return value;
	}
	if (typeof value === "bigint") {
		return Number(value);
	}
	if (typeof value === "string") {
		const parsed = Number.parseFloat(value);
		if (Number.isFinite(parsed)) {
			return parsed;
		}
	}
	return 0;
}

type AccountCache = {
	value: DeepSeekAccount;
	expiresAt: number;
};

let accountCache: AccountCache | null = null;

function parseBalances(raw: unknown): DeepSeekBalance[] {
	if (!Array.isArray(raw)) {
		return [];
	}
	return raw
		.map((item) => {
			if (!item || typeof item !== "object") {
				return null;
			}
			const row = item as Record<string, unknown>;
			const currency = typeof row.currency === "string" ? row.currency : "";
			if (!currency) {
				return null;
			}
			return {
				currency,
				totalBalance: toNumber(row.total_balance),
				grantedBalance: toNumber(row.granted_balance),
				toppedUpBalance: toNumber(row.topped_up_balance),
			};
		})
		.filter((item): item is DeepSeekBalance => item !== null);
}

async function readApiKey(): Promise<{
	key: string;
	source: "env" | "file";
} | null> {
	const envKey = process.env.DEEPSEEK_API_KEY?.trim();
	if (envKey) {
		return { key: envKey, source: "env" };
	}
	try {
		const fileKey = (await readFile(DEEPSEEK_KEY_PATH, "utf8")).trim();
		if (fileKey) {
			return { key: fileKey, source: "file" };
		}
	} catch {
		// A missing key file is a valid "not configured" state.
	}
	return null;
}

async function fetchDeepSeekAccount(): Promise<DeepSeekAccount> {
	const checkedAt = new Date().toISOString();
	const apiKey = await readApiKey();
	if (!apiKey) {
		return {
			configured: false,
			online: false,
			isAvailable: false,
			balances: [],
			checkedAt,
			latencyMs: 0,
			error:
				"No DeepSeek API key found. Set DEEPSEEK_API_KEY or add ~/.codex/codex-router/deepseek-api-key.secret.",
			keySource: null,
		};
	}

	const startedAt = Date.now();
	try {
		const response = await fetch(DEEPSEEK_BALANCE_URL, {
			headers: {
				Accept: "application/json",
				Authorization: `Bearer ${apiKey.key}`,
			},
			cache: "no-store",
			signal: AbortSignal.timeout(8_000),
		});
		const latencyMs = Date.now() - startedAt;
		if (!response.ok) {
			const detail = (await response.text().catch(() => "")).slice(0, 200);
			return {
				configured: true,
				online: false,
				isAvailable: false,
				balances: [],
				checkedAt,
				latencyMs,
				error: `DeepSeek API returned ${response.status}${detail ? `: ${detail}` : ""}`,
				keySource: apiKey.source,
			};
		}
		const body = (await response.json()) as Record<string, unknown>;
		return {
			configured: true,
			online: true,
			isAvailable: body.is_available === true,
			balances: parseBalances(body.balance_infos),
			checkedAt,
			latencyMs,
			error: null,
			keySource: apiKey.source,
		};
	} catch (error) {
		return {
			configured: true,
			online: false,
			isAvailable: false,
			balances: [],
			checkedAt,
			latencyMs: Date.now() - startedAt,
			error:
				error instanceof Error
					? error.message
					: "Unknown DeepSeek API error",
			keySource: apiKey.source,
		};
	}
}

async function getDeepSeekAccount(): Promise<DeepSeekAccount> {
	const now = Date.now();
	if (accountCache && accountCache.expiresAt > now) {
		return accountCache.value;
	}
	const value = await fetchDeepSeekAccount();
	accountCache = {
		value,
		expiresAt: Date.now() + ACCOUNT_CACHE_TTL_MS,
	};
	return value;
}

function readDeepSeekRows(): CodexRequestRow[] {
	return readCodexRows({ deepseekOnly: true });
}

async function getDeepSeekSnapshot(
	options: SnapshotOptions
): Promise<MetricsSnapshot> {
	const [allRows, account, dshEvents] = await Promise.all([
		Promise.resolve(readDeepSeekRows()),
		getDeepSeekAccount(),
		readDshUsageEvents().catch(() => []),
	]);
	// CC Switch stores Codex session traffic without the upstream, so rows that
	// Command Code (or another endpoint) served are removed before any metric is
	// computed. What is left, plus every harness turn DSH sent to
	// api.deepseek.com, is the whole machine's native DeepSeek API traffic: the
	// two sources never describe the same request, because the harness talks to
	// the API directly and never through the Codex Router.
	const codexRows: CodexRow[] = allRows.map((row) => ({
		sessionId: row.sessionId,
		model: row.model,
		outputTokens: row.outputTokens,
		createdAt: Math.floor(Date.parse(row.at) / 1000),
	}));
	const upstreamIndex = await getCodexSessionIndex(codexRows);
	// Every row that survives the upstream filter went to api.deepseek.com by
	// construction, so they all carry the same name as the harness turns below - which
	// is what lets the two halves show up as one row per model instead of two.
	const codexNativeRows: RequestRecord[] = allRows
		.filter((row) => upstreamIndex.nativeSessionIds.has(row.sessionId))
		.map((row) => ({ ...row, provider: HARNESS_PROVIDER }));
	const harnessRows: RequestRecord[] = toDshRequestRecords(
		dshEvents.filter((event) => event.provider === DSH_NATIVE_DEEPSEEK_PROVIDER)
	).map((row) => ({ ...row, provider: HARNESS_PROVIDER }));
	// The merged view has two providers, so the API/model filter must apply here
	// too — otherwise picking "DeepSeek API" would still list harness turns.
	const rows: RequestRecord[] = filterRequests(
		[...codexNativeRows, ...harnessRows].sort(
			(a, b) => Date.parse(b.at) - Date.parse(a.at)
		),
		options.filters ?? {}
	);
	const excluded = allRows.length - codexNativeRows.length;
	const requestedWindowDays = options.windowDays ?? 7;
	const allTime =
		!Number.isFinite(requestedWindowDays) || requestedWindowDays <= 0;
	const requestedDays = allTime
		? 0
		: Math.max(1, Math.trunc(requestedWindowDays));
	const windowStart = allTime
		? null
		: startOfDayUtc(Math.max(requestedDays - 1, 0));
	const previousStart = allTime
		? null
		: startOfDayUtc(requestedDays * 2 - 1);
	const windowStartTime = windowStart?.getTime() ?? 0;
	const previousStartTime = previousStart?.getTime() ?? 0;
	const windowRows = allTime
		? rows
		: rows.filter((row) => Date.parse(row.at) >= windowStartTime);
	const previousRows = allTime
		? []
		: rows.filter((row) => {
				const time = Date.parse(row.at);
				return time >= previousStartTime && time < windowStartTime;
			});

	const current = aggregateRequests(windowRows);
	const previous = aggregateRequests(previousRows);
	const total = aggregateRequests(rows);
	const earliest = rows.reduce((earliestTime, row) => {
		const time = Date.parse(row.at);
		return Number.isFinite(time) && time < earliestTime ? time : earliestTime;
	}, Number.POSITIVE_INFINITY);
	const activeWindowDays = allTime
		? Number.isFinite(earliest)
			? calendarDaysBetween(startOfDayUtc(0), startOfDayUtcForTime(earliest))
			: 1
		: requestedDays;
	const daily = buildDaily(windowRows, activeWindowDays, allTime);
	const recentCount = Math.max(options.recentCount ?? 12, 1);
	const recent = rows.slice(0, recentCount);

	return {
		source: "deepseek",
		sourceLabel: "DeepSeek API",
		status: account.online
			? "live"
			: account.configured
				? "error"
				: "unavailable",
		statusDetail: account.online
			? `api.deepseek.com · balance check ${account.latencyMs} ms`
			: account.error ?? "DeepSeek API is not reachable.",
		generatedAt: new Date().toISOString(),
		capabilities: DEEPSEEK_CAPABILITIES,
		totals: {
			requests: total.requests,
			success: total.success,
			failed: total.failed,
			successRate: total.successRate,
			totalTokens: total.totalTokens,
			inputTokens: total.inputTokens,
			outputTokens: total.outputTokens,
			cacheReadTokens: total.cacheReadTokens,
			totalCostUsd: total.totalCostUsd,
			totalCostCny: total.totalCostCny,
			avgDurationMs: total.avgDurationMs,
			avgFirstTokenMs: total.avgFirstTokenMs,
			models: new Set(rows.map((row) => row.model)).size,
			providers: new Set(rows.map((row) => row.provider)).size,
		},
		window: {
			days: activeWindowDays,
			allTime,
			requests: current.requests,
			success: current.success,
			failed: current.failed,
			successRate: current.successRate,
			totalTokens: current.totalTokens,
			inputTokens: current.inputTokens,
			outputTokens: current.outputTokens,
			cacheReadTokens: current.cacheReadTokens,
			totalCostUsd: current.totalCostUsd,
			totalCostCny: current.totalCostCny,
			avgDurationMs: current.avgDurationMs,
			avgFirstTokenMs: current.avgFirstTokenMs,
			models: new Set(windowRows.map((row) => row.model)).size,
			providers: new Set(windowRows.map((row) => row.provider)).size,
			deltaRequestsPct: allTime
				? 0
				: pctChange(current.requests, previous.requests),
			deltaTokensPct: allTime
				? 0
				: pctChange(current.totalTokens, previous.totalTokens),
			deltaLatencyPct: allTime
				? 0
				: pctChange(current.avgDurationMs, previous.avgDurationMs),
			deltaSuccessRatePp: allTime
				? 0
				: current.successRate - previous.successRate,
		},
		daily,
		models: buildModels(rows),
		windowModels: buildModels(windowRows),
		allModels: buildModels(rows),
		providers: buildProviders(rows),
		windowProviders: buildProviders(windowRows),
		insights: buildInsights(windowRows, daily),
		recent,
		health: null,
		account,
		upstream: {
			label: "every native api.deepseek.com request",
			included: rows.length,
			excluded,
			breakdown: {
				nativeDirect: upstreamIndex.stats.nativeDirect,
				nativeViaRouter: upstreamIndex.stats.nativeViaRouter,
				harness: harnessRows.length,
				commandCode: upstreamIndex.stats.commandCode,
				otherUpstream: upstreamIndex.stats.otherUpstream,
				unclassified: upstreamIndex.stats.unclassified,
			},
			detail: upstreamDetail(
				upstreamIndex.stats,
				allRows.length,
				harnessRows.length
			),
		},
	};
}

export class DeepSeekSource implements MetricSource {
	id = "deepseek" as const;
	label = "DeepSeek API";
	readonly capabilities = DEEPSEEK_CAPABILITIES;

	async getSnapshot(options: SnapshotOptions): Promise<MetricsSnapshot> {
		return getDeepSeekSnapshot(options);
	}
}
