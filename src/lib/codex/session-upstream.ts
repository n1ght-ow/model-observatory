import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Which upstream served a Codex CLI session.
 *
 * CC Switch imports Codex session logs into `proxy_request_logs` as
 * `codex_session` rows, which loses the upstream: a row is just "a request for
 * a deepseek-* model". Two local artefacts restore that information:
 *
 * 1. Each Codex rollout file starts with a `session_meta` record naming its
 *    `model_provider`, which `~/.codex/config.toml` maps to a base URL.
 *    `deepseek` points at `https://api.deepseek.com/`; `codex-router` points at
 *    the local router, and `custom` at `api.apikey.fun`.
 * 2. For sessions that went through the router, every request is also in
 *    `~/.codex/codex-router/usage-events.jsonl` with the provider the router
 *    finally used (`deepseek` = native, `commandcode` = Command Code).
 */

export const CODEX_DIR = join(homedir(), ".codex");
const SESSIONS_DIR = join(CODEX_DIR, "sessions");
const CONFIG_PATH = join(CODEX_DIR, "config.toml");
const USAGE_EVENTS_PATH = join(CODEX_DIR, "codex-router", "usage-events.jsonl");

/** Providers whose base URL is DeepSeek's own API, resolved from config.toml. */
export type CodexUpstream =
	| "native-deepseek"
	| "command-code"
	| "router-unknown"
	| "other";

export type CodexSessionIndex = {
	/** Session id → provider name recorded by the Codex rollout header. */
	providers: Map<string, string>;
	/** Provider names whose base URL is api.deepseek.com. */
	nativeProviders: Set<string>;
	/**
	 * Provider name → hostname from ~/.codex/config.toml.
	 *
	 * Used to name the upstream of a session that is neither DeepSeek nor the router,
	 * so the table can say "api.apikey.fun" instead of a hardcoded guess. Read from the
	 * machine's own config, so it follows the user if they point the provider somewhere
	 * else.
	 */
	providerHosts: Map<string, string>;
	/** Session id → upstream classification. */
	upstreams: Map<string, CodexUpstream>;
	/** Session ids whose rows belong on the native DeepSeek page. */
	nativeSessionIds: Set<string>;
	/**
	 * Session ids Codex sent through the local router.
	 *
	 * The router's own event log already contains every one of these requests, so a
	 * view that merges the router log with CC Switch must drop them or count them
	 * twice. The native DeepSeek page deliberately does *not* use this: it wants the
	 * router-forwarded DeepSeek traffic, which the router log alone cannot name.
	 */
	routerSessionIds: Set<string>;
	/** Row-level breakdown behind the native DeepSeek page's scope banner. */
	stats: {
		sessions: number;
		/** Rows from sessions whose provider base URL is api.deepseek.com. */
		nativeDirect: number;
		/** Rows from Codex Router sessions the router sent on to DeepSeek. */
		nativeViaRouter: number;
		/** Rows the router sent on to Command Code. */
		commandCode: number;
		/** Rows served by some other host (api.apikey.fun, OpenAI, …). */
		otherUpstream: number;
		/** Rows whose Codex session could not be found or resolved at all. */
		unclassified: number;
	};
};

type RouterEvent = {
	at: string;
	model: string;
	provider: string;
	outputTokens: number;
};

let cache: { at: number; value: CodexSessionIndex } | null = null;
const INDEX_TTL_MS = 30_000;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `[model_providers.x]` blocks -> provider name and base URL. */
function parseProviderBaseUrls(toml: string): Map<string, string> {
	const urls = new Map<string, string>();
	let current: string | null = null;
	for (const line of toml.split(/\r?\n/)) {
		const header = line.match(/^\s*\[model_providers\.([^\]\s]+)\]/);
		if (header) {
			current = header[1];
			continue;
		}
		if (/^\s*\[/.test(line)) {
			current = null;
			continue;
		}
		if (!current) {
			continue;
		}
		const base = line.match(/^\s*base_url\s*=\s*"([^"]+)"/);
		if (base) {
			urls.set(current, base[1]);
		}
	}
	return urls;
}

/**
 * The root-level URLs that redirect Codex built-in providers.
 *
 * `openai` is not declared under `[model_providers]` because it is built in, so its
 * target is only written down here. The codex-router relies on exactly that: it keeps
 * the built-in `openai` provider id and points `openai_base_url` at its own loopback,
 * which is why a session can say `model_provider = "openai"` and still have gone
 * through the router.
 */
