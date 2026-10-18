export type CustomDates = { from: string; to: string };

export const DAY = 86_400_000;
const OFFSET = 8 * 3_600_000;

export function beijingDate(now = Date.now()) {
	return new Date(now + OFFSET).toISOString().slice(0, 10);
}

function dateStart(value: string) {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN;
	const at = Date.parse(`${value}T00:00:00+08:00`);
	return Number.isFinite(at) && beijingDate(at) === value ? at : NaN;
}

export function validCustomDates(dates: CustomDates) {
	return Number.isFinite(dateStart(dates.from)) && Number.isFinite(dateStart(dates.to)) && dates.from <= dates.to;
}

export function timeBounds(range: string, now: number, dates?: CustomDates) {
	const today = dateStart(beijingDate(now));
	if (range === "today") return { since: today, until: today + DAY };
	if (range === "week") {
		const weekday = new Date(today + OFFSET).getUTCDay();
		const since = today - ((weekday + 6) % 7) * DAY;
		return { since, until: since + 7 * DAY };
	}
	if (range === "month") {
		const month = new Date(now + OFFSET);
		return { since: Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), 1) - OFFSET, until: Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 1) - OFFSET };
	}
	if (range === "custom") {
		if (!dates || !validCustomDates(dates)) throw new Error("请选择有效的起止日期");
		return { since: dateStart(dates.from), until: dateStart(dates.to) + DAY };
	}
	const duration: Record<string, number> = { "24h": DAY, "7d": 7 * DAY, "30d": 30 * DAY };
	return { since: duration[range] ? now - duration[range] : null, until: null };
}
