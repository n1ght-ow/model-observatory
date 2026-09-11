import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
	CommandCodeCredential,
	CommandCodeCredits,
	CommandCodeEndpointFailure,
	CommandCodeIdentity,
	CommandCodeReport,
	CommandCodeSubscription,
	CommandCodeUsageSummary,
	CommandCodeWindow,
} from "@/lib/commandcode/types";

export const COMMAND_CODE_API_BASE = "https://api.commandcode.ai";

const API_KEY_ENV_NAMES = ["COMMAND_CODE_API_KEY", "COMMANDCODE_API_KEY"];

const API_KEY_FILES = [
	join(homedir(), ".dsh", ".credentials.yaml"),
	join(homedir(), ".config", "commandcode", "credentials.yaml"),
	join(homedir(), ".config", "commandcode", "config.json"),
	join(homedir(), ".commandcode", "credentials.json"),
];

const ENDPOINTS = {
	account: "/alpha/whoami",
	usage: "/alpha/usage/summary",
	credits: "/alpha/billing/credits",
	subscription: "/alpha/billing/subscriptions",
} as const;

const REQUEST_TIMEOUT_MS = 12_000;
const SUCCESS_CACHE_TTL_MS = 30_000;
const FAILURE_CACHE_TTL_MS = 120_000;

type EndpointKey = keyof typeof ENDPOINTS;

type CacheEntry = {
	value: CommandCodeReport;
	expiresAt: number;
};

let reportCache: CacheEntry | null = null;

function toNumber(value: unknown): number {
	if (typeof value === "number" && Number.isFinite(value)) {
		return value;
	}
	if (typeof value === "string") {
		const parsed = Number.parseFloat(value);
		if (Number.isFinite(parsed)) {
			return parsed;
		}
	}
	return 0;
}

function toText(value: unknown, fallback = ""): string {
	return typeof value === "string" && value.length > 0 ? value : fallback;
}

