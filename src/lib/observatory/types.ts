export type Evidence = {
	id: string;
	source: string;
	kind: "session" | "router" | "event";
};

export type AttributionStatus = "known" | "missing" | "unsupported" | "invalid" | "conflict";

export type AttributionReason =
	| "legacy"
	| "not-provided"
	| "source-unsupported"
	| "invalid-id"
	| "invalid-path"
	| "conflicting-values";

export type AttributionCandidate = {
	source: string;
	client?: string;
	id?: string;
	path?: string;
	label: string;
	key: string | null;
};

export type AttributionValue = {
	status: AttributionStatus;
	key: string | null;
	label: string | null;
	source: string | null;
	client?: string;
	id?: string;
	path?: string;
	reason?: AttributionReason;
	candidates: readonly AttributionCandidate[];
};

export type ModelEventAttribution = {
	project: AttributionValue;
	session: AttributionValue;
	parentSession?: AttributionValue;
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
	attribution?: ModelEventAttribution;
	/** Derived for exposed request rows only; never persisted as evidence. */
	cost?: number | null;
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
	cost: number;
	costRequests: number;
};

export type AttributionTotals = {
	requests: number;
	turnRequests: number;
	input: number;
	output: number;
	cache: number;
	inputRequests: number;
	outputRequests: number;
	cacheRequests: number;
	tokenRequests: number;
	errors: number;
	cost: number;
	costRequests: number;
};

export type AttributionModelSummary = AttributionTotals & {
	model: string;
};

export type AttributionLink = {
	key: string;
	label: string;
	source: string;
	totals: AttributionTotals;
};

export type ProjectAttributionSummary = {
	key: string;
	label: string;
	source: string;
	id?: string;
	path?: string;
	totals: AttributionTotals;
	modelCount: number;
	sessionCount: number;
	models: AttributionModelSummary[];
	sessions: AttributionLink[];
	latest: string | null;
};

export type SessionAttributionSummary = {
	key: string;
	label: string;
	source: string;
	client: string;
	id: string;
	project: AttributionValue;
	parentSession?: AttributionValue;
	totals: AttributionTotals;
	modelCount: number;
	models: AttributionModelSummary[];
	start: string | null;
	latest: string | null;
};

export type UnknownAttributionSummary = {
	key: string;
	dimension: "project" | "session";
	status: Exclude<AttributionStatus, "known">;
	reason?: AttributionReason;
	label: string;
	totals: AttributionTotals;
};

export type AttributionDimensionCoverage = {
	knownRequests: number;
	unknownRequests: number;
	knownTokenRequests: number;
	unknownTokenRequests: number;
};

export type AttributionOverview = {
	projects: ProjectAttributionSummary[];
	sessions: SessionAttributionSummary[];
	unknownProjects: UnknownAttributionSummary[];
	unknownSessions: UnknownAttributionSummary[];
	coverage: {
		projects: AttributionDimensionCoverage;
		sessions: AttributionDimensionCoverage;
	};
};

export type UnknownAttributionFilter = "project" | "session" | "both";

export type AttributionFilter = {
	project?: string;
	session?: string;
	unknown?: UnknownAttributionFilter;
};

export type AttributionSelection = {
	filters: AttributionFilter;
	totals: AttributionTotals;
	models: AttributionModelSummary[];
	projects: ProjectAttributionSummary[];
	sessions: SessionAttributionSummary[];
	unknownProjects: UnknownAttributionSummary[];
	unknownSessions: UnknownAttributionSummary[];
};

export type ActivityModel = Pick<ModelSummary, "model" | "requests" | "input" | "output" | "cache" | "inputRequests" | "outputRequests" | "cacheRequests" | "tokenRequests" | "cost" | "costRequests">;

export type ActivityPoint = {
	at: string;
	until: string;
	requests: number;
	tokens: number;
	cost: number;
	costRequests: number;
	models: ActivityModel[];
};

export type ObservatorySnapshot = {
	collection?: { paused: boolean; collectedAt: string | null; observations: number; collecting?: boolean; error?: string | null };
	generatedAt: string;
	range: string;
	since: string | null;
	until: string | null;
	totals: { requests: number; turnRequests: number; input: number; output: number; cache: number; inputRequests: number; outputRequests: number; cacheRequests: number; models: number; clients: number; errors: number; tokenRequests: number; cost: number; costRequests: number };
	models: ModelSummary[];
	activity: ActivityPoint[];
	requests: ModelEvent[];
	requestCount: number;
	coverage: Coverage[];
	reconciliation: { observations: number; merged: number; pending: number; excluded: number };
	pending: ModelEvent[];
	aliases: Record<string, string>;
	attribution: AttributionOverview;
	selection?: AttributionSelection;
	pricing: { asOf: string; note: string; sources: { id: string; label: string; url: string }[] };
};
