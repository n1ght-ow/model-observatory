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
import { ModelUsageTable } from "@/components/metrics/model-usage-table";
import { ModelSwitcher } from "@/components/model-switcher";
import { SourceSwitcher } from "@/components/metrics/source-switcher";
import { formatCompactNumber, formatInteger } from "@/components/formater";
import {
	getMetricsSnapshot,
	parseMetricSource,
	resolveActiveSource,
} from "@/lib/metrics/source";
import type { MetricSourceId } from "@/lib/metrics/types";
import { CpuIcon } from "lucide-react";

export const dynamic = "force-dynamic";

type ModelsPageProps = {
	searchParams: Promise<{
		provider?: string;
		model?: string;
		source?: string;
	}>;
};

export default async function ModelsPage({ searchParams }: ModelsPageProps) {
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
		recentCount: 12,
	});
	const { totals, models, allModels } = snapshot;
	const sortedModels = [...models].sort(
		(a, b) =>
			b.tokens - a.tokens ||
			b.requests - a.requests ||
			a.model.localeCompare(b.model)
	);

	return (
		<AppShell>
			<div className="flex flex-col gap-4">
				<header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
					<div className="flex flex-col gap-1">
						<h1 className="font-heading text-xl font-semibold tracking-tight">
							Models
						</h1>
						<p className="text-sm text-muted-foreground">
							Usage per API and model. The same model can run on several APIs
							(e.g. deepseek vs opencode-go).
						</p>
					</div>
					<div className="flex flex-wrap items-center gap-2">
						<Suspense fallback={null}>
							<SourceSwitcher active={source} />
						</Suspense>
						<AutoRefresh />
					</div>
				</header>

				<Card>
					<CardHeader>
						<CardTitle>Switch model</CardTitle>
						<CardDescription>
							Pick an API first, then a model it serves — filters sync to the
							URL.
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
						<CardTitle>Model usage</CardTitle>
						<CardDescription>
							Sorted by token usage.{" "}
							{formatInteger(totals.requests)} requests ·{" "}
							{formatCompactNumber(totals.totalTokens)} tokens ·{" "}
							{totals.successRate.toFixed(1)}% success ·{" "}
							{formatInteger(totals.failed)} failed
						</CardDescription>
						<CardAction>
							<Badge variant="secondary" className="tabular-nums">
								{sortedModels.length} routes
							</Badge>
						</CardAction>
					</CardHeader>
					<CardContent className="px-0">
						{models.length > 0 ? (
							<ModelUsageTable models={sortedModels} showProvider />
						) : (
							<Empty className="min-h-48 px-6">
								<EmptyMedia variant="icon">
									<CpuIcon />
								</EmptyMedia>
								<EmptyHeader>
									<EmptyTitle>No matching models</EmptyTitle>
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
