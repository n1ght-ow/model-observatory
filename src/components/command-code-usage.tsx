import { Badge } from "@/components/ui/badge";
import { formatFullCurrency } from "@/components/formater";
import { formatShortDateTime } from "@/lib/metrics/time";
import type { CommandCodeWindow } from "@/lib/commandcode/types";
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
function formatResetLabel(resetAt: string | null, now = Date.now()): string {
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
