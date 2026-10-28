import type { ModelEvent } from "./types";

/** USD per million tokens. Rates are the list prices published by each
 * provider on PRICING_AS_OF, not an invoice and not a subscription quota. */
export type PriceRates = {
	input: number;
	output: number;
	cache: number;
};

export type PricingSource = {
	id: string;
	label: string;
	url: string;
};

export type PriceQuote = PriceRates & {
	source: PricingSource;
	note?: string;
	longThreshold?: number;
	peak?: PriceRates;
};

type PriceEntry = {
	rates: PriceRates;
	source: string;
	/** DeepSeek charges these rates during its weekday peak windows. */
	peak?: PriceRates;
	/** Requests above the threshold use these rates for every token. */
	long?: { threshold: number; rates: PriceRates };
	note?: string;
};

export const PRICING_AS_OF = "2026-10-29";

export const PRICING_NOTE = "按模型公开 API 标准价估算，不是实际账单。订阅内用量、网关折扣、批处理价、缓存写入和峰谷时段都可能让实际扣费不同。";

export const PRICING_SOURCES: PricingSource[] = [
	{ id: "openai", label: "OpenAI API Pricing", url: "https://developers.openai.com/api/docs/pricing" },
	{ id: "anthropic", label: "Anthropic Pricing", url: "https://platform.claude.com/docs/en/about-claude/pricing" },
	{ id: "deepseek", label: "DeepSeek Models & Pricing", url: "https://api-docs.deepseek.com/quick_start/pricing/" },
	{ id: "zai", label: "Z.ai Pricing", url: "https://docs.z.ai/guides/overview/pricing" },
	{ id: "moonshot", label: "Kimi API Pricing", url: "https://platform.kimi.ai/docs/pricing/chat" },
	{ id: "xai", label: "xAI API Pricing", url: "https://docs.x.ai/developers/pricing" },
	{ id: "qwen", label: "QwenCloud API Pricing", url: "https://www.qwencloud.com/pricing/api" },
	{ id: "google", label: "Gemini Developer API Pricing", url: "https://ai.google.dev/gemini-api/docs/pricing" },
];

const sources = Object.fromEntries(PRICING_SOURCES.map((source) => [source.id, source])) as Record<string, PricingSource>;

