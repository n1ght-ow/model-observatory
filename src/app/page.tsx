import { Suspense } from "react";
import { AppShell } from "@/components/app-shell";
import { AutoRefresh } from "@/components/auto-refresh";
import { Dashboard } from "@/components/dashboard";
import { RangeSwitcher } from "@/components/range-switcher";
import { SourceSwitcher } from "@/components/metrics/source-switcher";
import {
	getMetricsSnapshot,
	parseMetricSource,
	resolveActiveSource,
} from "@/lib/metrics/source";
import type { MetricSourceId } from "@/lib/metrics/types";
import {
	DEFAULT_OVERVIEW_RANGE,
	isOverviewRange,
	overviewRangeToDays,
} from "@/lib/overview-range";

export const dynamic = "force-dynamic";

type HomeProps = {
	searchParams: Promise<{
		range?: string | string[];
		source?: string | string[];
	}>;
};

export default async function Home({ searchParams }: HomeProps) {
	const params = await searchParams;
	const requestedRange = Array.isArray(params.range)
		? params.range[0]
		: params.range;
	const range = isOverviewRange(requestedRange)
		? requestedRange
		: DEFAULT_OVERVIEW_RANGE;
	const days = overviewRangeToDays(range);
	const requestedSource = Array.isArray(params.source)
		? params.source[0]
		: params.source;
	const source: MetricSourceId =
		parseMetricSource(requestedSource) ?? (await resolveActiveSource());
	const snapshot = await getMetricsSnapshot(source, {
		windowDays: days,
		recentCount: 12,
	});

	return (
		<AppShell>
			<div className="flex flex-col gap-4">
				<header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
					{/* min-w-0 lets the prose give up width before the controls give up a row:
					    the switchers have to stay on one line, the description can wrap. */}
					<div className="flex min-w-0 flex-col gap-1">
						<h1 className="font-heading text-xl font-semibold tracking-tight">
							Overview
						</h1>
						<p className="text-sm text-muted-foreground">
							{source === "all"
								? "Every request from every reader, counted once."
								: source === "router"
									? "Usage, latency and tokens from Codex Router API."
									: source === "harness"
										? "Usage and tokens for turns DeepSeek Harness sent upstream."
										: "Usage, tokens and cost from the native DeepSeek API."}
						</p>
					</div>
					<div className="flex flex-wrap items-center gap-2">
						<Suspense fallback={null}>
							<SourceSwitcher active={source} />
						</Suspense>
						<Suspense fallback={null}>
							<RangeSwitcher value={range} />
						</Suspense>
						<AutoRefresh />
					</div>
				</header>
				<Dashboard snapshot={snapshot} source={source} />
			</div>
		</AppShell>
	);
}
