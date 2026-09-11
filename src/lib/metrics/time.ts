export const DASHBOARD_TIME_ZONE = "Asia/Shanghai";

export function startOfDayUtc(daysAgo: number): Date {
	const now = new Date();
	return new Date(
		Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysAgo)
	);
}

export function startOfDayUtcForTime(time: number): Date {
	const date = new Date(time);
	return new Date(
		Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
	);
}

export function toIsoDateFromSeconds(seconds: number): string {
	return new Date(seconds * 1000).toISOString().slice(0, 10);
}

export function toIsoDateFromDate(date: Date): string {
	return date.toISOString().slice(0, 10);
}

export function calendarDaysBetween(start: Date, end: Date): number {
	return Math.max(
		1,
		Math.round((start.getTime() - end.getTime()) / 86_400_000) + 1
	);
}

export function formatDateTime(iso: string): string {
	return new Intl.DateTimeFormat("zh-CN", {
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
		month: "short",
		second: "2-digit",
		timeZone: DASHBOARD_TIME_ZONE,
	}).format(new Date(iso));
}

export function formatShortDateTime(iso: string): string {
	return new Intl.DateTimeFormat("en-US", {
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
		month: "short",
		timeZone: DASHBOARD_TIME_ZONE,
	}).format(new Date(iso));
}

export function formatRelativeTime(iso: string, now = Date.now()): string {
	const diffMs = now - Date.parse(iso);
	const minutes = Math.round(diffMs / 60_000);
	if (minutes < 1) {
		return "just now";
	}
	if (minutes < 60) {
		return `${minutes} min ago`;
	}
	const hours = Math.round(minutes / 60);
	if (hours < 24) {
		return `${hours} h ago`;
	}
	return `${Math.round(hours / 24)} d ago`;
}