// A model version is priced only when its provider publishes a price for that
// exact id or an explicitly documented alias. A new variant stays unpriced
// rather than inheriting a sibling's rate by name similarity.
const catalog: Record<string, PriceEntry> = {
	"gpt-6.1-sol": {
		rates: { input: 2, output: 10, cache: 0.1 }, source: "openai",
		long: { threshold: 272_000, rates: { input: 4, output: 15, cache: 0.2 } },
	},
	"gpt-6-astra": {
		rates: { input: 10, output: 50, cache: 1 }, source: "openai",
		long: { threshold: 272_000, rates: { input: 20, output: 75, cache: 2 } },
	},
	"gpt-6-luna": {
		rates: { input: 0.1, output: 0.5, cache: 0.01 }, source: "openai",
		long: { threshold: 272_000, rates: { input: 0.2, output: 0.75, cache: 0.02 } },
	},
	"gpt-6.1-terra": {
		rates: { input: 1, output: 5, cache: 0.05 }, source: "openai",
		long: { threshold: 272_000, rates: { input: 2, output: 7.5, cache: 0.1 } },
	},
	"gpt-5.6-sol": {
		rates: { input: 4, output: 20, cache: 0.4 }, source: "openai",
		long: { threshold: 272_000, rates: { input: 8, output: 30, cache: 0.8 } },
	},
	"gpt-5.6-terra": {
		rates: { input: 2, output: 12, cache: 0.2 }, source: "openai",
		long: { threshold: 272_000, rates: { input: 4, output: 18, cache: 0.4 } },
	},
	"gpt-5.6-luna": {
		rates: { input: 0.2, output: 1.2, cache: 0.02 }, source: "openai",
		long: { threshold: 272_000, rates: { input: 0.4, output: 1.8, cache: 0.04 } },
	},
	"claude-opus-5": { rates: { input: 5, output: 25, cache: 0.5 }, source: "anthropic" },
	"claude-opus-4-8": { rates: { input: 5, output: 25, cache: 0.5 }, source: "anthropic" },
	"claude-opus-4-7": { rates: { input: 5, output: 25, cache: 0.5 }, source: "anthropic" },
	"claude-fable-5": { rates: { input: 10, output: 50, cache: 1 }, source: "anthropic" },
	"claude-fable-5.1": { rates: { input: 10, output: 50, cache: 0.25 }, source: "anthropic" },
	"claude-sonnet-5": { rates: { input: 2, output: 10, cache: 0.2 }, source: "anthropic" },
	"claude-sonnet-4-6": { rates: { input: 3, output: 15, cache: 0.3 }, source: "anthropic" },
	"claude-haiku-4-5": { rates: { input: 1, output: 5, cache: 0.1 }, source: "anthropic" },
	"claude-haiku-5.5": { rates: { input: 0.1, output: 0.5, cache: 0.01 }, source: "anthropic" },
	"deepseek-flash": {
		rates: { input: 0.15, output: 0.6, cache: 0.003 }, source: "deepseek",
		peak: { input: 0.3, output: 1.2, cache: 0.006 },
		note: "工作日 UTC 01:00–04:00、06:00–10:00 按峰时价；中国法定节假日未单独扣除。",
	},
	"deepseek-v4-pro": {
		rates: { input: 0.66, output: 1.98, cache: 0.022 }, source: "deepseek",
		peak: { input: 1.32, output: 3.96, cache: 0.044 },
		note: "工作日 UTC 01:00–04:00、06:00–10:00 按峰时价；中国法定节假日未单独扣除。",
	},
	"glm-5.3": { rates: { input: 1.4, output: 4.4, cache: 0.26 }, source: "zai" },
	"glm-5.3-flash": { rates: { input: 0.15, output: 0.5, cache: 0.03 }, source: "zai" },
	"glm-5.3-flashx": { rates: { input: 0.37, output: 1.25, cache: 0.075 }, source: "zai" },
	"glm-5.2": { rates: { input: 1.4, output: 4.4, cache: 0.26 }, source: "zai" },
	"glm-5.1": { rates: { input: 1.4, output: 4.4, cache: 0.26 }, source: "zai" },
	"glm-5": { rates: { input: 1, output: 3.2, cache: 0.2 }, source: "zai" },
	"kimi-k3": { rates: { input: 3, output: 15, cache: 0.3 }, source: "moonshot" },
	"kimi-k3.1-pro": { rates: { input: 2, output: 10, cache: 0.2 }, source: "moonshot" },
	"kimi-k3.1-pro-highspeed": { rates: { input: 4, output: 20, cache: 0.2 }, source: "moonshot" },
	"grok-4.7": {
		rates: { input: 2, output: 6, cache: 0.5 }, source: "xai",
		long: { threshold: 200_000, rates: { input: 4, output: 12, cache: 1 } },
	},
	"grok-4.6": {
		rates: { input: 2, output: 6, cache: 0.5 }, source: "xai",
		long: { threshold: 200_000, rates: { input: 4, output: 12, cache: 1 } },
	},
	"grok-4.5": {
		rates: { input: 2, output: 6, cache: 0.3 }, source: "xai",
		long: { threshold: 200_000, rates: { input: 4, output: 12, cache: 0.6 } },
	},
	"qwen3.8-flash": { rates: { input: 0.15, output: 0.47, cache: 0.016 }, source: "qwen" },
	"qwen3.8-max": { rates: { input: 2, output: 6, cache: 0.25 }, source: "qwen" },
	"gemini-3.6-flash": { rates: { input: 0.75, output: 3.75, cache: 0.075 }, source: "google" },
	// Gemini 3.5 Flash is retired and its API requests are routed to 3.6 Flash.
	"gemini-3.5-flash": { rates: { input: 0.75, output: 3.75, cache: 0.075 }, source: "google", note: "已停用并自动路由到 Gemini 3.6 Flash，按 3.6 Flash 价目计算。" },
};

