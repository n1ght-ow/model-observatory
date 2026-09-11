import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { DashboardCard } from "@/components/dashboard-card";
import { formatFullCurrency } from "@/components/formater";
import { formatDateTime, formatShortDateTime } from "@/lib/metrics/time";
import type {
	CommandCodeReport,
	CommandCodeWindow,
} from "@/lib/commandcode/types";
import { RefreshCwIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** Progress tones: green under 60%, amber from 60%, red from 85%. */
function limitTone(usedPct: number): { bar: string; text: string } {
	if (usedPct >= 85) {
		return { bar: "bg-red-500", text: "text-red-600 dark:text-red-400" };
	}
	if (usedPct >= 60) {
		return { bar: "bg-amber-500", text: "text-amber-600 dark:text-amber-400" };
	}
	return {
		bar: "bg-emerald-500",
		text: "text-emerald-600 dark:text-emerald-400",
	};
}

/** `resets in 2h 15m · Sep 12, 04:00` — relative for near windows. */
export function formatResetLabel(
	resetAt: string | null,
	now = Date.now()
): string {
	if (!resetAt) {
		return "no reset scheduled";
	}
	const time = Date.parse(resetAt);
	if (!Number.isFinite(time)) {
		return "reset time unknown";
	}
	if (time <= now) {
		return "rolling over now";
	}
	const minutes = Math.round((time - now) / 60_000);
	const relative =
		minutes < 60
			? `${minutes}m`
			: minutes < 60 * 48
				? `${Math.floor(minutes / 60)}h ${minutes % 60}m`
				: `${Math.round(minutes / 1440)}d`;
	return `resets in ${relative} · ${formatShortDateTime(resetAt)}`;
}

/** One paced window: label, credits used against the cap, and its reset time. */
export function LimitProgress({
	window: windowLimit,
	now,
}: {
	window: CommandCodeWindow;
	now?: number;
}) {
	const tone = limitTone(windowLimit.usedPct);
	const unlimited = windowLimit.cap <= 0;
	const percent = Math.min(Math.max(windowLimit.usedPct, 0), 100);
	return (
		<div className="flex flex-col gap-2">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<div className="flex min-w-0 items-center gap-2">
					<span className="truncate text-sm font-medium">
						{windowLimit.label}
					</span>
					{windowLimit.exceeded ? (
						<Badge variant="destructive">exceeded</Badge>
					) : (
						<Badge
							className={cn("tabular-nums", tone.text)}
							variant="outline"
						>
							{unlimited ? "no cap" : `${windowLimit.usedPct.toFixed(1)}%`}
						</Badge>
					)}
				</div>
				<span className="text-xs text-muted-foreground tabular-nums">
					{formatFullCurrency(windowLimit.used)}
					{unlimited ? "" : ` / ${formatFullCurrency(windowLimit.cap)}`} credits
				</span>
			</div>
			<div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
				<div
					className={cn("h-full rounded-full", tone.bar)}
					style={{ width: `${percent}%` }}
				/>
			</div>
			<div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
				<span className="tabular-nums">
					{unlimited
						? "unlimited credits"
						: `${formatFullCurrency(windowLimit.remaining)} credits left`}
				</span>
				<span className="tabular-nums">
					{formatResetLabel(windowLimit.resetAt, now)}
				</span>
			</div>
		</div>
	);
}

/**
 * Compact paced-limits card for the overview and DeepSeek pages. Renders
 * nothing when no Command Code credential is configured, so unrelated pages
 * stay unchanged for users without an account.
 */
export function CommandCodeLimitsCard({
	report,
	className,
	now,
	hideWhenUnconfigured = true,
}: {
	report?: CommandCodeReport | null;
	className?: string;
	now?: number;
	hideWhenUnconfigured?: boolean;
}) {
	if (!report || (!report.configured && hideWhenUnconfigured)) {
		return null;
	}

	const { usage, limits } = report;
	return (
		<DashboardCard className={cn("gap-0 md:col-span-2", className)}>
			<CardHeader className="border-b">
				<div className="flex flex-wrap items-center gap-2">
					<CardTitle className="text-base">Command Code limits</CardTitle>
					{report.online ? (
						<Badge variant="secondary">live</Badge>
					) : (
						<Badge variant="destructive">unreachable</Badge>
					)}
					{limits.limited === false ? (
						<Badge variant="outline">unlimited</Badge>
					) : null}
				</div>
				<CardDescription>
					Rolling 5-hour, weekly and monthly credit windows from
					api.commandcode.ai.
				</CardDescription>
			</CardHeader>
			<CardContent className="flex flex-col gap-4 px-6 py-4">
				{report.windows.length > 0 ? (
					report.windows.map((windowLimit) => (
						<LimitProgress
							key={windowLimit.id}
							now={now}
							window={windowLimit}
						/>
					))
				) : (
					<p className="text-sm text-muted-foreground">
						{report.error ??
							"No Command Code windows were reported by the billing API."}
					</p>
				)}
				{usage ? (
					<p className="text-xs text-muted-foreground tabular-nums">
						{usage.totalCount.toLocaleString("en-US")} requests ·{" "}
						{usage.successRate.toFixed(1)}% success ·{" "}
						{formatFullCurrency(usage.totalCost)} spent all-time
					</p>
				) : null}
			</CardContent>
			<CardFooter className="justify-between text-xs text-muted-foreground">
				<span className="tabular-nums">
					Checked {formatDateTime(report.fetchedAt)}
					{report.latencyMs > 0 ? ` · ${report.latencyMs} ms` : ""}
				</span>
				<Button
					nativeButton={false}
					render={<a href="/api/command-code" />}
					size="sm"
					variant="ghost"
				>
					<RefreshCwIcon data-icon="inline-start" />
					JSON
				</Button>
			</CardFooter>
		</DashboardCard>
	);
}
