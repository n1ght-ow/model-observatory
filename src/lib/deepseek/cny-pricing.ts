/**
 * DeepSeek official CNY price list.
 *
 * DeepSeek bills the Chinese platform in CNY and publishes two price tiers per
 * model: peak hours (北京时间周一至周五 09:00–12:00 与 14:00–18:00) and off-peak
 * hours, which cost exactly half. The API itself exposes no usage or cost
 * endpoint, so the dashboard estimates spend from token counts:
 *
 *   miss input  = inputTokens - cacheReadTokens
 *   cost = miss / 1M * cacheMiss + cacheRead / 1M * cacheHit + output / 1M * output
 *
 * Source: https://api-docs.deepseek.com/zh-cn/quick_start/pricing
 */

export const DEEPSEEK_PRICING_SOURCE =
	"https://api-docs.deepseek.com/zh-cn/quick_start/pricing";

/** Date the table below was copied from the pricing page. */
export const DEEPSEEK_PRICING_UPDATED = "2026-09-11";

export const DEEPSEEK_CURRENCY = "CNY";

type Rate = {
	/** CNY per 1M tokens during peak hours (Mon–Fri 09:00–12:00, 14:00–18:00 CST). */
	peak: number;
	/** CNY per 1M tokens outside peak hours — exactly half of `peak`. */
	offPeak: number;
};

export type DeepSeekPriceTier = {
	id: "flash" | "pro";
	label: string;
	/** Cached input tokens. */
	cacheHit: Rate;
	/** Uncached input tokens. */
	cacheMiss: Rate;
	output: Rate;
};

/**
 * `deepseek-flash` (DeepSeek-V4.1-Flash). The retired names
 * `deepseek-v4-flash`, `deepseek-v4-flash-vision-exp` and `deepseek-flash`
 * are still accepted and are billed at Flash prices.
 */
const FLASH: DeepSeekPriceTier = {
	id: "flash",
	label: "deepseek-flash",
	cacheHit: { offPeak: 0.02, peak: 0.04 },
	cacheMiss: { offPeak: 1, peak: 2 },
	output: { offPeak: 4, peak: 8 },
};

/** `deepseek-v4-pro` (DeepSeek-V4-Pro-0813). */
const PRO: DeepSeekPriceTier = {
	id: "pro",
	label: "deepseek-v4-pro",
	cacheHit: { offPeak: 0.15, peak: 0.3 },
	cacheMiss: { offPeak: 4.5, peak: 9 },
	output: { offPeak: 13.5, peak: 27 },
};

export function deepSeekPriceTier(model: string): DeepSeekPriceTier {
	return /pro/i.test(model) ? PRO : FLASH;
}

const BEIJING_CLOCK = new Intl.DateTimeFormat("en-US", {
	hour: "2-digit",
	hourCycle: "h23",
	timeZone: "Asia/Shanghai",
	weekday: "short",
});

/** Hour bucket → peak flag, so repeated timestamps are resolved once. */
const peakByHourBucket = new Map<number, boolean>();

/** Peak pricing applies 09:00–12:00 and 14:00–18:00, Monday to Friday (Beijing). */
export function isPeakHour(atMs: number): boolean {
	if (!Number.isFinite(atMs)) {
		return false;
	}
	const bucket = Math.floor(atMs / 3_600_000);
	const cached = peakByHourBucket.get(bucket);
	if (cached !== undefined) {
		return cached;
	}
	let peak = false;
	try {
		const parts = BEIJING_CLOCK.formatToParts(new Date(atMs));
		const weekday = parts.find((part) => part.type === "weekday")?.value ?? "";
		const hour = Number.parseInt(
			parts.find((part) => part.type === "hour")?.value ?? "0",
			10
		);
		const weekend = weekday === "Sat" || weekday === "Sun";
		peak = !weekend && ((hour >= 9 && hour < 12) || (hour >= 14 && hour < 18));
	} catch {
		peak = false;
	}
	peakByHourBucket.set(bucket, peak);
	return peak;
}

export type DeepSeekTokenUsage = {
	model: string;
	/** ISO timestamp of the request. */
	at: string;
	/** Total prompt tokens, including the cached part. */
	inputTokens: number;
	/** Portion of `inputTokens` served from the context cache. */
	cacheReadTokens: number;
	outputTokens: number;
};

/** Estimated CNY cost of one request, or 0 when it cannot be priced. */
export function estimateCnyCost(usage: DeepSeekTokenUsage): number {
	const atMs = Date.parse(usage.at);
	if (!Number.isFinite(atMs)) {
		return 0;
	}
	const tier = deepSeekPriceTier(usage.model);
	const peak = isPeakHour(atMs);
	const hit = usage.cacheReadTokens;
	const miss = Math.max(usage.inputTokens - usage.cacheReadTokens, 0);
	const pick = (rate: Rate) => (peak ? rate.peak : rate.offPeak);
	return (
		(miss / 1_000_000) * pick(tier.cacheMiss) +
		(hit / 1_000_000) * pick(tier.cacheHit) +
		(usage.outputTokens / 1_000_000) * pick(tier.output)
	);
}
