import {
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DashboardCard } from "@/components/dashboard-card";
import { formatCompactNumber, formatInteger } from "@/components/formater";
import type { MetricsSnapshot } from "@/lib/metrics/types";

function shortModel(model: string): string {
	const parts = model.split("/");
	return parts.length > 1 ? parts.slice(1).join("/") : model;
}

export function TopModels({ snapshot }: { snapshot: MetricsSnapshot }) {
	const models = snapshot.windowModels.slice(0, 6);
	const maxRequests = models[0]?.requests ?? 1;

	return (
		<DashboardCard className="gap-0 md:col-span-2">
			<CardHeader className="border-b">
				<CardTitle>Top models</CardTitle>
				<CardDescription>
					{snapshot.window.allTime
						? "Busiest models by request count."
						: snapshot.window.days === 1
							? "Busiest models by request count in the last 24 hours."
							: `Busiest models by request count in the last ${snapshot.window.days} days.`}
				</CardDescription>
			</CardHeader>
			<CardContent className="flex flex-col gap-4 px-6 py-4">
				{models.map((model) => (
					<div className="flex flex-col gap-2" key={`${model.provider}-${model.model}`}>
						<div className="flex items-center justify-between gap-3">
							<span className="min-w-0 truncate text-sm font-medium">
								{shortModel(model.model)}
							</span>
							<div className="flex shrink-0 items-center gap-2">
								{model.errorRate > 0 ? (
									<Badge variant="outline" className="tabular-nums">
										{model.errorRate.toFixed(1)}% failed
									</Badge>
								) : null}
								<span className="text-muted-foreground text-xs tabular-nums">
									{formatInteger(model.requests)} req ·{" "}
									{formatCompactNumber(model.tokens)} tok
								</span>
							</div>
						</div>
						<div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
							<div
								className="h-full rounded-full bg-primary"
								style={{ width: `${(model.requests / maxRequests) * 100}%` }}
							/>
						</div>
					</div>
				))}
			</CardContent>
		</DashboardCard>
	);
}