// Documented aliases only. Gateway prefixes normally disappear during model
// normalization; these cover source spellings that still reach the ledger.
const aliases: Record<string, string> = {
	"deepseek-v4-flash": "deepseek-flash",
	"deepseek-v4-flash-vision-exp": "deepseek-flash",
	"deepseek-v4.1-flash": "deepseek-flash",
	"deepseek-v4.1-flash-1017": "deepseek-flash",
	"deepseek-v4.1-flash-expires-on-0910": "deepseek-flash",
	"opencode-go-messages/qwen3.8-max": "qwen3.8-max",
	"opencode-go-responses/grok-4.6": "grok-4.6",
};

function resolve(model: string) {
	const key = model.trim().toLowerCase();
	const name = aliases[key] ?? key;
	return catalog[name] ? { name, entry: catalog[name] } : null;
}

/** DeepSeek peak windows: weekdays 01:00–04:00 and 06:00–10:00 UTC. */
function isDeepSeekPeak(at: number) {
	const day = new Date(at).getUTCDay();
	if (day === 0 || day === 6) return false;
	const hour = new Date(at).getUTCHours();
	return (hour >= 1 && hour < 4) || (hour >= 6 && hour < 10);
}

function ratesFor(entry: PriceEntry, at: number | null, input: number) {
	if (entry.long && input > entry.long.threshold) return entry.long.rates;
	if (entry.peak && at !== null && isDeepSeekPeak(at)) return entry.peak;
	return entry.rates;
}

/** The quote shown for a model outside a specific request. Peak pricing is
 * applied by eventCost because it depends on each request's timestamp. */
export function pricingFor(model: string): PriceQuote | null {
	const resolved = resolve(model);
	if (!resolved) return null;
	const { entry } = resolved;
	return {
		...entry.rates,
		source: sources[entry.source],
		...(entry.note ? { note: entry.note } : {}),
		...(entry.long ? { longThreshold: entry.long.threshold } : {}),
		...(entry.peak ? { peak: entry.peak } : {}),
	};
}

const costs = new WeakMap<ModelEvent, number | null>();

/** USD for one request. All three usage fields are required: an unknown cache
 * count makes the cached/uncached split unknowable. Unpriced models stay null
 * so the UI can show coverage instead of a fabricated zero. */
export function eventCost(row: ModelEvent): number | null {
	const cached = costs.get(row);
	if (cached !== undefined) return cached;
	const value = computeCost(row);
	costs.set(row, value);
	return value;
}

function computeCost(row: ModelEvent): number | null {
	if (row.input === null || row.output === null || row.cache === null) return null;
	const resolved = resolve(row.model);
	if (!resolved) return null;
	const at = Date.parse(row.at);
	// 1970 placeholders from sources without a usable clock cannot select a peak rate.
	const timed = Number.isFinite(at) && at > 946_684_800_000 && row.timeKnown !== false;
	if (resolved.entry.peak && !timed) return null;
	const rates = ratesFor(resolved.entry, timed ? at : null, row.input);
	const cache = Math.min(row.cache, row.input);
	const uncached = row.input - cache;
	return (uncached * rates.input + cache * rates.cache + row.output * rates.output) / 1_000_000;
}

/** Short USD form for dense tables. Small amounts keep enough digits to be
 * distinguishable from zero without showing six decimals for every row. */
export function formatCost(value: number | null | undefined) {
	if (value === null || value === undefined || !Number.isFinite(value)) return "—";
	if (value === 0) return "$0.00";
	const absolute = Math.abs(value);
	const digits = absolute >= 1 ? 2 : absolute >= 0.01 ? 4 : 6;
	return `$${value.toFixed(digits)}`;
}

/** Per-million-token rate, e.g. $0.003. */
export function formatRate(value: number) {
	return `$${value.toFixed(value >= 1 ? 2 : value >= 0.01 ? 3 : 4)}`;
}
