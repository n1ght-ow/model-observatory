import {
	aggregateRequests,
	buildDaily,
	buildInsights,
	buildModels,
	buildProviders,
	filterRequests,
	pctChange,
} from "@/lib/metrics/aggregate";
import {
	readDshUsageEvents,
	toDshRequestRecords,
} from "@/lib/dsh/session-usage";
import { providerLabel } from "@/lib/metrics/provider";
import type { MetricSource } from "@/lib/metrics/source";
import {
	calendarDaysBetween,
	startOfDayUtc,
	startOfDayUtcForTime,
} from "@/lib/metrics/time";
import type {
	MetricCapabilities,
	MetricsSnapshot,
	SnapshotOptions,
} from "@/lib/metrics/types";

/**
 * DeepSeek Harness traffic, read from the harness's own session logs.
 *
 * This is a third data path next to the DeepSeek API and the Codex Router: the
 * harness talks to api.deepseek.com and to Command Code directly, so neither CC
 * Switch nor the router ever sees those requests. Each record's `provider` is
 * the upstream DSH recorded (`deepseek-official`, `command-code`, …), which is
 * also what the API/provider filter narrows on.
 */
const HARNESS_CAPABILITIES: MetricCapabilities = {
	// The session log records when a step started and when its turn finished,
	// but no HTTP status and no first-token timestamp.
	latency: true,
	firstToken: false,
	cost: false,
	statusCode: false,
	balance: false,
	provider: true,
};

async function getHarnessSnapshot(
	options: SnapshotOptions
): Promise<MetricsSnapshot> {
	const events = await readDshUsageEvents();
	const rows = toDshRequestRecords(events);
	// DSH writes the upstream it used into every turn (\`deepseek-official\`,
	// \`command-code\`, …), so this reader is already telling the truth; it just spells
	// some of them differently to the router.
	const labelled = rows.map((row) => ({
		...row,
		provider: providerLabel(row.provider),
	}));
	const scopedRows = filterRequests(labelled, options.filters ?? {});
	const requestedWindowDays = options.windowDays ?? 7;
	const allTime =
		!Number.isFinite(requestedWindowDays) || requestedWindowDays <= 0;
	const requestedDays = allTime ? 0 : Math.max(1, Math.trunc(requestedWindowDays));
	const earliestTime = scopedRows.reduce((earliest, row) => {
		const time = Date.parse(row.at);
		return Number.isFinite(time) && time < earliest ? time : earliest;
	}, Number.POSITIVE_INFINITY);
	const windowStart =
		allTime && Number.isFinite(earliestTime)
			? startOfDayUtcForTime(earliestTime)
			: startOfDayUtc(Math.max(requestedDays - 1, 0));
	const activeWindowDays = allTime
		? Number.isFinite(earliestTime)
			? calendarDaysBetween(startOfDayUtc(0), windowStart)
			: 1
		: requestedDays;
	const previousStart = startOfDayUtc(requestedDays * 2 - 1);
	const windowRows = allTime
		? scopedRows
		: scopedRows.filter((row) => Date.parse(row.at) >= windowStart.getTime());
	const previousRows = allTime
		? []
		: scopedRows.filter((row) => {
				const time = Date.parse(row.at);
				return (
					time >= previousStart.getTime() && time < windowStart.getTime()
				);
			});

	const current = aggregateRequests(windowRows);
	const previous = aggregateRequests(previousRows);
	const total = aggregateRequests(scopedRows);
	const daily = buildDaily(windowRows, activeWindowDays, allTime);
	const recentCount = Math.max(options.recentCount ?? 12, 1);
	const recent = scopedRows.slice(0, recentCount);
	const latest = scopedRows[0]?.at ?? null;
	const upstreams = new Set(scopedRows.map((row) => row.provider));

	return {
		source: "harness",
		sourceLabel: "DeepSeek Harness",
		status: latest ? "live" : "unavailable",
		statusDetail: latest
			? `${upstreams.size} upstream${upstreams.size === 1 ? "" : "s"} · last turn ${new Date(latest).toISOString()}`
			: "No harness turns recorded in ~/.dsh/sessions.",
		generatedAt: new Date().toISOString(),
		capabilities: HARNESS_CAPABILITIES,
		totals: {
			requests: total.requests,
			success: total.success,
			failed: total.failed,
			successRate: total.successRate,
			totalTokens: total.totalTokens,
			inputTokens: total.inputTokens,
			outputTokens: total.outputTokens,
			cacheReadTokens: total.cacheReadTokens,
			totalCostUsd: undefined,
			totalCostCny: total.totalCostCny,
			avgDurationMs: total.avgDurationMs,
			avgFirstTokenMs: total.avgFirstTokenMs,
			models: new Set(scopedRows.map((row) => row.model)).size,
			providers: upstreams.size,
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
			totalCostUsd: undefined,
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
		models: buildModels(scopedRows),
		windowModels: buildModels(windowRows),
		allModels: buildModels(scopedRows),
		providers: buildProviders(scopedRows),
		windowProviders: buildProviders(windowRows),
		insights: buildInsights(windowRows, daily),
		recent,
		health: null,
	};
}

export class HarnessSource implements MetricSource {
	id = "harness" as const;
	label = "DeepSeek Harness";
	readonly capabilities = HARNESS_CAPABILITIES;

	async getSnapshot(options: SnapshotOptions): Promise<MetricsSnapshot> {
		return getHarnessSnapshot(options);
	}
}
