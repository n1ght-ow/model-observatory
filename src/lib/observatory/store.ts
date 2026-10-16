import { mkdir, readFile, appendFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { releaseCommittedJsonl, scanJsonl } from "./jsonl";
import { collectObservations } from "./readers";
import { eventTimes, makeSnapshot, nextSnapshotChange, reconcile } from "./ledger";
import type { ModelEvent, ObservatorySnapshot } from "./types";
import { ObservationArchive } from "./archive";

export const storeDir = process.env.OBSERVATORY_DATA_DIR ?? join(homedir(), ".model-observatory");

export function parseIngest(value: unknown): ModelEvent {
	if (!value || typeof value !== "object") throw new Error("事件必须是 JSON 对象");
	const row = value as Record<string, unknown>;
	for (const key of ["id", "at", "model", "client"]) {
		if (typeof row[key] !== "string" || !row[key] || (row[key] as string).length > 200) throw new Error(`缺少有效字段：${key}`);
	}
	if (!Number.isFinite(Date.parse(String(row.at))) || Date.parse(String(row.at)) > Date.now() + 60_000) throw new Error("无效或未来的事件时间");
	const usage = (key: string) => {
		if (row[key] === undefined || row[key] === null) return null;
		if (typeof row[key] !== "number" || !Number.isSafeInteger(row[key]) || row[key] < 0) throw new Error(`无效的 Token 数：${key}`);
		return row[key] as number;
	};
	const input = usage("input"), output = usage("output"), cache = usage("cache");
	if (cache !== null && input !== null && cache > input) throw new Error("缓存输入不能超过总输入");
	return { id: `event:${row.client}:${row.id}`, at: new Date(String(row.at)).toISOString(), model: String(row.model), rawModel: String(row.model), client: String(row.client), upstream: typeof row.upstream === "string" ? row.upstream.slice(0, 200) : "未记录", input, output, cache, status: row.status === "ok" || row.status === "error" ? row.status : "unknown", duration: typeof row.duration === "number" && row.duration >= 0 && Number.isFinite(row.duration) ? row.duration : null, identity: "reported", requestId: String(row.id), evidence: [{ id: String(row.id), source: `event:${row.client}`, kind: "event" }] };
}

export async function appendEvent(event: ModelEvent) {
	await mkdir(storeDir, { recursive: true });
	await appendFile(join(storeDir, "events.jsonl"), JSON.stringify(event) + "\n", "utf8");
}

let archive: ObservationArchive | undefined;
function history() { return archive ??= new ObservationArchive(join(storeDir, "history.sqlite")); }
let pending: Promise<void> | null = null;
let collectionError: string | null = null;
export function collectionState() { const state = history().state(); return { ...state, collecting: Boolean(pending) && !state.paused, error: collectionError }; }
export async function collectNow(force = false) {
	const state = collectionState();
	if (state.paused || (!force && state.collectedAt && Date.now() - Date.parse(state.collectedAt) < 3000)) return state;
	pending ??= (async () => {
		const base = await collectObservations();
		const path = join(storeDir, "events.jsonl");
		const ingested = existsSync(path) ? await scanJsonl<ModelEvent, object>(path, "observatory-events-v1", () => ({}), (row) => [row as unknown as ModelEvent]) : [];
		const stored = history().commit([...base.observations, ...ingested], [...base.coverage, { id: "events", name: "统一事件接口", state: ingested.length ? "connected" : "empty", count: ingested.length, latest: null, description: "统一事件持久保存。暂停时接收并排队，恢复后按稳定 ID 入账。" }]);
		if (stored) await releaseCommittedJsonl();
		collectionError = null;
	})().catch((error) => { collectionError = "暂时无法采集新记录，已保留历史。请重试。"; throw error; }).finally(() => { pending = null; });
	await pending;
	return collectionState();
}
export async function setCollectionPaused(paused: boolean) {
	history().setPaused(paused);
	if (pending) await pending;
	if (!paused) await collectNow(true);
	return collectionState();
}
let cachedLedger: { observations: ModelEvent[]; aliases: string; ledger: ReturnType<typeof reconcile>; times: Float64Array } | undefined;
const snapshots = new Map<string, { base: ReturnType<ObservationArchive["read"]>; until: number; snapshot: ObservatorySnapshot }>();
export async function getSnapshot(range: string) {
	// Existing history is usable immediately, even while a cold scan catches up.
	// An empty ledger still waits for its first collection before showing totals.
	if (history().state().observations) void collectNow().catch(() => {});
	else await collectNow();
	let aliases: Record<string, string> = {};
	try {
		const parsed = JSON.parse(await readFile(join(storeDir, "aliases.json"), "utf8"));
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) aliases = Object.fromEntries(Object.entries(parsed).filter(([k, v]) => k.length <= 200 && typeof v === "string" && v.length > 0 && v.length <= 200).map(([k, v]) => [k.toLowerCase(), String(v).toLowerCase()]));
	} catch { /* No alias file means conservative built-in namespace rules only. */ }
	const base = history().read();
	const aliasKey = JSON.stringify(aliases), now = Date.now();
	if (!cachedLedger || cachedLedger.observations !== base.observations || cachedLedger.aliases !== aliasKey) {
		const ledger = reconcile(base.observations, aliases);
		ledger.events.sort((a, b) => b.at.localeCompare(a.at));
		cachedLedger = { observations: base.observations, aliases: aliasKey, ledger, times: eventTimes(ledger.events) };
		snapshots.clear();
	}
	// Rebuild only when the records, coverage, or the set of rows inside the
	// time window would change. A fixed one-second expiry repeated the same sum.
	let cached = snapshots.get(range);
	if (!cached || cached.base !== base || !(now < cached.until)) {
		const snapshot = makeSnapshot(base.observations, base.coverage, range, aliases, now, { ...cachedLedger.ledger, times: cachedLedger.times });
		cached = { base, until: nextSnapshotChange(range, now, cachedLedger.ledger.events, cachedLedger.times), snapshot };
		snapshots.set(range, cached);
	}
	return { ...cached.snapshot, collection: collectionState() };
}
