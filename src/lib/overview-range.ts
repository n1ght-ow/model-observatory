export const OVERVIEW_RANGE_VALUES = ["all", "30", "7", "1"] as const;

export type OverviewRange = (typeof OVERVIEW_RANGE_VALUES)[number];

export const DEFAULT_OVERVIEW_RANGE: OverviewRange = "7";

export function isOverviewRange(value: unknown): value is OverviewRange {
	return OVERVIEW_RANGE_VALUES.includes(value as OverviewRange);
}

export function overviewRangeToDays(range: OverviewRange): number {
	return range === "all" ? 0 : Number(range);
}
