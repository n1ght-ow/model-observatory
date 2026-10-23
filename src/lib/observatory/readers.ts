import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { stat } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { listFiles } from "./files";
import { readDshUsageEvents, releaseCommittedDsh } from "./sources/dsh";
import { readCursor } from "./sources/cursor";
import { scanJsonl } from "./jsonl";
import { UNRECORDED_CLIENT } from "./identity";
import { freezeEventAttribution, projectAttribution, sessionAttribution, unsupportedAttribution } from "./attribution";
import type { Coverage, ModelEvent, ModelEventAttribution } from "./types";

const home = (...parts: string[]) => join(homedir(), ...parts);
const num = (value: unknown): number => typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;
const obj = (value: unknown) => (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
const text = (value: unknown, fallback = "") => typeof value === "string" ? value : fallback;
const hash = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 20);
const attributionCache = new Map<string, ModelEventAttribution>();
let attributionCacheBytes = 0;
function cacheAttribution(key: string | undefined, value: ModelEventAttribution) {
	if (key !== undefined) {
		while (attributionCache.size && (attributionCache.size >= 1024 || attributionCacheBytes + key.length * 2 > 2 * 1024 * 1024)) {
			const oldest = attributionCache.keys().next().value!;
			attributionCache.delete(oldest); attributionCacheBytes -= oldest.length * 2;
		}
		attributionCache.set(key, value); attributionCacheBytes += key.length * 2;
	}
	return value;
}

function eventAttribution(
	source: string,
	client: string,
	project?: { id?: unknown; path?: unknown },
	sessionId?: unknown,
	parentSessionId?: unknown,
): ModelEventAttribution {
	// A cold scan can emit thousands of calls from the same session before its
	// first commit. Share immutable ownership while those rows are still pending.
	// Invalid types bypass the cache; null must not alias an absent identifier.
	const values = [project?.id, project?.path, sessionId, parentSessionId];
	const encoded = values.every((value) => value === undefined || (typeof value === "string" && value.length <= 4096)) ? JSON.stringify(["fields", source, client, ...values]) : undefined;
	const key = encoded && encoded.length <= 8192 ? encoded : undefined;
	const previous = key === undefined ? undefined : attributionCache.get(key);
	if (previous) return previous;
	const projectValue = projectAttribution({ source, client, id: project?.id, path: project?.path });
	return cacheAttribution(key, freezeEventAttribution({
		project: projectValue,
		session: sessionAttribution({ source, client, id: sessionId }),
		parentSession: sessionAttribution({ source, client, id: parentSessionId }),
	}));
}

function unsupportedEventAttribution(source: string, client: string): ModelEventAttribution {
	const key = JSON.stringify(["unsupported", source, client]);
	const previous = attributionCache.get(key);
	if (previous) return previous;
	return cacheAttribution(key, freezeEventAttribution({
		project: unsupportedAttribution(source, client),
		session: unsupportedAttribution(source, client),
		parentSession: unsupportedAttribution(source, client),
	}));
}

function event(source: string, identity: string, at: string, model: string, client: string, fields: Partial<ModelEvent> = {}): ModelEvent {
	const id = hash(`${source}:${identity}`);
	return { id, at, rawModel: model, model, client, upstream: "未记录", input: null, output: null, cache: null, status: "unknown", duration: null, identity: "reported", evidence: [{ id, source, kind: "session" }], attribution: fields.attribution ?? eventAttribution(source, client), ...fields };
}

