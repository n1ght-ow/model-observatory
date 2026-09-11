import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
	CardContent,
	CardFooter,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { DashboardCard } from "@/components/dashboard-card";
import {
	CircleCheckIcon,
	CircleAlertIcon,
	RefreshCwIcon,
} from "lucide-react";
import { formatInteger } from "@/components/formater";
import type { MetricSourceId, MetricsSnapshot } from "@/lib/metrics/types";

export function SourceStatusCard({
	snapshot,
	source,
}: {
	snapshot: MetricsSnapshot;
	source: MetricSourceId;
}) {
	const health = snapshot.health;
	const isAll = source === "all";
	const isRouter = source === "router";
	const isHarness = source === "harness";
	const online = health?.ok === true;
	const statusLabel = isAll
		? snapshot.status === "live"
			? "reading every source"
			: "no traffic"
		: isRouter
			? online
				? "online"
				: "unreachable"
			: isHarness
				? snapshot.status === "live"
					? "reading logs"
					: "no traffic"
				: "session sync";
	const statusVariant =
		isRouter && !online
			? "destructive"
			: isHarness && snapshot.status !== "live"
				? "outline"
				: "secondary";
	const title = isAll
		? "Coverage"
		: isRouter
			? "Router health"
			: isHarness
				? "DeepSeek Harness"
				: "DeepSeek API";
	const description = isAll
		? (snapshot.allScope?.detail ??
			"Every request any reader can see, counted once.")
		: isRouter
			? health?.ok
				? health.detail
				: "Codex Router is not responding on 127.0.0.1:4202."
			: isHarness
				? "Turns the harness sent upstream, aggregated from its own session logs."
				: "Native DeepSeek API requests, synced from the active Codex profile.";
	const jsonHref = `/api/metrics?source=${source}`;
	const topProviders = snapshot.windowProviders.slice(0, 5);
	return (
		<DashboardCard className="gap-0 md:col-span-2">
			<CardHeader className="border-b">
				<div className="flex flex-wrap items-center gap-2">
					<CardTitle className="text-balance text-base">
						{title}
					</CardTitle>
					<Badge variant={statusVariant}>
						{isRouter && !online ? (
							<CircleAlertIcon data-icon="inline-start" />
						) : (
							<CircleCheckIcon data-icon="inline-start" />
						)}
						{statusLabel}
					</Badge>
				</div>
				<CardDescription className="text-pretty">
					{description}
				</CardDescription>
			</CardHeader>
			<CardContent className="flex flex-col gap-3 px-6 py-4">
				{topProviders.map((provider) => (
					<div className="flex items-center justify-between gap-3" key={provider.provider}>
						<div className="min-w-0">
							<p className="truncate text-sm font-medium">{provider.provider}</p>
							<p className="text-muted-foreground text-xs tabular-nums">
								{formatInteger(provider.requests)} requests ·{" "}
								{provider.errorRate.toFixed(1)}% failed
							</p>
						</div>
						<Badge variant="outline" className="tabular-nums">
							{provider.tokens >= 1_000_000
								? `${(provider.tokens / 1_000_000).toFixed(1)}M`
								: `${(provider.tokens / 1000).toFixed(1)}K`}
						</Badge>
					</div>
				))}
			</CardContent>
			<CardFooter className="justify-between border-t text-xs text-muted-foreground">
				<span>
					{snapshot.totals.models} models · {snapshot.totals.providers} providers
				</span>
				<Button
					size="sm"
					variant="ghost"
					render={<a href={jsonHref} />}
					nativeButton={false}
				>
					<RefreshCwIcon data-icon="inline-start" />
					JSON
				</Button>
			</CardFooter>
		</DashboardCard>
	);
}
