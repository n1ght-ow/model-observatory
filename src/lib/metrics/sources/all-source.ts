import { getCodexSessionIndex } from "@/lib/codex/session-upstream";
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
import { readCodexRows } from "@/lib/metrics/sources/codex-rows";
import { readRouterRowsAsync } from "@/lib/metrics/sources/router-rows";
import {
	calendarDaysBetween,
	startOfDayUtc,
	startOfDayUtcForTime,
} from "@/lib/metrics/time";
import type {
	AllScopeInfo,
	MetricCapabilities,
	MetricsSnapshot,
	RequestRecord,
	SnapshotOptions,
} from "@/lib/metrics/types";

/**
 * Every request this machine made that any reader can see.
 *
 * This is a union of three readers, **not** a sum of the three tabs. The tabs overlap:
 * a harness turn sent to api.deepseek.com appears on both /harness and /deepseek, and
 * anything the Codex Router forwarded appears on both /router and /deepseek. Adding
 * the three tabs together counts roughly a thousand rows twice.
 *
 * So ownership is split by *reader*, which makes the three parts disjoint:
 *
 * | Owner | Holds | Why |
 * | --- | --- | --- |
 * | router log | everything through the router | every routed request, with the final upstream |
 * | harness log | every DSH turn | DSH talks to upstreams directly, so nothing else sees it |
 * | CC Switch | Codex rows the router never saw | the non-DeepSeek rows no tab can show |
 *
 * The router-forwarded Codex rows are dropped from CC Switch because the router log
 * already has them. The one thing that cannot be settled is a Codex row whose rollout
 * file is gone: its route is unknowable, so it is counted and labelled rather than
 * guessed at or silently dropped.
 */
const ALL_CAPABILITIES: MetricCapabilities = {
	// Three readers measure duration three different ways: CC Switch records
	// `latency_ms`, the router records `durationMs`, and DSH measures a whole turn.
	// The average is therefore over "rows that reported something", which the page says.
	latency: true,
	// Only the router log records a first-token timestamp.
	firstToken: false,
	// DeepSeek's CNY list prices only DeepSeek models, CC Switch's USD is near zero
	// (the account is billed in CNY), and the router logs no cost at all. A combined
	// total would be a number without a meaning, so there is not one.
	cost: false,
	statusCode: true,
	balance: false,
	provider: true,
};

const HARNESS_PROVIDER = "DeepSeek API · Harness";

function tagProvider(rows: RequestRecord[], provider: string): RequestRecord[] {
	return rows.map((row) => ({ ...row, provider }));
}

