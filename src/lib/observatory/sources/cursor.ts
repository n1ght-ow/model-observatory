import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { freezeEventAttribution, mergeAttribution, projectAttribution, sessionAttribution } from "../attribution";
import type { ModelEvent } from "../types";

type Bubble = {
	key: string; bubble: string; type: number; request: string | null;
	model: string | null; created: string | number | null; simulated: number | null;
};
const cache = new Map<string, { signature: string; events: ModelEvent[] }>();

function databasePath() {
	const root = process.env.CURSOR_USER_DATA_DIR ?? (process.platform === "win32"
		? join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "Cursor")
		: process.platform === "darwin" ? join(homedir(), "Library", "Application Support", "Cursor") : join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "Cursor"));
	return join(root, "User", "globalStorage", "state.vscdb");
}

/** Read only request metadata; prompts, replies, auth storage and code never leave SQLite. */
export async function readCursor(path = databasePath()): Promise<ModelEvent[]> {
	if (!existsSync(path)) return [];
	const signature = (await Promise.all([path, path + "-wal"].map(async (file) => {
		try { const value = await stat(/* turbopackIgnore: true */ file); return `${value.size}:${value.mtimeMs}`; }
		catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return "missing"; throw error; }
	}))).join(":");
	const prior = cache.get(path);
	if (prior?.signature === signature) return prior.events;
	const db = new DatabaseSync(path, { readOnly: true });
	try {
		db.exec("PRAGMA busy_timeout=1500; BEGIN");
		const rows = db.prepare(`SELECT key,
			json_extract(CAST(value AS TEXT),'$.bubbleId') AS bubble,
			json_extract(CAST(value AS TEXT),'$.type') AS type,
			json_extract(CAST(value AS TEXT),'$.requestId') AS request,
			json_extract(CAST(value AS TEXT),'$.modelInfo.modelName') AS model,
			COALESCE(json_extract(CAST(value AS TEXT),'$.createdAt'),json_extract(CAST(value AS TEXT),'$.startedAtMs')) AS created,
			json_extract(CAST(value AS TEXT),'$.isSimulatedMsg') AS simulated
			FROM cursorDiskKV WHERE key GLOB 'bubbleId:*' AND json_valid(CAST(value AS TEXT))`).all() as unknown as Bubble[];
		// Header order disambiguates messages that share a timestamp, including forks.
		const headers = db.prepare(`SELECT kv.key AS composer, header.key AS position,
			json_extract(header.value,'$.bubbleId') AS bubble
			FROM cursorDiskKV AS kv, json_each(CASE WHEN json_valid(CAST(kv.value AS TEXT))
			THEN json_extract(CAST(kv.value AS TEXT),'$.fullConversationHeadersOnly') ELSE '[]' END) AS header
			WHERE kv.key GLOB 'composerData:*' AND header.type='object'`).all();
		db.exec("COMMIT");
		const order = new Map(headers.map((r) => [`${String(r.composer).slice("composerData:".length)}:${r.bubble}`, Number(r.position)]));
		const conversations = new Map<string, Bubble[]>();
		for (const row of rows) {
			const composer = row.key.split(":")[1];
			const group = conversations.get(composer) ?? [];
			group.push(row);
			conversations.set(composer, group);
		}
		const turns = new Map<string, { at: string; models: Set<string>; composers: Set<string> }>();
		for (const [composer, bubbles] of conversations) {
			const timestamp = (row: Bubble) => row.created === null ? NaN : new Date(row.created).getTime();
			const ordered = bubbles.every((row) => order.has(`${composer}:${row.bubble}`));
			bubbles.sort((a, b) => {
				if (ordered) return order.get(`${composer}:${a.bubble}`)! - order.get(`${composer}:${b.bubble}`)!;
				return timestamp(a) - timestamp(b) || a.type - b.type || a.key.localeCompare(b.key);
			});
			let request: Bubble | undefined;
			for (const bubble of bubbles) {
				if (bubble.type === 1) {
					request = typeof bubble.request === "string" && bubble.request.trim() && !bubble.simulated && Number.isFinite(timestamp(bubble)) ? bubble : undefined;
				} else if (bubble.type === 2 && !bubble.simulated && request) {
					const id = request.request!;
					const at = new Date(request.created!).toISOString();
					const turn = turns.get(id) ?? { at, models: new Set<string>(), composers: new Set<string>() };
					if (at < turn.at) turn.at = at;
					if (typeof request.model === "string" && request.model.trim()) turn.models.add(request.model.trim());
					turn.composers.add(composer);
					turns.set(id, turn);
				}
			}
		}
		const events: ModelEvent[] = [...turns].map(([requestId, turn]) => {
			const id = createHash("sha256").update(`cursor:${requestId}`).digest("hex").slice(0, 20);
			const model = turn.models.size === 1 ? [...turn.models][0] : "unknown";
			// tokenCount is initialized to zero by Cursor; it is not provider usage.
			// An agent turn can contain many calls, so keep that scope explicit.
			let session = sessionAttribution({ source: "cursor", client: "Cursor" });
			for (const composer of turn.composers) session = mergeAttribution(session, sessionAttribution({ source: "cursor", client: "Cursor", id: composer }))!;
			const attribution = freezeEventAttribution({
				project: projectAttribution({ source: "cursor", client: "Cursor" }),
				session,
				parentSession: sessionAttribution({ source: "cursor", client: "Cursor" }),
			});
			return { id, at: turn.at, model, rawModel: model, client: "Cursor", upstream: "未记录",
				input: null, output: null, cache: null, status: "unknown", duration: null,
				identity: "configured", scope: "turn", requestId, evidence: [{ id, source: "cursor", kind: "session" }], attribution };
		});
		cache.set(path, { signature, events });
		return events;
	} finally { db.close(); }
}