/** Accepts ISO strings and epoch-millisecond numbers (the reset timestamps). */
function toIsoOrNull(value: unknown): string | null {
	if (typeof value === "number" && Number.isFinite(value) && value > 0) {
		// Upstream sends milliseconds; treat small values as seconds.
		return new Date(value < 1e12 ? value * 1000 : value).toISOString();
	}
	if (typeof value !== "string") {
		return null;
	}
	const parsed = Date.parse(value);
	return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Extracts `KEY: value` from a flat YAML file without pulling in a parser. */
function readKeyFromYaml(raw: string): string | null {
	for (const name of API_KEY_ENV_NAMES) {
		const match = raw.match(
			new RegExp(`^[ \\t-]*${name}\\s*:\\s*['"]?([^'"\\s]+)['"]?`, "m")
		);
		if (match?.[1]) {
			return match[1];
		}
	}
	return null;
}

function readKeyFromJson(raw: string): string | null {
	try {
		const parsed: unknown = JSON.parse(raw);
		if (!isRecord(parsed)) {
			return null;
		}
		const refs = isRecord(parsed.refs) ? parsed.refs : null;
		const candidates = [
			parsed.apiKey,
			parsed.api_key,
			parsed.COMMAND_CODE_API_KEY,
			parsed.COMMANDCODE_API_KEY,
			refs?.COMMAND_CODE_API_KEY,
			refs?.COMMANDCODE_API_KEY,
		];
		for (const candidate of candidates) {
			if (typeof candidate === "string" && candidate.length > 0) {
				return candidate;
			}
		}
	} catch {
		// Not JSON — the caller falls back to the next candidate file.
	}
	return null;
}

async function readApiKeyFromFiles(): Promise<{
	key: string;
	source: string;
} | null> {
	for (const file of API_KEY_FILES) {
		try {
			const raw = await readFile(file, "utf8");
			const key = file.endsWith(".json")
				? readKeyFromJson(raw)
				: readKeyFromYaml(raw);
			if (key) {
				return { key, source: file.replace(homedir(), "~") };
			}
		} catch {
			// A missing candidate file is expected; try the next one.
		}
	}
	return null;
}

async function resolveApiKey(): Promise<{
	key: string;
	source: string;
} | null> {
	for (const name of API_KEY_ENV_NAMES) {
		const value = process.env[name]?.trim();
		if (value) {
			return { key: value, source: `env:${name}` };
		}
	}
	return readApiKeyFromFiles();
}

/** ASCII-only preview so the JSON payload stays plain UTF-8. */
function maskKey(key: string): string {
	if (key.length <= 12) {
		return "...";
	}
	return `${key.slice(0, 8)}...${key.slice(-4)}`;
}

async function fetchJson(path: string, apiKey: string): Promise<unknown> {
	const response = await fetch(`${COMMAND_CODE_API_BASE}${path}`, {
		headers: {
			Accept: "application/json",
			Authorization: `Bearer ${apiKey}`,
			"User-Agent": "router-monitor-dashboard",
			"x-cli-environment": "production",
			"x-command-code-version": "1.0.0",
		},
		cache: "no-store",
		signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
	});
	if (!response.ok) {
		const detail = (await response.text().catch(() => "")).slice(0, 160);
		throw new Error(`HTTP ${response.status}${detail ? ` — ${detail}` : ""}`);
	}
	return response.json();
}

function parseIdentity(raw: unknown): CommandCodeIdentity | null {
	if (!isRecord(raw) || !isRecord(raw.user)) {
		return null;
	}
	const user = raw.user;
	return {
		id: toText(user.id, "unknown"),
		name: toText(user.name, toText(user.userName, "unknown")),
		email: toText(user.email),
		userName: toText(user.userName),
	};
}

function parseUsage(raw: unknown): CommandCodeUsageSummary | null {
	if (!isRecord(raw)) {
		return null;
	}
	return {
		totalCount: toNumber(raw.totalCount),
		totalCost: toNumber(raw.totalCost),
		averageCost: toNumber(raw.averageCost),
		successRate: toNumber(raw.successRate),
		completedCount: toNumber(raw.completedCount),
		failedCount: toNumber(raw.failedCount),
		totalTokensIn: toNumber(raw.totalTokensIn),
		totalTokensOut: toNumber(raw.totalTokensOut),
		totalTokens: toNumber(raw.totalTokens),
		totalCredits: toNumber(raw.totalCredits),
		totalFreeCredits: toNumber(raw.totalFreeCredits),
		totalMonthlyCredits: toNumber(raw.totalMonthlyCredits),
		totalPurchasedCredits: toNumber(raw.totalPurchasedCredits),
		periodBasis: toText(raw.periodBasis, "unknown"),
	};
}

function parseCredits(raw: unknown): CommandCodeCredits | null {
	if (!isRecord(raw) || !isRecord(raw.credits)) {
		return null;
	}
	const credits = raw.credits;
	return {
		belowThreshold: credits.belowThreshold === true,
		creditThreshold: toNumber(credits.creditThreshold),
		monthlyCredits: toNumber(credits.monthlyCredits),
		purchasedCredits: toNumber(credits.purchasedCredits),
		freeCredits: toNumber(credits.freeCredits),
	};
}

function parseSubscription(raw: unknown): CommandCodeSubscription | null {
	if (!isRecord(raw) || !isRecord(raw.data)) {
		return null;
	}
	const data = raw.data;
	return {
		id: toText(data.id),
		status: toText(data.status, "unknown"),
		planId: toText(data.planId, "unknown"),
		priceId: toText(data.priceId),
		quantity: toNumber(data.quantity) || 1,
		cancelAtPeriodEnd: data.cancelAtPeriodEnd === true,
		currentPeriodStart: toIsoOrNull(data.currentPeriodStart),
		currentPeriodEnd: toIsoOrNull(data.currentPeriodEnd),
		createdAt: toIsoOrNull(data.createdAt),
		canceledAt: toIsoOrNull(data.canceledAt),
		endedAt: toIsoOrNull(data.endedAt),
		pendingPhase:
			typeof data.pendingPhase === "string" ? data.pendingPhase : null,
	};
}

function parseWindow(
	id: CommandCodeWindow["id"],
	label: string,
	raw: unknown,
	resetAt: string | null
): CommandCodeWindow | null {
	if (!isRecord(raw)) {
		return null;
	}
	const used = toNumber(raw.used);
	const cap = toNumber(raw.cap);
	const remaining = Math.max(cap - used, 0);
	return {
		id,
		label,
		used,
		cap,
		remaining,
		usedPct: cap > 0 ? (used / cap) * 100 : 0,
		exceeded: raw.exceeded === true || (cap > 0 && used >= cap),
		resetAt,
	};
}

/**
 * Builds the display windows. The upstream API only paces the 5-hour and
 * weekly windows; the monthly one is derived from the billing cycle, where the
 * period cap is the credits already spent plus the credits still available.
 */
function buildWindows(
	usage: CommandCodeUsageSummary | null,
	credits: CommandCodeCredits | null,
	rawLimits: Record<string, unknown> | null,
	subscription: CommandCodeSubscription | null
): CommandCodeWindow[] {
	const windows: CommandCodeWindow[] = [];
	const rawFiveHour = rawLimits?.fiveHour ?? null;
	const rawWeekly = rawLimits?.weekly ?? null;
	const fiveHour = parseWindow(
		"fiveHour",
		"5-hour window",
		rawFiveHour,
		toIsoOrNull(isRecord(rawFiveHour) ? rawFiveHour.resetAt : null)
	);
	if (fiveHour) {
		windows.push(fiveHour);
	}
	const weekly = parseWindow(
		"weekly",
		"Weekly limit",
		rawWeekly,
		toIsoOrNull(isRecord(rawWeekly) ? rawWeekly.resetAt : null)
	);
	if (weekly) {
		windows.push(weekly);
	}
	if (usage && credits) {
		const used = usage.totalMonthlyCredits;
		const cap = used + credits.monthlyCredits;
		windows.push({
			id: "monthly",
			label: "Monthly limit",
			used,
			cap,
			remaining: Math.max(cap - used, 0),
			usedPct: cap > 0 ? (used / cap) * 100 : 0,
			exceeded: cap > 0 && used >= cap,
			resetAt: subscription?.currentPeriodEnd ?? null,
		});
	}
	return windows;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

async function fetchReport(): Promise<CommandCodeReport> {
	const startedAt = Date.now();
	const fetchedAt = new Date().toISOString();
	const credential = await resolveApiKey();
	const base: CommandCodeReport = {
		baseUrl: COMMAND_CODE_API_BASE,
		fetchedAt,
		latencyMs: 0,
		configured: credential !== null,
		online: false,
		credential: credential
			? ({ source: credential.source, hint: maskKey(credential.key) } satisfies CommandCodeCredential)
			: null,
		error: null,
		failures: [],
		account: null,
		usage: null,
		credits: null,
		limits: { limited: false, exceeded: null },
		windows: [],
		subscription: null,
	};

	if (!credential) {
		return {
			...base,
			error:
				"No Command Code API key found. Set COMMAND_CODE_API_KEY, or add it to ~/.dsh/.credentials.yaml.",
		};
	}

	const failures: CommandCodeEndpointFailure[] = [];
	const payloads: Partial<Record<EndpointKey, unknown>> = {};
	const keys = Object.keys(ENDPOINTS) as EndpointKey[];
	const results = await Promise.all(
		keys.map(async (key) => {
			try {
				return { key, value: await fetchJson(ENDPOINTS[key], credential.key) };
			} catch (error) {
				return { key, error: errorMessage(error) };
			}
		})
	);
	for (const result of results) {
		if ("error" in result && result.error) {
			failures.push({ endpoint: ENDPOINTS[result.key], error: result.error });
			continue;
		}
		payloads[result.key] = result.value;
	}

	const usage = parseUsage(payloads.usage);
	const credits = parseCredits(payloads.credits);
	const subscription = parseSubscription(payloads.subscription);
	const rawLimits = isRecord(payloads.credits) && isRecord(payloads.credits.windowLimits)
		? payloads.credits.windowLimits
		: null;
	const account = parseIdentity(payloads.account);
	const online = failures.length === 0;

	return {
		...base,
		latencyMs: Date.now() - startedAt,
		online,
		account,
		usage,
		credits,
		subscription,
		limits: {
			limited: rawLimits?.limited === true,
			exceeded:
				typeof rawLimits?.exceeded === "boolean" ? rawLimits.exceeded : null,
		},
		windows: buildWindows(usage, credits, rawLimits, subscription),
		failures,
		error: online
			? null
			: `${failures.length} Command Code endpoint${failures.length === 1 ? "" : "s"} failed.`,
	};
}

export type CommandCodeReportOptions = {
	/** Bypass the in-process cache (used by the API route's `?fresh=1`). */
	force?: boolean;
};

export async function getCommandCodeReport(
	options: CommandCodeReportOptions = {}
): Promise<CommandCodeReport> {
	const now = Date.now();
	if (!options.force && reportCache && reportCache.expiresAt > now) {
		return reportCache.value;
	}
	const value = await fetchReport();
	reportCache = {
		value,
		expiresAt:
			Date.now() +
			(value.online ? SUCCESS_CACHE_TTL_MS : FAILURE_CACHE_TTL_MS),
	};
	return value;
}