function parseRootBaseUrls(toml: string): { baseUrl: string | null; openaiBaseUrl: string | null } {
	let baseUrl: string | null = null;
	let openaiBaseUrl: string | null = null;
	let inSection = false;
	for (const line of toml.split(/\r?\n/)) {
		if (/^\s*\[/.test(line)) {
			inSection = true;
			continue;
		}
		if (inSection) {
			continue;
		}
		const openai = line.match(/^\s*openai_base_url\s*=\s*"([^"]+)"/);
		if (openai) {
			openaiBaseUrl = openai[1];
			continue;
		}
		const base = line.match(/^\s*base_url\s*=\s*"([^"]+)"/);
		if (base) {
			baseUrl = base[1];
		}
	}
	return { baseUrl, openaiBaseUrl };
}

/**
 * The base URL a provider will actually use.
 *
 * Declared providers answer for themselves. The built-in ones do not appear under
 * `[model_providers]`, so `openai` falls back to the root `openai_base_url`, then to the
 * root `base_url` — which is precisely how Codex redirects it.
 */
function effectiveBaseUrl(
	provider: string,
	declared: Map<string, string>,
	root: { baseUrl: string | null; openaiBaseUrl: string | null }
): string | null {
	const own = declared.get(provider);
	if (own) {
		return own;
	}
	if (provider === "openai") {
		return root.openaiBaseUrl ?? root.baseUrl;
	}
	return null;
}

/**
 * Whether a base URL points at the local router rather than a real upstream.
 *
 * This is how "did this session go through the router" is answered for providers that
 * are redirected to a loopback address, which the provider id alone does not tell you.
 */
function isLoopback(url: string | null): boolean {
	if (!url) {
		return false;
	}
	try {
		const host = new URL(url).hostname;
		return host === "127.0.0.1" || host === "localhost" || host === "::1" || host === "[::1]";
	} catch {
		return false;
	}
}

/** The hostname of a base URL, or null when it cannot be parsed. */
function hostOf(url: string): string | null {
	try {
		return new URL(url).hostname || null;
	} catch {
		return null;
	}
}

function isDeepSeekHost(url: string): boolean {
	try {
		return new URL(url).hostname.endsWith("deepseek.com");
	} catch {
		return false;
	}
}

function shortModel(model: string): string {
	const parts = model.split("/");
	return (parts.length > 1 ? parts[parts.length - 1] : model).toLowerCase();
}

