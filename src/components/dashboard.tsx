import { SourceStatusCard } from "@/components/metrics/source-status-card";
import { CommandCodeLimitsCard } from "@/components/command-code-usage";
import { DashboardActivity } from "@/components/dashboard-activity";
import { MetricStatGrid } from "@/components/metrics/metric-stat-grid";
import { TopModels } from "@/components/top-models";
import { ModelDistribution } from "@/components/model-distribution";
import { UsageInsights } from "@/components/usage-insights";
import { DashboardCard } from "@/components/dashboard-card";
import { RequestsTable } from "@/components/requests-table";
import { TrendChart } from "@/components/metrics/trend-chart";
import { Delta, DeltaIcon, DeltaValue } from "@/components/delta";
import {
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import type { MetricSourceId, MetricsSnapshot } from "@/lib/metrics/types";

export function Dashboard({
	snapshot,
	source,
}: {
	snapshot: MetricsSnapshot;
	source: MetricSourceId;
}) {
	return (
		<div className="grid grid-cols-1 gap-px bg-border p-px md:grid-cols-2 lg:grid-cols-4">
			<MetricStatGrid snapshot={snapshot} />
			<DashboardCard className="gap-0 md:col-span-2">
				<CardHeader className="gap-2">
					<div className="flex flex-wrap items-center gap-2">
						<CardTitle>Requests per day</CardTitle>
						<Delta value={snapshot.window.deltaRequestsPct} variant="badge">
							<DeltaIcon variant="trend" />
							<DeltaValue />
						</Delta>
					</div>
					<CardDescription>
						API calls,{" "}
						{snapshot.window.allTime
							? "all time."
							: snapshot.window.days === 1
								? "last 24 hours."
								: `last ${snapshot.window.days} days.`}
					</CardDescription>
				</CardHeader>
				<CardContent>
					<TrendChart
						daily={snapshot.daily}
						days={snapshot.window.days}
						mode="requests"
					/>
				</CardContent>
			</DashboardCard>
			<DashboardCard className="gap-0 md:col-span-2">
				<CardHeader>
					<div className="min-w-0 space-y-2">
						<div className="flex flex-wrap items-center gap-2">
							<CardTitle>Tokens and success</CardTitle>
							<Delta value={snapshot.window.deltaTokensPct} variant="badge">
								<DeltaIcon variant="trend" />
								<DeltaValue />
							</Delta>
						</div>
						<CardDescription>
							Daily tokens with successful calls,{" "}
							{snapshot.window.allTime
								? "all time."
								: snapshot.window.days === 1
									? "last 24 hours."
									: `last ${snapshot.window.days} days.`}
						</CardDescription>
					</div>
				</CardHeader>
				<CardContent>
					<TrendChart
						daily={snapshot.daily}
						days={snapshot.window.days}
						mode="tokens"
					/>
				</CardContent>
			</DashboardCard>
			<DashboardCard className="relative gap-0 md:col-span-2">
				<CardHeader className="border-b">
					<CardTitle className="text-base">Recent requests</CardTitle>
					<CardDescription>
						{source === "router"
							? "Latest calls through Codex Router API."
							: source === "harness"
								? "Latest turns DeepSeek Harness sent upstream."
								: "Latest calls through the native DeepSeek API."}
					</CardDescription>
				</CardHeader>
				<CardContent className="px-0">
					<RequestsTable compact limit={12} rows={snapshot.recent} />
				</CardContent>
			</DashboardCard>
			<CommandCodeLimitsCard report={snapshot.commandCode} />
			<ModelDistribution snapshot={snapshot} />
			<SourceStatusCard snapshot={snapshot} source={source} />
			<TopModels snapshot={snapshot} />
			<DashboardActivity snapshot={snapshot} source={source} />
			<UsageInsights snapshot={snapshot} />
		</div>
	);
}
