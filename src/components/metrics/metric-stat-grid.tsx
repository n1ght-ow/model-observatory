"use client";

import { useId } from "react";
import { Area, AreaChart, ResponsiveContainer } from "recharts";
import {
	CardContent,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Delta, DeltaIcon, DeltaValue } from "@/components/delta";
import { DashboardCard } from "@/components/dashboard-card";
import type { MetricsSnapshot } from "@/lib/metrics/types";
import { formatCompactNumber, formatInteger } from "@/components/formater";

type Stat = {
	label: string;
	value: string;
	delta: number;
	footer: string;
	spark: number[];
};

function buildStats(snapshot: MetricsSnapshot): Stat[] {
	const { window: windowStats, totals, daily } = snapshot;
	const periodLabel = windowStats.allTime
		? "all time"
		: windowStats.days === 1
			? "last 24 hours"
			: `last ${windowStats.days} days`;
	return [
		{
			label: "Requests",
			value: formatInteger(windowStats.requests),
			delta: windowStats.deltaRequestsPct,
			footer: periodLabel,
			spark: daily.map((point) => point.requests),
		},
		{
			label: "Tokens",
			value: formatCompactNumber(windowStats.totalTokens),
			delta: windowStats.deltaTokensPct,
			footer: periodLabel,
			spark: daily.map((point) => point.tokens),
		},
		{
			label: "Success rate",
			value: `${windowStats.successRate.toFixed(1)}%`,
			delta: windowStats.deltaSuccessRatePp,
			footer: `${formatInteger(totals.failed)} failed all-time`,
			spark: daily.map((point) =>
				point.requests === 0
					? 0
					: (point.success / point.requests) * 100
			),
		},
		{
			label: "Avg latency",
			value:
				windowStats.avgDurationMs > 0
					? `${formatInteger(windowStats.avgDurationMs)} ms`
					: "—",
			delta: windowStats.deltaLatencyPct,
			footer:
				windowStats.avgFirstTokenMs > 0
					? `first token ${formatInteger(windowStats.avgFirstTokenMs)} ms`
					: "latency not available in session log",
			spark: daily.map((point) => point.avgDurationMs),
		},
	];
}

function Sparkline({ values, negative }: { values: number[]; negative: boolean }) {
	const gradientId = `spark-${useId().replace(/:/g, "")}`;
	const data = values.map((value) => ({ value }));
	const color = negative ? "var(--color-chart-3)" : "var(--color-chart-2)";

	return (
		<ResponsiveContainer height={36} width="100%">
			<AreaChart data={data} margin={{ bottom: 0, left: 0, right: 0, top: 2 }}>
				<defs>
					<linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
						<stop offset="0%" stopColor={color} stopOpacity={0.35} />
						<stop offset="100%" stopColor={color} stopOpacity={0} />
					</linearGradient>
				</defs>
				<Area
					dataKey="value"
					fill={`url(#${gradientId})`}
					isAnimationActive={false}
					stroke={color}
					strokeWidth={1.75}
					type="monotone"
				/>
			</AreaChart>
		</ResponsiveContainer>
	);
}

export function MetricStatGrid({ snapshot }: { snapshot: MetricsSnapshot }) {
	return (
		<>
			{buildStats(snapshot).map((s) => (
				<DashboardCard className="gap-0" key={s.label}>
					<CardHeader className="flex flex-row items-center justify-between">
						<CardTitle className="font-normal text-xs tracking-wide">
							{s.label}
						</CardTitle>
					</CardHeader>
					<CardContent className="flex flex-row items-center gap-2">
						<p className="font-semibold text-2xl tabular-nums">{s.value}</p>
					</CardContent>
					{s.spark.length > 1 ? (
						<div className="px-4 pt-1">
							<Sparkline negative={s.delta < 0} values={s.spark} />
						</div>
					) : null}
					<CardFooter className="gap-1 rounded-none bg-background text-xs">
						<Delta value={s.delta}>
							<DeltaIcon />
							<DeltaValue />
						</Delta>
						<span className="text-muted-foreground">{s.footer}</span>{" "}
					</CardFooter>
				</DashboardCard>
			))}
		</>
	);
}
