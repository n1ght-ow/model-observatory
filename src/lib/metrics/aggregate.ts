import type {
	DailyActivity,
	DailyPoint,
	HourlyPoint,
	MetricsFilters,
	ModelUsage,
	ProviderUsage,
	RequestRecord,
	UsageInsights,
} from "@/lib/metrics/types";
import { startOfDayUtc } from "@/lib/metrics/time";

export function average(values: number[]): number {
	if (values.length === 0) {
		return 0;
	}
	return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function pctChange(current: number, previous: number): number {
	if (previous === 0) {
		return current === 0 ? 0 : 100;
	}
	return ((current - previous) / previous) * 100;
}

export function isSuccess(status: number): boolean {
	return status >= 200 && status < 300;
}

export function aggregateRequests(rows: RequestRecord[]) {
	const durations = rows
		.map((row) => row.durationMs ?? 0)
		.filter((value) => value > 0);
	const firstTokens = rows
		.map((row) => row.firstTokenMs ?? 0)
		.filter((value) => value > 0);
	const success = rows.filter((row) => isSuccess(row.status)).length;
	return {
		requests: rows.length,
		success,
		failed: rows.length - success,
		successRate: rows.length === 0 ? 0 : (success / rows.length) * 100,
		totalTokens: rows.reduce((sum, row) => sum + row.totalTokens, 0),
		inputTokens: rows.reduce((sum, row) => sum + row.inputTokens, 0),
		outputTokens: rows.reduce((sum, row) => sum + row.outputTokens, 0),
		cacheReadTokens: rows.reduce(
			(sum, row) => sum + (row.cacheReadTokens ?? 0),
			0
		),
		totalCostUsd: rows.reduce((sum, row) => sum + (row.costUsd ?? 0), 0),
		totalCostCny: rows.reduce((sum, row) => sum + (row.costCny ?? 0), 0),
		avgDurationMs: average(durations),
		avgFirstTokenMs: average(firstTokens),
	};
}

export function buildDaily(
	rows: RequestRecord[],
	days: number,
	allTime: boolean
): DailyPoint[] {
	const buckets = new Map<string, DailyPoint>();
	const durationSums = new Map<string, number>();
	const durationCounts = new Map<string, number>();
	const costSums = new Map<string, number>();

	let rangeDays = days;
	if (allTime) {
		const earliest = rows.reduce((earliestTime, row) => {
			const time = Date.parse(row.at);
			return Number.isFinite(time) && time < earliestTime ? time : earliestTime;
		}, Number.POSITIVE_INFINITY);
		rangeDays = Number.isFinite(earliest)
			? Math.max(
					1,
					Math.min(366, Math.ceil((Date.now() - earliest) / 86_400_000) + 1)
				)
			: 1;
	}

	for (let i = rangeDays - 1; i >= 0; i -= 1) {
		const key = startOfDayUtc(i).toISOString().slice(0, 10);
		buckets.set(key, {
			date: key,
			requests: 0,
			success: 0,
			failed: 0,
			tokens: 0,
			avgDurationMs: 0,
			costUsd: 0,
		});
	}

	for (const row of rows) {
		const key = row.at.slice(0, 10);
		const bucket = buckets.get(key);
		if (!bucket) {
			continue;
		}
		bucket.requests += 1;
		bucket.tokens += row.totalTokens;
		bucket.costUsd = (bucket.costUsd ?? 0) + (row.costUsd ?? 0);
		if (isSuccess(row.status)) {
			bucket.success += 1;
		} else {
			bucket.failed += 1;
		}
		if (row.durationMs && row.durationMs > 0) {
			durationSums.set(key, (durationSums.get(key) ?? 0) + row.durationMs);
			durationCounts.set(key, (durationCounts.get(key) ?? 0) + 1);
		}
		costSums.set(key, (costSums.get(key) ?? 0) + (row.costUsd ?? 0));
	}

	for (const [key, bucket] of buckets) {
		const count = durationCounts.get(key) ?? 0;
		bucket.avgDurationMs =
			count > 0 ? (durationSums.get(key) ?? 0) / count : 0;
		bucket.costUsd = costSums.get(key) ?? 0;
	}

	return [...buckets.values()];
}

export function buildModels(rows: RequestRecord[]): ModelUsage[] {
	const grouped = new Map<string, RequestRecord[]>();
	for (const row of rows) {
		const key = `${row.provider}::${row.model}`;
		const bucket = grouped.get(key);
		if (bucket) {
			bucket.push(row);
		} else {
			grouped.set(key, [row]);
		}
	}
	return [...grouped.values()]
		.map((bucket) => {
			const first = bucket[0];
			const durations = bucket
				.map((row) => row.durationMs ?? 0)
				.filter((value) => value > 0);
			const failed = bucket.filter((row) => !isSuccess(row.status)).length;
			return {
				model: first.model,
				provider: first.provider,
				requests: bucket.length,
				tokens: bucket.reduce((sum, row) => sum + row.totalTokens, 0),
				avgDurationMs: average(durations),
				errorRate: bucket.length === 0 ? 0 : (failed / bucket.length) * 100,
				costUsd: bucket.reduce((sum, row) => sum + (row.costUsd ?? 0), 0),
			};
		})
		.sort((a, b) => b.requests - a.requests || b.tokens - a.tokens);
}

export function buildProviders(rows: RequestRecord[]): ProviderUsage[] {
	const grouped = new Map<string, RequestRecord[]>();
	for (const row of rows) {
		const bucket = grouped.get(row.provider);
		if (bucket) {
			bucket.push(row);
		} else {
			grouped.set(row.provider, [row]);
		}
	}
	return [...grouped.entries()]
		.map(([provider, bucket]) => {
			const failed = bucket.filter((row) => !isSuccess(row.status)).length;
			return {
				provider,
				requests: bucket.length,
				tokens: bucket.reduce((sum, row) => sum + row.totalTokens, 0),
				errorRate: bucket.length === 0 ? 0 : (failed / bucket.length) * 100,
				costUsd: bucket.reduce((sum, row) => sum + (row.costUsd ?? 0), 0),
			};
		})
		.sort((a, b) => b.requests - a.requests);
}

export function buildInsights(
	rows: RequestRecord[],
	daily: DailyPoint[]
): UsageInsights {
	const hourly: HourlyPoint[] = Array.from({ length: 24 }, (_, hour) => ({
		hour,
		requests: 0,
		tokens: 0,
	}));
	for (const row of rows) {
		const hour = new Date(row.at).getHours();
		hourly[hour].requests += 1;
		hourly[hour].tokens += row.totalTokens;
	}
	const peak = hourly.reduce(
		(best, point) => (point.requests > best.requests ? point : best),
		hourly[0]
	);
	const activeCounts = daily
		.map((point) => point.requests)
		.filter((count) => count > 0);
	const maxDayRequests = Math.max(1, ...activeCounts);
	const activity: DailyActivity[] = daily.map((point) => {
		if (point.requests <= 0) {
			return { date: point.date, requests: 0, level: 0 };
		}
		const ratio = point.requests / maxDayRequests;
		const level = ratio > 0.75 ? 4 : ratio > 0.5 ? 3 : ratio > 0.25 ? 2 : 1;
		return { date: point.date, requests: point.requests, level };
	});
	let longestStreak = 0;
	let runningStreak = 0;
	let trailingStreak = 0;
	for (const point of daily) {
		if (point.requests > 0) {
			runningStreak += 1;
			longestStreak = Math.max(longestStreak, runningStreak);
		} else {
			runningStreak = 0;
		}
	}
	for (let i = daily.length - 1; i >= 0; i -= 1) {
		if (daily[i].requests > 0) {
			trailingStreak += 1;
		} else {
			break;
		}
	}
	const busiestDay = daily.reduce<DailyPoint | null>(
		(best, point) => (!best || point.requests > best.requests ? point : best),
		null
	);
	return {
		hourly,
		activity,
		peakHour: peak.requests > 0 ? peak.hour : null,
		peakHourRequests: peak.requests,
		currentStreak: trailingStreak,
		longestStreak,
		activeDays: activeCounts.length,
		busiestDay:
			busiestDay && busiestDay.requests > 0 ? busiestDay.date : null,
		busiestDayRequests: busiestDay?.requests ?? 0,
	};
}

export function filterRequests(
	rows: RequestRecord[],
	filters: MetricsFilters
): RequestRecord[] {
	const provider = filters.provider?.trim();
	const model = filters.model?.trim();
	const modelContains = filters.modelContains?.trim().toLowerCase();
	return rows.filter((row) => {
		if (provider && row.provider !== provider) {
			return false;
		}
		if (model && row.model !== model) {
			return false;
		}
		if (modelContains && !row.model.toLowerCase().includes(modelContains)) {
			return false;
		}
		return true;
	});
}
