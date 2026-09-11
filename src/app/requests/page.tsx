import { Suspense } from "react";
import { AppShell } from "@/components/app-shell";
import { AutoRefresh } from "@/components/auto-refresh";
import { Badge } from "@/components/ui/badge";
import {
	Card,
	CardAction,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@/components/ui/empty";
import { ModelSwitcher } from "@/components/model-switcher";
import { RequestsTable } from "@/components/requests-table";
import { SourceSwitcher } from "@/components/metrics/source-switcher";
import { formatCompactNumber, formatInteger } from "@/components/formater";
import { formatShortDateTime } from "@/lib/metrics/time";
import {
	getMetricsSnapshot,
	parseMetricSource,
	resolveActiveSource,
} from "@/lib/metrics/source";
import type { MetricSourceId } from "@/lib/metrics/types";
import { ActivityIcon } from "lucide-react";

export const dynamic = "force-dynamic";

type RequestsPageProps = {
	searchParams: Promise<{
		provider?: string;
		model?: string;
		source?: string;
	}>;
};

export default async function RequestsPage({ searchParams }: RequestsPageProps) {
	const params = await searchParams;
	const provider =
		typeof params.provider === "string" ? params.provider.trim() : "";
	const model = typeof params.model === "string" ? params.model.trim() : "";
	const source: MetricSourceId =
		parseMetricSource(params.source) ?? (await resolveActiveSource());
	const snapshot = await getMetricsSnapshot(source, {
		windowDays: 7,
		filters: {
			provider: provider || null,
			model: model || null,
		},
		recentCount: 400,
	});
	const { totals, recent, allModels } = snapshot;
	const sourceLabel = snapshot.sourceLabel;
	const sourceDescription =
		source === "all"
			? "Every request from every reader, counted once."
			: source === "router"
				? "Live log from Codex Router API (127.0.0.1:4202)."
				: source === "harness"
					? "Live log from the DeepSeek Harness session logs."
					: "Live log from the native DeepSeek API.";
	// The harness meters the native DeepSeek upstream in CNY; Command Code turns
	// there are billed as credits, so only the priced part is shown.
	// "all" reports no cost on purpose: DeepSeek's CNY list prices only DeepSeek
	// models, CC Switch's USD is near zero, and the router logs none at all, so a
	// combined figure would not mean anything.
	const costSummary =
		source === "all"
			? ""
			: source === "harness"
				? totals.totalCostCny
					? ` · ¥${totals.totalCostCny.toFixed(2)} est.`
					: ""
				: totals.totalCostUsd
					? ` · $${totals.totalCostUsd.toFixed(2)}`
					: "";

	// A silent source looks like a broken page, so say when its newest entry is
	// old rather than letting the table quietly end hours in the past.
	const newest = recent[0]?.at ? Date.parse(recent[0].at) : Number.NaN;
	const staleMinutes = Number.isFinite(newest)
		? Math.round((Date.parse(snapshot.generatedAt) - newest) / 60_000)
		: null;
	const staleNote =
		staleMinutes !== null && staleMinutes >= 60
			? `Newest entry in this log is ${staleMinutes < 120 ? `${staleMinutes} min` : `${Math.round(staleMinutes / 60)} h`} old (${formatShortDateTime(recent[0].at)}). Nothing has been recorded since then.`
			: null;
	return (
		<AppShell>
			<div className="flex flex-col gap-4">
				<header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
					{/* min-w-0 lets the prose give up width before the controls give up a row. */}
					<div className="flex min-w-0 flex-col gap-1">
						<h1 className="font-heading text-xl font-semibold tracking-tight">
							Requests
						</h1>
						<p className="text-sm text-muted-foreground">
							{sourceDescription}
						</p>
					</div>
					<div className="flex flex-wrap items-center gap-2">
						<Suspense fallback={null}>
							<SourceSwitcher active={source} />
						</Suspense>
						<AutoRefresh />
					</div>
				</header>

				{staleNote ? (
					<p className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
						{staleNote}
					</p>
				) : null}
				<Card>
					<CardHeader>
						<CardTitle>Filter requests</CardTitle>
						<CardDescription>
							Choose an API and model to narrow the log below.
						</CardDescription>
					</CardHeader>
					<CardContent>
						<Suspense fallback={null}>
							<ModelSwitcher routes={allModels} />
						</Suspense>
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>Request log</CardTitle>
						<CardDescription>
							Latest {formatInteger(recent.length)} matching requests ·{" "}
							{formatCompactNumber(totals.totalTokens)} tokens ·{" "}
							{totals.successRate.toFixed(1)}% success
							{costSummary}
						</CardDescription>
						<CardAction>
							<Badge variant="secondary" className="tabular-nums">
								{sourceLabel} · {formatInteger(totals.requests)} total
							</Badge>
						</CardAction>
					</CardHeader>
					<CardContent className="px-0">
						{recent.length > 0 ? (
							<RequestsTable
								key={`${provider || "*"}:${model || "*"}`}
								rows={recent}
							/>
						) : (
							<Empty className="min-h-48 px-6">
								<EmptyMedia variant="icon">
									<ActivityIcon />
								</EmptyMedia>
								<EmptyHeader>
									<EmptyTitle>No matching requests</EmptyTitle>
									<EmptyContent>
										<EmptyDescription>
											No calls were recorded for this API/model combination.
											Reset the filters or pick another route.
										</EmptyDescription>
									</EmptyContent>
								</EmptyHeader>
							</Empty>
						)}
					</CardContent>
				</Card>
			</div>
		</AppShell>
	);
}
