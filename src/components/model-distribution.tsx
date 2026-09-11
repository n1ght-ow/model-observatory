"use client";

import { Cell, Pie, PieChart } from "recharts";
import {
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	type ChartConfig,
	ChartContainer,
	ChartTooltip,
	ChartTooltipContent,
} from "@/components/ui/chart";
import { DashboardCard } from "@/components/dashboard-card";
import { formatCompactNumber } from "@/components/formater";
import type { MetricsSnapshot } from "@/lib/metrics/types";

const CHART_COLORS = [
	"var(--chart-1)",
	"var(--chart-2)",
	"var(--chart-3)",
	"var(--chart-4)",
	"var(--chart-5)",
];

function shortModel(model: string): string {
	const parts = model.split("/");
	return parts.length > 1 ? parts.slice(1).join("/") : model;
}

export function ModelDistribution({ snapshot }: { snapshot: MetricsSnapshot }) {
	const routes = [...snapshot.windowModels]
		.sort((a, b) => b.tokens - a.tokens)
		.slice(0, 5);
	const totalTokens = routes.reduce((sum, route) => sum + route.tokens, 0);
	const data = routes.map((route) => ({
		key: `${route.provider}::${route.model}`,
		name: shortModel(route.model),
		provider: route.provider,
		tokens: route.tokens,
	}));
	const chartConfig = data.reduce<ChartConfig>((config, item, index) => {
		config[item.key] = {
			label: `${item.name} · ${item.provider}`,
			color: CHART_COLORS[index % CHART_COLORS.length],
		};
		return config;
	}, {});

	return (
		<DashboardCard className="gap-0 md:col-span-2">
			<CardHeader className="border-b">
				<CardTitle>Model distribution</CardTitle>
				<CardDescription>
					Token share by model
					{snapshot.window.allTime
						? "."
						: snapshot.window.days === 1
							? " in the last 24 hours."
							: ` in the last ${snapshot.window.days} days.`}
				</CardDescription>
			</CardHeader>
			<CardContent className="px-6 py-4">
				{data.length > 0 && totalTokens > 0 ? (
					<div className="flex flex-col items-center gap-4 sm:flex-row">
						<ChartContainer
							className="aspect-square h-40 w-40 shrink-0"
							config={chartConfig}
						>
							<PieChart>
								<ChartTooltip
									content={
										<ChartTooltipContent
											formatter={(value) => formatCompactNumber(Number(value))}
											nameKey="key"
										/>
									}
								/>
								<Pie
									data={data}
									dataKey="tokens"
									innerRadius={44}
									isAnimationActive={false}
									nameKey="key"
									outerRadius={70}
									paddingAngle={2}
									strokeWidth={0}
								>
									{data.map((entry, index) => (
										<Cell
											fill={CHART_COLORS[index % CHART_COLORS.length]}
											key={entry.key}
										/>
									))}
								</Pie>
							</PieChart>
						</ChartContainer>
						<ul className="flex w-full min-w-0 flex-col gap-2">
							{data.map((item, index) => (
								<li
									className="flex items-center justify-between gap-3"
									key={item.key}
								>
									<span className="flex min-w-0 items-center gap-2">
										<span
											aria-hidden="true"
											className="size-2.5 shrink-0 rounded-full"
											style={{
												backgroundColor:
													CHART_COLORS[index % CHART_COLORS.length],
											}}
										/>
										<span
											className="truncate text-sm"
											title={`${item.name} · ${item.provider}`}
										>
											{item.name}
										</span>
										<span className="shrink-0 text-muted-foreground text-xs">
											{item.provider}
										</span>
									</span>
									<span className="shrink-0 text-xs text-muted-foreground tabular-nums">
										{formatCompactNumber(item.tokens)} ·{" "}
										{((item.tokens / totalTokens) * 100).toFixed(0)}%
									</span>
								</li>
							))}
						</ul>
					</div>
				) : (
					<p className="text-sm text-muted-foreground">
						No token usage recorded in this range.
					</p>
				)}
			</CardContent>
		</DashboardCard>
	);
}