export function discardCodexPrefix(prefix: string) {
	// Codex places its envelope type before the potentially huge tool payload.
	// Match only that known envelope, never a nested or escaped `type` string.
	const envelope = /^\s*\{\s*(?:"timestamp"\s*:\s*"[^"\\]*"\s*,\s*)?"type"\s*:\s*"([^"\\]+)"/.exec(prefix);
	if (!envelope) return false;
	if (envelope[1] === "response_item") return true;
	if (envelope[1] !== "event_msg") return false;
	const payload = /^\s*,\s*"payload"\s*:\s*\{\s*"type"\s*:\s*"([^"\\]+)"/.exec(prefix.slice(envelope[0].length));
	return Boolean(payload && payload[1] !== "token_count");
}

type CodexFileState = {
	model: string;
	client: string;
	identitySession: string;
	sessionId?: unknown;
	cwd?: unknown;
	parentSessionId?: unknown;
	total: string;
	counter: number;
};

function codexParentThreadId(payload: Record<string, unknown>): unknown {
	const source = obj(payload.source);
	const subagent = obj(source.subagent);
	const spawn = obj(subagent.spawn);
	return Object.hasOwn(spawn, "parent_thread_id") ? spawn.parent_thread_id : undefined;
}

async function readCodex(): Promise<ModelEvent[]> {
	const files = (await Promise.all([listFiles(home(".codex", "sessions"), /\.jsonl$/, 5), listFiles(home(".codex", "archived_sessions"), /\.jsonl$/, 2)])).flat();
	const output: ModelEvent[] = [];
	for (const file of files) {
		for (const row of await scanJsonl(file, "observatory-codex-v1", (): CodexFileState => ({ model: "unknown", client: "Codex", identitySession: basename(file), total: "", counter: 0 }), (record, state) => {
			const payload = obj(record.payload);
			if (record.type === "session_meta") {
				if (Object.hasOwn(payload, "id")) state.sessionId = payload.id;
				state.identitySession = text(payload.id, state.identitySession);
				state.client = /desktop/i.test(text(payload.originator)) ? "Codex Desktop" : "Codex CLI";
				if (Object.hasOwn(payload, "cwd")) state.cwd = payload.cwd;
				state.parentSessionId = codexParentThreadId(payload);
			}
			if (record.type === "turn_context") {
				state.model = text(payload.model, state.model);
				if (Object.hasOwn(payload, "cwd")) state.cwd = payload.cwd;
			}
			if (payload.type !== "token_count") return [];
			const info = obj(payload.info);
			if (!info.last_token_usage) return [];
			const total = JSON.stringify(info.total_token_usage ?? {});
			if (total === state.total) return [];
			state.total = total;
			state.counter++;
			const usage = obj(info.last_token_usage);
			return [event("codex", `${state.identitySession}:${state.counter}:${total}`, text(record.timestamp), state.model, state.client, {
				input: num(usage.input_tokens), output: num(usage.output_tokens), cache: num(usage.cached_input_tokens), identity: "configured",
				attribution: eventAttribution("codex", "Codex", { path: state.cwd }, state.sessionId, state.parentSessionId),
			})];
		}, (line) => /"(?:session_meta|turn_context|token_count)"/.test(line), discardCodexPrefix)) output.push(row);
	}
	return output;
}

async function readRouter(): Promise<ModelEvent[]> {
	const path = home(".codex", "codex-router", "usage-events.jsonl");
	if (!existsSync(path)) return [];
	return scanJsonl(path, "observatory-router-v1", () => ({}), (row, _state, line) => {
		if (!row.at || !row.model) return [];
		const status = num(row.status);
		const id = text(row.requestId, String(line));
		const result = event("router", id, text(row.at), text(row.responseModel, text(row.model)), UNRECORDED_CLIENT, {
			requestId: text(row.requestId) || undefined, upstream: text(row.provider, "未记录"),
			input: typeof row.inputTokens === "number" ? num(row.inputTokens) : null,
			output: typeof row.outputTokens === "number" ? num(row.outputTokens) : null,
			cache: typeof row.cachedInputTokens === "number" ? num(row.cachedInputTokens) : null,
			status: status >= 400 ? "error" : status >= 200 ? "ok" : "unknown", duration: num(row.durationMs) || null,
			attribution: unsupportedEventAttribution("router", UNRECORDED_CLIENT),
		});
		result.evidence[0].kind = "router";
		return [result];
	});
}

async function readClaude(): Promise<ModelEvent[]> {
	const files = await listFiles(home(".claude", "projects"), /\.jsonl$/, 5);
	const output: ModelEvent[] = [];
	for (const file of files) for (const row of await scanJsonl(file, "observatory-claude-v1", () => ({}), (row, _state, line) => {
		if (row.type !== "assistant") return [];
		const message = obj(row.message), usage = obj(message.usage);
		if (!message.model || message.model === "<synthetic>") return [];
		const cache = num(usage.cache_read_input_tokens);
		return [event("claude-code", `${basename(file)}:${text(message.id, String(line))}`, text(row.timestamp), text(message.model), "Claude Code", {
			requestId: text(message.id) || undefined,
			input: message.usage ? num(usage.input_tokens) + cache + num(usage.cache_creation_input_tokens) : null,
			output: message.usage ? num(usage.output_tokens) : null, cache: message.usage ? cache : null,
			attribution: eventAttribution("claude-code", "Claude Code", { path: row.cwd }, row.sessionId),
		})];
	}, (line) => line.includes('"assistant"'))) output.push(row);
	return output;
}

type AgentFileState = {
	sessionId?: unknown;
	cwd?: unknown;
};

async function readAgent(source: "pi" | "command-code"): Promise<ModelEvent[]> {
	const root = source === "pi" ? home(".pi", "agent", "sessions") : home(".commandcode", "projects");
	const files = (await listFiles(root, /\.jsonl$/, 5)).filter((file) => !file.includes("checkpoint"));
	const output: ModelEvent[] = [];
	for (const file of files) for (const row of await scanJsonl(file, `observatory-${source}-v1`, (): AgentFileState => ({}), (row, state, line) => {
		if (source === "pi" && row.type === "session") {
			if (Object.hasOwn(row, "id")) state.sessionId = row.id;
			if (Object.hasOwn(row, "cwd")) state.cwd = row.cwd;
			// pi parentSession is normally a path to another log. It is not the
			// parent's header id, so treating it as a session id would fabricate a
			// relationship that the attribution contract cannot verify.
			return [];
		}
		const message = obj(row.message);
		if (row.type !== "message" || message.role !== "assistant") return [];
		const usage = obj(source === "pi" ? message.usage : row.usage);
		const model = text(source === "pi" ? message.model : row.model);
		if (!model || !Object.keys(usage).length) return [];
		const input = num(usage.input ?? usage.inputTokens), cache = num(usage.cacheRead ?? usage.cacheReadTokens), write = num(usage.cacheWrite ?? usage.cacheWriteTokens);
		const id = text(row.id, `${hash(file)}:${line}`);
		return [event(source, id, new Date(row.timestamp as string | number).toISOString(), model, source === "pi" ? "pi" : "Command Code CLI", {
			requestId: id, upstream: text(message.provider, source === "command-code" ? "Command Code" : "未记录"),
			input: input + cache + write, output: num(usage.output ?? usage.outputTokens), cache,
			status: message.stopReason === "error" ? "error" : "unknown",
			attribution: source === "pi"
				? eventAttribution("pi", "pi", { path: state.cwd }, state.sessionId)
				: unsupportedEventAttribution("command-code", "Command Code CLI"),
		})];
	}, (line) => line.includes('"message"') || (source === "pi" && /"type"\s*:\s*"session"/.test(line)))) output.push(row);
	return output;
}

const databases = new Map<string, { signature: string; rows: ModelEvent[] }>();
const databaseTableColumns = (db: DatabaseSync, table: "message" | "model_usage" | "session") =>
	new Set(db.prepare(`PRAGMA table_info(${JSON.stringify(table)})`).all().map((row) => text((row as Record<string, unknown>).name)));

function sessionIdsAreUnique(db: DatabaseSync, columns: Set<string>) {
	return columns.has("id") && !db.prepare("SELECT 1 FROM session GROUP BY id HAVING COUNT(*) > 1 LIMIT 1").get();
}

function databaseSessionSelect(columns: Set<string>, joined: boolean) {
	const prefix = joined ? "s." : "";
	const field = (name: string, alias: string) => joined && columns.has(name) ? `${prefix}${name} AS ${alias}` : `NULL AS ${alias}`;
	return [field("directory", "session_cwd"), field("project_id", "session_project_id"), field("parent_id", "session_parent_id")].join(", ");
}

type DatabaseSchemaSupport = {
	session: boolean;
	project: boolean;
	parent: boolean;
	ambiguousSessionMap: boolean;
};

function databaseAttribution(source: string, client: string, row: Record<string, unknown>, supported: DatabaseSchemaSupport) {
	return freezeEventAttribution({
		project: supported.project
			? supported.ambiguousSessionMap
				? projectAttribution({ source, client, id: null })
				: projectAttribution({ source, client, id: row.session_project_id ?? undefined, path: row.session_cwd ?? undefined })
			: unsupportedAttribution(source, client),
		session: supported.session
			? sessionAttribution({ source, client, id: row.session_id ?? undefined })
			: unsupportedAttribution(source, client),
		parentSession: supported.parent
			? supported.ambiguousSessionMap
				? sessionAttribution({ source, client, id: null })
				: sessionAttribution({ source, client, id: row.session_parent_id ?? undefined })
			: unsupportedAttribution(source, client),
	});
}

async function readDatabase(source: "zcode" | "opencode"): Promise<ModelEvent[]> {
	const path = source === "zcode" ? home(".zcode", "cli", "db", "db.sqlite") : home(".local", "share", "opencode", "opencode.db");
	if (!existsSync(path)) return [];
	const signature = (await Promise.all([path, path + "-wal"].map(async (p) => { try { const s = await stat(/* turbopackIgnore: true */ p); return `${s.size}:${s.mtimeMs}`; } catch { return "missing"; } }))).join(":");
	const cached = databases.get(source);
	if (cached?.signature === signature) return cached.rows;
	const db = new DatabaseSync(path, { readOnly: true });
	try {
		const rows: ModelEvent[] = [];
		if (source === "zcode") {
			const usageColumns = databaseTableColumns(db, "model_usage"), sessionColumns = databaseTableColumns(db, "session");
			const hasSessionLink = usageColumns.has("session_id");
			const joined = hasSessionLink && sessionIdsAreUnique(db, sessionColumns);
			const supported = {
				session: hasSessionLink,
				project: hasSessionLink && sessionColumns.has("id") && (sessionColumns.has("directory") || sessionColumns.has("project_id")),
				parent: hasSessionLink && sessionColumns.has("id") && sessionColumns.has("parent_id"),
				ambiguousSessionMap: hasSessionLink && sessionColumns.has("id") && !joined,
			};
			const sessionId = usageColumns.has("session_id") ? "m.session_id AS session_id" : "NULL AS session_id";
			const records = db.prepare(`SELECT m.id, m.model_id, m.provider_id, m.status, m.started_at, m.duration_ms, m.input_tokens, m.output_tokens, m.cache_read_input_tokens, ${sessionId}, ${databaseSessionSelect(sessionColumns, joined)} FROM model_usage AS m ${joined ? "LEFT JOIN session AS s ON s.id = m.session_id" : ""} WHERE m.status IN ('completed','error','cancelled')`).iterate();
			for (const value of records) {
				const r = value as Record<string, unknown>;
				rows.push(event(source, text(r.id), new Date(r.started_at as string | number).toISOString(), text(r.model_id, "unknown"), "ZCode", {
					requestId: text(r.id), upstream: text(r.provider_id, "未记录"), input: typeof r.input_tokens === "number" ? num(r.input_tokens) : null,
					output: typeof r.output_tokens === "number" ? num(r.output_tokens) : null, cache: typeof r.cache_read_input_tokens === "number" ? num(r.cache_read_input_tokens) : null,
					status: r.status === "completed" ? "ok" : "error", duration: num(r.duration_ms) || null,
					attribution: databaseAttribution("zcode", "ZCode", r, supported),
				}));
			}
		} else {
			// Select usage metadata and the whitelisted session directory; never
			// load prompts, message bodies, or other stored paths.
			const messageColumns = databaseTableColumns(db, "message"), sessionColumns = databaseTableColumns(db, "session");
			const hasSessionLink = messageColumns.has("session_id");
			const joined = hasSessionLink && sessionIdsAreUnique(db, sessionColumns);
			const supported = {
				session: hasSessionLink,
				project: hasSessionLink && sessionColumns.has("id") && (sessionColumns.has("directory") || sessionColumns.has("project_id")),
				parent: hasSessionLink && sessionColumns.has("id") && sessionColumns.has("parent_id"),
				ambiguousSessionMap: hasSessionLink && sessionColumns.has("id") && !joined,
			};
			const sessionId = messageColumns.has("session_id") ? "m.session_id AS session_id" : "NULL AS session_id";
			const records = db.prepare(`SELECT m.id, json_extract(m.data,'$.modelID') AS model, json_extract(m.data,'$.providerID') AS provider, json_extract(m.data,'$.tokens') AS tokens, json_extract(m.data,'$.time.created') AS started, json_extract(m.data,'$.time.completed') AS ended, json_extract(m.data,'$.error.name') AS error, ${sessionId}, ${databaseSessionSelect(sessionColumns, joined)} FROM message AS m ${joined ? "LEFT JOIN session AS s ON s.id = m.session_id" : ""} WHERE json_extract(m.data,'$.role')='assistant' AND json_extract(m.data,'$.time.completed') IS NOT NULL`).iterate();
			for (const value of records) {
				const r = value as Record<string, unknown>;
				const tokens = obj(JSON.parse(text(r.tokens, "{}"))), cache = obj(tokens.cache);
				rows.push(event(source, text(r.id), new Date(num(r.ended)).toISOString(), text(r.model, "unknown"), "OpenCode", {
					requestId: text(r.id), upstream: text(r.provider, "未记录"), input: r.tokens ? num(tokens.input) + num(cache.read) + num(cache.write) : null,
					output: r.tokens ? num(tokens.output) + num(tokens.reasoning) : null, cache: r.tokens ? num(cache.read) : null,
					status: r.error ? "error" : "unknown", duration: num(r.ended) - num(r.started) || null,
					attribution: databaseAttribution("opencode", "OpenCode", r, supported),
				}));
			}
		}
		databases.set(source, { signature, rows });
		return rows;
	} finally { db.close(); }
}

async function readGrok(): Promise<ModelEvent[]> {
	const files = await listFiles(home(".grok", "sessions"), /chat_history\.jsonl$/, 4);
	const output: ModelEvent[] = [];
	for (const file of files) for (const row of await scanJsonl(file, "observatory-grok-v1", () => ({}), (row, _state, line) => {
		if (row.type !== "assistant" || typeof row.model_id !== "string" || !row.model_id) return [];
		// Grok history has no reliable call time or usage. The sentinel is never
		// included in a dated range or chart; the call remains visible in all history.
		return [event("grok-cli", `${hash(file)}:${line}`, "1970-01-01T00:00:00.000Z", row.model_id, "Grok CLI", {
			timeKnown: false,
			attribution: unsupportedEventAttribution("grok-cli", "Grok CLI"),
		})];
	})) output.push(row);
	return output;
}

type Reader = { id: string; name: string; description: string; read: () => Promise<ModelEvent[]> };
const dshEvents = new WeakMap<Awaited<ReturnType<typeof readDshUsageEvents>>[number], ModelEvent>();
const readers: Reader[] = [
	{ id: "cursor", name: "Cursor", description: "只读本地 SQLite 的会话请求，按 requestId 去重分叉副本；一轮含多步模型调用，不能代表全部底层调用。模型取自当轮配置；默认 tokenCount=0 不当作用量，Token 保持未记录。", read: readCursor },
	{ id: "codex", name: "Codex", description: "直接读取 CLI / Desktop 的 token_count，跳过重复累计快照。模型来自当次会话配置。", read: readCodex },
	{ id: "router", name: "Codex Router", description: "读取逐请求日志，与原始会话一对一核对。工具未知时保留未知。", read: readRouter },
	{ id: "dsh", name: "DeepSeek Harness", description: "读取原始压缩会话中的模型与 usage，不依赖 CC Switch。", read: async () => (await readDshUsageEvents()).map((r) => {
		let result = dshEvents.get(r);
		if (!result) {
			result = event("dsh", `${r.sessionId}:${r.at}:${r.sequence}`, r.at, r.model, "DeepSeek Harness", {
				upstream: r.provider, input: r.inputTokens, output: r.outputTokens, cache: r.cacheReadTokens, duration: r.durationMs ?? null,
				attribution: eventAttribution("dsh", "DeepSeek Harness", { path: r.cwd }, r.sessionRecordId),
			});
			dshEvents.set(r, result);
		}
		return result;
	}) },
	{ id: "pi", name: "pi", description: "读取原始会话，合并缓存与非缓存输入；每条模型响应是一条记录。", read: () => readAgent("pi") },
	{ id: "zcode", name: "ZCode", description: "读取原始 model_usage 数据库的 completed / error / cancelled，重试按实际尝试分别计数。", read: () => readDatabase("zcode") },
	{ id: "opencode", name: "OpenCode", description: "直接读取原始 SQLite 消息用量，包含缓存输入。读取数据库与 WAL 的变化。", read: () => readDatabase("opencode") },
	{ id: "claude-code", name: "Claude Code", description: "读取 assistant message usage；相同 message id 的流式更新只计一次。", read: readClaude },
	{ id: "command-code", name: "Command Code CLI", description: "读取本地逐响应 usage。套餐额度不是请求数量。", read: () => readAgent("command-code") },
	{ id: "grok-cli", name: "Grok CLI", description: "本地记录缺少可靠时间与 Token。仅计入全部历史，不以文件修改时间冒充调用时间。", read: readGrok },
];

/** The archive owns committed rows; unchanged databases need only a signature. */
export function releaseCommittedReaders() {
	attributionCache.clear(); attributionCacheBytes = 0;
	for (const database of databases.values()) database.rows = [];
	releaseCommittedDsh();
}

export async function collectObservations() {
	const results = await Promise.all(readers.map(async (reader) => {
		try {
			const events = (await reader.read()).filter((r) => Number.isFinite(Date.parse(r.at)));
			return { events, coverage: { id: reader.id, name: reader.name, state: events.length ? "connected" : "empty", count: events.length, latest: events.reduce<string | null>((n, r) => r.timeKnown === false ? n : n === null || r.at > n ? r.at : n, null), description: reader.description } as Coverage };
		} catch {
			return { events: [], coverage: { id: reader.id, name: reader.name, state: "error", count: 0, latest: null, description: "暂时无法读取本地数据。下次刷新会重试，其他来源继续统计。" } as Coverage };
		}
	}));
	return { observations: results.flatMap((r) => r.events), coverage: [...results.map((r) => r.coverage),
		{ id: "chatgpt", name: "ChatGPT 桌面端 / 网页", state: "unsupported", count: 0, latest: null, description: "尚无可读取的逐请求 usage。应用内聊天不会自动进入 API 日志，当前不计入总量。可通过统一事件接口接入能提供模型与 usage 的采集器。" } as Coverage,
	] };
}