async function getAllSnapshot(
	options: SnapshotOptions
): Promise<MetricsSnapshot> {
	// Every Codex row, not just the DeepSeek ones: the non-DeepSeek rows are the
	// reason this tab exists.
	const codexRows = readCodexRows({ deepseekOnly: false, provider: "Codex" });
	const codexIndex = await getCodexSessionIndex(
		codexRows.map((row) => ({
			sessionId: row.sessionId,
			model: row.model,
			outputTokens: row.outputTokens,
			createdAt: Math.floor(Date.parse(row.at) / 1000),
		}))
	);

	// The router log owns everything it saw; its rows are kept whole.
	const routerRows: RequestRecord[] = tagProvider(
		await readRouterRowsAsync(),
		"Codex Router"
	);

	// CC Switch contributes only what the router did not already record.
	const codexDirect = codexRows.filter(
		(row) => !codexIndex.routerSessionIds.has(row.sessionId)
	);

	const dshEvents = await readDshUsageEvents().catch(() => []);
	// DSH records the real upstream on every turn, which is more useful than one
	// label for the whole reader. Only the DeepSeek-hosted turns get renamed, to
	// match how /deepseek labels the same rows, so the two pages agree.
	const harnessLabelled: RequestRecord[] = toDshRequestRecords(dshEvents).map(
		(row) => ({
			...row,
			provider:
				row.provider === DSH_NATIVE_DEEPSEEK_PROVIDER
					? HARNESS_PROVIDER
					: row.provider,
		})
	);

	const unknown = codexDirect.filter(
		(row) => !codexIndex.providers.has(row.sessionId)
	).length;

	const rows = filterRequests(
		[...routerRows, ...harnessLabelled, ...codexDirect].sort(
			(a, b) => Date.parse(b.at) - Date.parse(a.at)
		),
		options.filters ?? {}
	);

	const allScope: AllScopeInfo = {
		sources: {
			router: routerRows.length,
			harness: harnessLabelled.length,
			codexDirect: codexDirect.length,
		},
		// Rows CC Switch holds that the router already counted.
		dedupedViaRouter: codexRows.length - codexDirect.length,
		unknownUpstream: unknown,
		detail: allDetail({
			router: routerRows.length,
			harness: harnessLabelled.length,
			codexDirect: codexDirect.length,
			deduped: codexRows.length - codexDirect.length,
			unknown,
		}),
	};

	const requestedWindowDays = options.windowDays ?? 7;
	const allTime =
		!Number.isFinite(requestedWindowDays) || requestedWindowDays <= 0;
	const requestedDays = allTime ? 0 : Math.max(1, Math.trunc(requestedWindowDays));
	const earliestTime = rows.reduce((earliest, row) => {
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
		? rows
		: rows.filter((row) => Date.parse(row.at) >= windowStart.getTime());
	const previousRows = allTime
		? []
		: rows.filter((row) => {
				const time = Date.parse(row.at);
				return (
					time >= previousStart.getTime() && time < windowStart.getTime()
				);
			});

	const current = aggregateRequests(windowRows);
	const previous = aggregateRequests(previousRows);
	const total = aggregateRequests(rows);
	const daily = buildDaily(windowRows, activeWindowDays, allTime);
	const recentCount = Math.max(options.recentCount ?? 12, 1);
	const latest = rows[0]?.at ?? null;

	return {
		source: "all",
		sourceLabel: "All sources",
		status: latest ? "live" : "unavailable",
		statusDetail: latest
			? `${allScope.sources.router.toLocaleString("en-US")} routed · ${allScope.sources.harness.toLocaleString("en-US")} harness · ${allScope.sources.codexDirect.toLocaleString("en-US")} direct`
			: "No requests recorded by any reader.",
		generatedAt: new Date().toISOString(),
		capabilities: ALL_CAPABILITIES,
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
			totalCostCny: undefined,
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
			totalCostUsd: undefined,
			totalCostCny: undefined,
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
		recent: rows.slice(0, recentCount),
		health: null,
		allScope,
	};
}

function allDetail(counts: {
	router: number;
	harness: number;
	codexDirect: number;
	deduped: number;
	unknown: number;
}): string {
	const n = (value: number) => value.toLocaleString("en-US");
	const parts = [
		`${n(counts.router)} requests from the Codex Router log`,
		`${n(counts.harness)} turns from the DeepSeek Harness logs`,
		`${n(counts.codexDirect)} Codex requests the router never saw`,
	];
	const notes: string[] = [];
	if (counts.deduped > 0) {
		notes.push(
			`${n(counts.deduped)} Codex rows are excluded because the router log already contains them`
		);
	}
	if (counts.unknown > 0) {
		notes.push(
			`${n(counts.unknown)} could not be attributed to an upstream because their Codex session is gone`
		);
	}
	return `${parts.join(", ")}.${notes.length ? " " + notes.join("; ") + "." : ""}`;
}

export class AllSource implements MetricSource {
	id = "all" as const;
	label = "All sources";
	readonly capabilities = ALL_CAPABILITIES;

	async getSnapshot(options: SnapshotOptions): Promise<MetricsSnapshot> {
		return getAllSnapshot(options);
	}
}
