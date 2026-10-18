export type Evidence = {
	id: string;
	source: string;
	kind: "session" | "router" | "event";
};

export type ModelEvent = {
	id: string;
	at: string;
	model: string;
	rawModel: string;
	client: string;
	upstream: string;
	input: number | null;
	output: number | null;
	cache: number | null;
	status: "ok" | "error" | "unknown";
	duration: number | null;
	identity: "reported" | "configured";
	evidence: Evidence[];
	requestId?: string;
	timeKnown?: boolean;
	scope?: "turn";
};

export type Coverage = {
	id: string;
	name: string;
	state: "connected" | "empty" | "error" | "unsupported";
	count: number;
	latest: string | null;
	description: string;
};

export type ModelSummary = {
	model: string;
	requests: number;
	input: number;
	output: number;
	cache: number;
	inputRequests: number;
	outputRequests: number;
	cacheRequests: number;
	tokenRequests: number;
	errors: number;
	clients: { name: string; requests: number }[];
	upstreams: string[];
	aliases: string[];
	latest: string;
	configured: number;
	turnRequests: number;
};

export type ObservatorySnapshot = {
	collection?: { paused: boolean; collectedAt: string | null; observations: number; collecting?: boolean; error?: string | null };
	generatedAt: string;
	range: string;
	since: string | null;
	until: string | null;
	totals: { requests: number; turnRequests: number; input: number; output: number; cache: number; inputRequests: number; outputRequests: number; cacheRequests: number; models: number; clients: number; errors: number; tokenRequests: number };
	models: ModelSummary[];
	activity: { at: string; requests: number; tokens: number }[];
	requests: ModelEvent[];
	requestCount: number;
	coverage: Coverage[];
	reconciliation: { observations: number; merged: number; pending: number; excluded: number };
	pending: ModelEvent[];
	aliases: Record<string, string>;
};
