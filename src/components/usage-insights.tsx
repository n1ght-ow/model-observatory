import {
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { DashboardCard } from "@/components/dashboard-card";
import { formatDate, formatInteger } from "@/components/formater";
import type { MetricsSnapshot } from "@/lib/metrics/types";
import { CalendarDaysIcon, ClockIcon, FlameIcon, ZapIcon } from "lucide-react";

const LEVEL_CLASSES = [
	"bg-muted",
	"bg-chart-1/20",
	"bg-chart-1/40",
	"bg-chart-1/70",
	"bg-chart-1",
] as const;

function formatHour(hour: number): string {
	const suffix = hour < 12 ? "AM" : "PM";
	const display = hour % 12 === 0 ? 12 : hour % 12;
	return `${display} ${suffix}`;
}

export function UsageInsights({ snapshot }: { snapshot: MetricsSnapshot }) {
	const { insights } = snapshot;
	const maxHourly = Math.max(1, ...insights.hourly.map((point) => point.requests));
	const rangeLabel = snapshot.window.allTime
		? "all time"
		: snapshot.window.days === 1
			? "the last 24 hours"
			: `the last ${snapshot.window.days} days`;

	const metrics = [
		{
			label: "Peak hour",
			value:
				insights.peakHour === null ? "—" : formatHour(insights.peakHour),
			hint:
				insights.peakHour === null
					? "No requests in range"
					: `${formatInteger(insights.peakHourRequests)} requests`,
			icon: <ClockIcon />,
		},
		{
			label: "Current streak",
			value: `${formatInteger(insights.currentStreak)}d`,
			hint: `${formatInteger(insights.longestStreak)}d longest`,
			icon: <FlameIcon />,
		},
		{
			label: "Active days",
			value: formatInteger(insights.activeDays),
			hint: `of ${formatInteger(snapshot.daily.length)} in range`,
			icon: <CalendarDaysIcon />,
		},
		{
			label: "Busiest day",
			value: insights.busiestDay
				? formatDate(insights.busiestDay, "day-month")
				: "—",
			hint: `${formatInteger(insights.busiestDayRequests)} requests`,
			icon: <ZapIcon />,
		},
	];

	return (
		<DashboardCard className="gap-0 md:col-span-2 lg:col-span-4">
			<CardHeader className="border-b">
				<CardTitle>Usage insights</CardTitle>
				<CardDescription>
					When you code, over {rangeLabel}.
				</CardDescription>
			</CardHeader>
			<CardContent className="flex flex-col gap-6 px-6 py-5">
				<div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border md:grid-cols-4">
					{metrics.map((metric) => (
						<div
							className="flex flex-col gap-1.5 bg-background px-4 py-3"
							key={metric.label}
						>
							<span className="flex items-center gap-1.5 text-muted-foreground text-xs [&_svg]:size-3.5">
								{metric.icon}
								{metric.label}
							</span>
							<span className="font-semibold text-xl tabular-nums">
								{metric.value}
							</span>
							<span className="text-muted-foreground text-xs">
								{metric.hint}
							</span>
						</div>
					))}
				</div>

				<div className="flex flex-col gap-2">
					<div className="flex items-center justify-between gap-3">
						<p className="text-sm font-medium">Requests by hour</p>
						<p className="text-muted-foreground text-xs">
							Local time · peak {insights.peakHour === null ? "—" : formatHour(insights.peakHour)}
						</p>
					</div>
					<div className="flex h-24 items-end gap-1">
						{insights.hourly.map((point) => (
							<div
								className="group relative flex h-full flex-1 items-end"
								key={point.hour}
								title={`${formatHour(point.hour)} · ${formatInteger(point.requests)} requests`}
							>
								<div
									className="w-full rounded-sm bg-chart-1/70 transition-colors group-hover:bg-chart-1"
									style={{
										height: `${Math.max(3, (point.requests / maxHourly) * 100)}%`,
									}}
								/>
							</div>
						))}
					</div>
					<div className="flex justify-between text-muted-foreground text-xs tabular-nums">
						<span>12 AM</span>
						<span>6 AM</span>
						<span>12 PM</span>
						<span>6 PM</span>
						<span>11 PM</span>
					</div>
				</div>

				<div className="flex flex-col gap-2">
					<div className="flex items-center justify-between gap-3">
						<p className="text-sm font-medium">Daily activity</p>
						<div className="flex items-center gap-1.5 text-muted-foreground text-xs">
							<span>Less</span>
							{LEVEL_CLASSES.map((className, level) => (
								<span
									className={`size-2.5 rounded-sm ${className}`}
									key={level}
								/>
							))}
							<span>More</span>
						</div>
					</div>
					<div className="flex flex-wrap gap-1">
						{insights.activity.map((day) => (
							<div
								className={`size-4 rounded-sm ${LEVEL_CLASSES[day.level]}`}
								key={day.date}
								title={`${day.date} · ${formatInteger(day.requests)} requests`}
							/>
						))}
					</div>
				</div>
			</CardContent>
		</DashboardCard>
	);
}
