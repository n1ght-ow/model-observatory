import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
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
	MetricCapabilities,
	MetricsSnapshot,
	RequestRecord,
	SnapshotOptions,
	SourceHealth,
} from "@/lib/metrics/types";

const ROUTER_DIR = join(homedir(), ".codex", "codex-router");
const USAGE_EVENTS_PATH = join(ROUTER_DIR, "usage-events.jsonl");
const CALLER_SECRET_PATH = join(ROUTER_DIR, "caller-secret");
const ROUTER_HEALTH_URL = "http://127.0.0.1:4202/v1/health";

const ROUTER_CAPABILITIES: MetricCapabilities = {
	latency: true,
	firstToken: true,
	cost: false,
	statusCode: true,
	balance: false,
	provider: true,
};

type UsageEvent = {
	at: string;
	model: string;
	provider: string;
	status: number;
	durationMs: number;
	firstTokenMs: number;
	inputTokens: number;
	outputTokens: number;
	totalTokens: number;
	estimatedInputTokens: number;
};

function toNumber(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function toEvent(raw: unknown): UsageEvent | null {
	if (!raw || typeof raw !== "object") {
		return null;
	}
	const row = raw as Record<string, unknown>;
	const at = typeof row.at === "string" ? row.at : null;
	if (!at) {
		return null;
	}
	return {
		at,
		model: typeof row.model === "string" ? row.model : "unknown",
		provider: typeof row.provider === "string" ? row.provider : "unknown",
		status: toNumber(row.status),
		durationMs: toNumber(row.durationMs),
		firstTokenMs: toNumber(row.firstTokenMs),
		inputTokens: toNumber(row.inputTokens),
		outputTokens: toNumber(row.outputTokens),
		totalTokens: toNumber(row.totalTokens),
		estimatedInputTokens: toNumber(row.estimatedInputTokens),
	};
}

function toRequestRecord(event: UsageEvent): RequestRecord {
	const inputTokens =
		event.inputTokens > 0 ? event.inputTokens : event.estimatedInputTokens;
	const derivedTotal = inputTokens + event.outputTokens;
	const totalTokens =
		event.totalTokens > 0
			? Math.max(event.totalTokens, derivedTotal)
			: derivedTotal;
	return {
		at: event.at,
		model: event.model,
		provider: event.provider,
		status: event.status,
		durationMs: event.durationMs > 0 ? event.durationMs : undefined,
		firstTokenMs: event.firstTokenMs > 0 ? event.firstTokenMs : undefined,
		inputTokens,
		outputTokens: event.outputTokens,
		totalTokens,
	};
}

async function readEvents(): Promise<UsageEvent[]> {
	const events: UsageEvent[] = [];
	try {
		const stream = createReadStream(USAGE_EVENTS_PATH, { encoding: "utf8" });
		const lines = createInterface({ input: stream, crlfDelay: Infinity });
		for await (const line of lines) {
			const trimmed = line.trim();
			if (!trimmed) {
				continue;
			}
			try {
				const event = toEvent(JSON.parse(trimmed));
				if (event) {
					events.push(event);
				}
			} catch {
				// Skip malformed rows rather than failing the whole dashboard.
			}
		}
	} catch {
		return [];
	}
	return events;
}

async function readHealth(): Promise<SourceHealth | null> {
	try {
		const secret = (await readFile(CALLER_SECRET_PATH, "utf8")).trim();
		const response = await fetch(ROUTER_HEALTH_URL, {
			headers: { Authorization: `Bearer ${secret}` },
			cache: "no-store",
			signal: AbortSignal.timeout(4000),
		});
		if (!response.ok) {
			return null;
		}
		const body = (await response.json()) as Record<string, unknown>;
		const activity = (body.activity ?? {}) as Record<string, unknown>;
		const api = (body.api ?? {}) as Record<string, unknown>;
		const providersRaw = (api.providers ?? {}) as Record<string, unknown>;
		const providers = Object.entries(providersRaw).map(([name, value]) => {
			const detail = (value ?? {}) as Record<string, unknown>;
			return {
				name,
				credentialPresent: detail.credential_present === true,
			};
		});
		const version = typeof body.version === "string" ? body.version : "unknown";
		const router = typeof body.router === "string" ? body.router : "unknown";
		const activityState =
			typeof activity.state === "string" ? activity.state : "unknown";
		return {
			ok: body.ok === true,
			label: "Codex Router",
			detail: `v${version} · ${router} · ${activityState}`,
			checkedAt: new Date().toISOString(),
			providers,
		};
	} catch {
		return null;
	}
}

async function getRouterSnapshot(
	options: SnapshotOptions
): Promise<MetricsSnapshot> {
	const [events, health] = await Promise.all([readEvents(), readHealth()]);
	const rows = events.map(toRequestRecord);
	const scopedRows = filterRequests(rows, options.filters ?? {});
	const requestedWindowDays = options.windowDays ?? 7;
	const allTime =
		!Number.isFinite(requestedWindowDays) || requestedWindowDays <= 0;
	const requestedDays = allTime
		? 0
		: Math.max(1, Math.trunc(requestedWindowDays));
	const earliestEventTime = scopedRows.reduce((earliest, row) => {
		const time = Date.parse(row.at);
		return Number.isFinite(time) && time < earliest ? time : earliest;
	}, Number.POSITIVE_INFINITY);
	const windowStart =
		allTime && Number.isFinite(earliestEventTime)
			? startOfDayUtcForTime(earliestEventTime)
			: startOfDayUtc(Math.max(requestedDays - 1, 0));
	const activeWindowDays = allTime
		? Number.isFinite(earliestEventTime)
			? calendarDaysBetween(startOfDayUtc(0), windowStart)
			: 1
		: requestedDays;
	const previousStart = startOfDayUtc(requestedDays * 2 - 1);
	const windowRows = allTime
		? scopedRows
		: scopedRows.filter(
				(row) => Date.parse(row.at) >= windowStart.getTime()
			);
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
	const allModels = buildModels(rows);
	const models = buildModels(scopedRows);
	const windowModels = buildModels(windowRows);
	const providers = buildProviders(scopedRows);
	const windowProviders = buildProviders(windowRows);
	const recentCount = Math.max(options.recentCount ?? 12, 1);
	const recent = scopedRows.slice(-recentCount).reverse();

	return {
		source: "router",
		sourceLabel: "Codex Router API",
		status: health?.ok ? "live" : "unavailable",
		statusDetail: health?.ok
			? health.detail
			: "Codex Router is not responding on 127.0.0.1:4202.",
		generatedAt: new Date().toISOString(),
		capabilities: ROUTER_CAPABILITIES,
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
			avgDurationMs: total.avgDurationMs,
			avgFirstTokenMs: total.avgFirstTokenMs,
			models: new Set(scopedRows.map((row) => row.model)).size,
			providers: new Set(scopedRows.map((row) => row.provider)).size,
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
		models,
		windowModels,
		allModels,
		providers,
		windowProviders,
		insights: buildInsights(windowRows, daily),
		recent,
		health,
	};
}

export class RouterSource implements MetricSource {
	id = "router" as const;
	label = "Codex Router API";
	readonly capabilities = ROUTER_CAPABILITIES;

	async getSnapshot(options: SnapshotOptions): Promise<MetricsSnapshot> {
		return getRouterSnapshot(options);
	}
}