async function readRolloutProviders(): Promise<Map<string, string>> {
	const providers = new Map<string, string>();
	const files: string[] = [];
	const walk = async (dir: string, depth: number): Promise<void> => {
		if (depth < 0) {
			return;
		}
		let entries;
		try {
			entries = await readdir(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			const path = join(dir, entry.name);
			if (entry.isDirectory()) {
				await walk(path, depth - 1);
			} else if (entry.name.endsWith(".jsonl")) {
				files.push(path);
			}
		}
	};
	await walk(SESSIONS_DIR, 4);
	for (const file of files) {
		try {
			const raw = await readFile(file, "utf8");
			const firstLine = raw.slice(0, raw.indexOf("\n") + 1 || undefined);
			const record: unknown = JSON.parse(firstLine);
			if (!isRecord(record) || !isRecord(record.payload)) {
				continue;
			}
			const id = record.payload.session_id;
			const provider = record.payload.model_provider;
			if (typeof id === "string" && typeof provider === "string") {
				providers.set(id, provider);
			}
		} catch {
			// A session file that cannot be parsed simply stays unclassified.
		}
	}
	return providers;
}

async function readRouterEvents(): Promise<RouterEvent[]> {
	const events: RouterEvent[] = [];
	try {
		const raw = await readFile(USAGE_EVENTS_PATH, "utf8");
		for (const line of raw.split("\n")) {
			if (!line) {
				continue;
			}
			try {
				const parsed: unknown = JSON.parse(line);
				if (!isRecord(parsed) || typeof parsed.at !== "string") {
					continue;
				}
				events.push({
					at: parsed.at,
					model: typeof parsed.model === "string" ? parsed.model : "",
					provider:
						typeof parsed.provider === "string" ? parsed.provider : "unknown",
					outputTokens:
						typeof parsed.outputTokens === "number" ? parsed.outputTokens : 0,
				});
			} catch {
				// Skip malformed rows.
			}
		}
	} catch {
		return [];
	}
	return events;
}

/**
 * Matches one CC Switch row against the router's own event log. Rows and events
 * describe the same request but round timestamps differently, so the match is
 * model + output token count inside a small time window.
 */
function buildRouterIndex(events: RouterEvent[]) {
	const bySecond = new Map<number, RouterEvent[]>();
	for (const event of events) {
		const seconds = Math.floor(Date.parse(event.at) / 1000);
		if (!Number.isFinite(seconds)) {
			continue;
		}
		for (let offset = -3; offset <= 3; offset += 1) {
			const key = seconds + offset;
			const bucket = bySecond.get(key);
			if (bucket) {
				bucket.push(event);
			} else {
				bySecond.set(key, [event]);
			}
		}
	}
	return bySecond;
}

export type CodexRow = {
	sessionId: string;
	model: string;
	outputTokens: number;
	createdAt: number;
};

function classify(
	rows: readonly CodexRow[],
	providers: Map<string, string>,
	nativeProviders: Set<string>,
	providerBaseUrls: Map<string, string>,
	rootUrls: { baseUrl: string | null; openaiBaseUrl: string | null },
	providerHosts: Map<string, string>,
	routerEvents: RouterEvent[]
): CodexSessionIndex {
	const nativeSessionIds = new Set<string>();
	const upstreams = new Map<string, CodexUpstream>();
	const routerIndex = buildRouterIndex(routerEvents);

	// Rows per session let a router session be judged on its whole traffic, and let a
	// session be placed in time against the router log below.
	const perSession = new Map<string, CodexRow[]>();
	for (const row of rows) {
		const bucket = perSession.get(row.sessionId);
		if (bucket) {
			bucket.push(row);
		} else {
			perSession.set(row.sessionId, [row]);
		}
	}

	// When the router log begins. CC Switch holds rows from before it existed, and a
	// request cannot have gone through a router that was not running yet.
	let routerStartMs = Number.POSITIVE_INFINITY;
	for (const event of routerEvents) {
		const time = Date.parse(event.at);
		if (Number.isFinite(time) && time < routerStartMs) {
			routerStartMs = time;
		}
	}

	// Which sessions went through the router, answered from the complete provider map
	// rather than from the rows the caller happened to pass: the index is cached, and
	// /deepseek passes only DeepSeek-named rows, so an index built there would be missing
	// router sessions whose model was not DeepSeek.
	//
	// The provider id alone is not enough. The codex-router deliberately keeps the
	// built-in `openai` provider and points `openai_base_url` at its own loopback, so a
	// session can read `model_provider = "openai"` and still have gone through the
	// router. What decides it is where the provider actually points.
	const routerSessionIds = new Set<string>();
	for (const [sessionId, provider] of providers) {
		if (!isLoopback(effectiveBaseUrl(provider, providerBaseUrls, rootUrls))) {
			continue;
		}
		const sessionRows = perSession.get(sessionId);
		if (!sessionRows) {
			// No rows for this session in this call, so nothing to place in time. The
			// provider is redirected at the router, so treat it as router traffic.
			routerSessionIds.add(sessionId);
			continue;
		}
		const earliest = sessionRows.reduce(
			(min, row) => Math.min(min, row.createdAt * 1000),
			Number.POSITIVE_INFINITY
		);
		if (earliest >= routerStartMs) {
			routerSessionIds.add(sessionId);
		}
	}

	let nativeDirect = 0;
	let nativeViaRouter = 0;
	let commandCode = 0;
	let otherUpstream = 0;
	let unclassified = 0;

	for (const [sessionId, sessionRows] of perSession) {
		const provider = providers.get(sessionId);
		if (provider && nativeProviders.has(provider)) {
			upstreams.set(sessionId, "native-deepseek");
			nativeSessionIds.add(sessionId);
			nativeDirect += sessionRows.length;
			continue;
		}
		if (provider === undefined) {
			// The Codex rollout for this session is gone, so nothing can say
			// which upstream served it.
			upstreams.set(sessionId, "router-unknown");
			unclassified += sessionRows.length;
			continue;
		}
		if (provider !== "codex-router") {
			upstreams.set(sessionId, "other");
			otherUpstream += sessionRows.length;
			continue;
		}
		// A Codex session drives one provider profile, so the whole session is
		// classified by its strongest evidence rather than row by row.
		const winner = resolveRouterSession(sessionRows, routerIndex, routerEvents);
		if (winner === "deepseek") {
			upstreams.set(sessionId, "native-deepseek");
			nativeSessionIds.add(sessionId);
			nativeViaRouter += sessionRows.length;
		} else if (winner === "commandcode") {
			upstreams.set(sessionId, "command-code");
			commandCode += sessionRows.length;
		} else {
			upstreams.set(sessionId, winner === null ? "router-unknown" : "other");
			if (winner === null) {
				unclassified += sessionRows.length;
			} else {
				otherUpstream += sessionRows.length;
			}
		}
	}

	return {
		providers,
		nativeProviders,
		providerHosts,
		upstreams,
		nativeSessionIds,
		routerSessionIds,
		stats: {
			sessions: perSession.size,
			nativeDirect,
			nativeViaRouter,
			commandCode,
			otherUpstream,
			unclassified,
		},
	};
}

/**
 * Picks the upstream for one Codex Router session.
 *
 * The router's event log timestamps a request differently from the session log
 * CC Switch imported, so the primary evidence is a model + output-token match
 * inside a ±3 s window. Sessions with no such match are resolved from the
 * provider the router used for the same models around the session's own time
 * span, which is still session-local evidence rather than a global guess.
 */
function resolveRouterSession(
	sessionRows: readonly CodexRow[],
	routerIndex: Map<number, RouterEvent[]>,
	routerEvents: readonly RouterEvent[]
): string | null {
	const votes = new Map<string, number>();
	for (const row of sessionRows) {
		const candidates = routerIndex.get(row.createdAt) ?? [];
		const hit = candidates.find(
			(event) =>
				shortModel(event.model) === shortModel(row.model) &&
				event.outputTokens === row.outputTokens
		);
		if (hit) {
			votes.set(hit.provider, (votes.get(hit.provider) ?? 0) + 1);
		}
	}
	const ranked = [...votes.entries()].sort((a, b) => b[1] - a[1]);
	if (ranked[0]) {
		return ranked[0][0];
	}

	const models = new Set(sessionRows.map((row) => shortModel(row.model)));
	let from = Number.POSITIVE_INFINITY;
	let to = Number.NEGATIVE_INFINITY;
	for (const row of sessionRows) {
		from = Math.min(from, row.createdAt);
		to = Math.max(to, row.createdAt);
	}
	const nearby = new Map<string, number>();
	for (const event of routerEvents) {
		const seconds = Math.floor(Date.parse(event.at) / 1000);
		if (!Number.isFinite(seconds) || seconds < from - 600 || seconds > to + 600) {
			continue;
		}
		if (!models.has(shortModel(event.model))) {
			continue;
		}
		nearby.set(event.provider, (nearby.get(event.provider) ?? 0) + 1);
	}
	const fallback = [...nearby.entries()].sort((a, b) => b[1] - a[1]);
	return fallback[0] ? fallback[0][0] : null;
}

/**
 * Classifies the sessions behind CC Switch's Codex rows. `force` bypasses the
 * in-process cache; callers otherwise share one 30 second snapshot.
 */
export async function getCodexSessionIndex(
	rows: readonly CodexRow[],
	options: { force?: boolean } = {}
): Promise<CodexSessionIndex> {
	if (!options.force && cache && Date.now() - cache.at < INDEX_TTL_MS) {
		return cache.value;
	}
	const [providers, config, routerEvents] = await Promise.all([
		readRolloutProviders(),
		readFile(CONFIG_PATH, "utf8").catch(() => ""),
		readRouterEvents(),
	]);
	const baseUrls = parseProviderBaseUrls(config);
	const rootUrls = parseRootBaseUrls(config);
	const nativeProviders = new Set<string>();
	const providerHosts = new Map<string, string>();
	// Every provider a session could name, not only the declared ones: a built-in like
	// openai is redirected from the root keys and still has a real host to name.
	for (const name of new Set(providers.values())) {
		const url = effectiveBaseUrl(name, baseUrls, rootUrls);
		if (!url) {
			continue;
		}
		if (isDeepSeekHost(url)) {
			nativeProviders.add(name);
		}
		// A loopback URL says nothing about the upstream - the router resolves that, and
		// its own event log names it - so only real hosts are recorded here.
		if (!isLoopback(url)) {
			const host = hostOf(url);
			if (host) {
				providerHosts.set(name, host);
			}
		}
	}
	const value = classify(
		rows,
		providers,
		nativeProviders,
		baseUrls,
		rootUrls,
		providerHosts,
		routerEvents
	);
	cache = { at: Date.now(), value };
	return value;
}
