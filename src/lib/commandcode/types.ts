/**
 * Command Code (commandcode.ai) account usage types.
 *
 * The values are normalised from four `/alpha` endpoints of the public API:
 * `whoami`, `usage/summary`, `billing/credits` and `billing/subscriptions`.
 */

export type CommandCodeWindowId = "fiveHour" | "weekly" | "monthly";

/**
 * One paced spending window. `used` and `cap` are USD credits, matching the
 * upstream API which reports credits rather than request counts.
 */
export type CommandCodeWindow = {
	id: CommandCodeWindowId;
	label: string;
	/** Credits consumed inside the window. */
	used: number;
	/** Credits allowed inside the window; 0 means no limit was reported. */
	cap: number;
	remaining: number;
	/** `used / cap` as a percentage, not clamped — over 100 means exceeded. */
	usedPct: number;
	exceeded: boolean;
	/** ISO timestamp when the window rolls over, or null when unknown. */
	resetAt: string | null;
};

export type CommandCodeIdentity = {
	id: string;
	name: string;
	email: string;
	userName: string;
};

export type CommandCodeUsageSummary = {
	totalCount: number;
	totalCost: number;
	averageCost: number;
	/** Percentage in the 0–100 range. */
	successRate: number;
	completedCount: number;
	failedCount: number;
	totalTokensIn: number;
	totalTokensOut: number;
	totalTokens: number;
	totalCredits: number;
	totalFreeCredits: number;
	totalMonthlyCredits: number;
	totalPurchasedCredits: number;
	periodBasis: string;
};

export type CommandCodeCredits = {
	belowThreshold: boolean;
	creditThreshold: number;
	/** Credits still available in the current billing period. */
	monthlyCredits: number;
	purchasedCredits: number;
	freeCredits: number;
};

export type CommandCodeSubscription = {
	id: string;
	status: string;
	planId: string;
	priceId: string;
	quantity: number;
	cancelAtPeriodEnd: boolean;
	currentPeriodStart: string | null;
	currentPeriodEnd: string | null;
	createdAt: string | null;
	canceledAt: string | null;
	endedAt: string | null;
	pendingPhase: string | null;
};

export type CommandCodeEndpointFailure = {
	endpoint: string;
	error: string;
};

export type CommandCodeCredential = {
	/** Where the API key was found, e.g. `env:COMMAND_CODE_API_KEY`. */
	source: string;
	/** Masked preview of the key — never the full secret. */
	hint: string;
};

export type CommandCodeReport = {
	baseUrl: string;
	fetchedAt: string;
	latencyMs: number;
	/** False when no API key could be resolved. */
	configured: boolean;
	/** True only when every endpoint answered. */
	online: boolean;
	credential: CommandCodeCredential | null;
	error: string | null;
	failures: CommandCodeEndpointFailure[];
	account: CommandCodeIdentity | null;
	usage: CommandCodeUsageSummary | null;
	credits: CommandCodeCredits | null;
	/** Pacing flags reported by `billing/credits`. */
	limits: { limited: boolean; exceeded: boolean | null };
	/** 5-hour, weekly and monthly windows in display order. */
	windows: CommandCodeWindow[];
	subscription: CommandCodeSubscription | null;
};
