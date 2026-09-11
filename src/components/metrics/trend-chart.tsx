"use client";

import {
	Bar,
	CartesianGrid,
	ComposedChart,
	Line,
	XAxis,
	YAxis,
} from "recharts";
import {
	type ChartConfig,
	ChartContainer,
	ChartLegend,
	ChartLegendContent,
	ChartTooltip,
	ChartTooltipContent,
} from "@/components/ui/chart";
import {
	formatChartAxisTick,
	formatCompactNumber,
} from "@/components/formater";
import type { DailyPoint } from "@/lib/metrics/types";

const chartConfig = {
	requests: {
		label: "Requests",
		color: "var(--chart-2)",
	},
	tokens: {
		label: "Tokens",
		color: "var(--chart-1)",
	},
	success: {
		label: "Successful",
		color: "var(--chart-3)",
	},
} satisfies ChartConfig;

export type TrendChartMode = "requests" | "tokens" | "combined";

export function TrendChart({
	daily,
	days,
	mode,
}: {
	daily: DailyPoint[];
	days: number;
	mode: TrendChartMode;
}) {
	const showEveryTick = days <= 7;
	const showRequests = mode === "requests" || mode === "combined";
	const showTokens = mode === "tokens" || mode === "combined";
	const showSuccess = mode === "tokens";

	return (
		<ChartContainer
			className="aspect-auto h-60 w-full md:h-72"
			config={chartConfig}
		>
			<ComposedChart accessibilityLayer data={daily}>
				<CartesianGrid className="stroke-border" vertical={false} />
				<XAxis
					axisLine={false}
					dataKey="date"
					interval={showEveryTick ? 0 : "preserveStartEnd"}
					minTickGap={showEveryTick ? 0 : 48}
					tickFormatter={(value) => formatChartAxisTick(String(value), days)}
					tickLine={false}
					tickMargin={10}
				/>
				<YAxis hide orientation="left" yAxisId="requests" />
				<YAxis hide orientation="right" yAxisId="tokens" />
				<YAxis hide orientation="right" yAxisId="success" />
				<ChartTooltip
					content={
						<ChartTooltipContent
							formatter={(value, name) => {
								const label = String(name).toLowerCase();
								return label.includes("request")
									? `${Number(value).toLocaleString()} req`
									: formatCompactNumber(Number(value));
							}}
						/>
					}
					cursor={false}
				/>
				<ChartLegend content={<ChartLegendContent />} />
				{showRequests ? (
					<Bar
						dataKey="requests"
						fill="var(--color-requests)"
						radius={[3, 3, 0, 0]}
						yAxisId="requests"
					/>
				) : null}
				{showTokens ? (
					<Line
						dataKey="tokens"
						dot={false}
						stroke="var(--color-tokens)"
						strokeWidth={2}
						type="monotone"
						yAxisId="tokens"
					/>
				) : null}
				{showSuccess ? (
					<Line
						dataKey="success"
						dot={false}
						stroke="var(--color-success)"
						strokeWidth={2}
						type="monotone"
						yAxisId="success"
					/>
				) : null}
			</ComposedChart>
		</ChartContainer>
	);
}
