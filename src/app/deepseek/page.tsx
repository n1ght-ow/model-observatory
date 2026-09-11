import { Suspense } from "react";
import { AppShell } from "@/components/app-shell";
import { AutoRefresh } from "@/components/auto-refresh";
import { DeepSeekDashboard } from "@/components/deepseek-dashboard";
import { RangeSwitcher } from "@/components/range-switcher";
import { getMetricsSnapshot } from "@/lib/metrics/source";
import {
	DEFAULT_OVERVIEW_RANGE,
	isOverviewRange,
	overviewRangeToDays,
} from "@/lib/overview-range";

export const dynamic = "force-dynamic";

type DeepSeekPageProps = {
	searchParams: Promise<{ range?: string | string[] }>;
};

export default async function DeepSeekPage({
	searchParams,
}: DeepSeekPageProps) {
	const params = await searchParams;
	const requestedRange = Array.isArray(params.range)
		? params.range[0]
		: params.range;
	const range = isOverviewRange(requestedRange)
		? requestedRange
		: DEFAULT_OVERVIEW_RANGE;
	const snapshot = await getMetricsSnapshot("deepseek", {
		windowDays: overviewRangeToDays(range),
		recentCount: 50,
	});

	return (
		<AppShell>
			<div className="flex flex-col gap-4">
				<header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
					<div className="flex flex-col gap-1">
						<h1 className="font-heading text-xl font-semibold tracking-tight">
							DeepSeek
						</h1>
						<p className="text-sm text-muted-foreground">
							Native DeepSeek API account health, balance, and router usage.
						</p>
					</div>
					<div className="flex flex-wrap items-center gap-2">
						<Suspense fallback={null}>
							<RangeSwitcher value={range} />
						</Suspense>
						<AutoRefresh />
					</div>
				</header>
				<DeepSeekDashboard snapshot={snapshot} />
			</div>
		</AppShell>
	);
}
