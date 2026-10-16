const assert = require("node:assert/strict");
const { test } = require("node:test");
const { mkdtemp, appendFile, writeFile, utimes, rm, rename } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const ts = require("typescript");

// Exercise the production TypeScript directly, without a second implementation.
require.extensions[".ts"] = (module, file) => {
	const source = require("node:fs").readFileSync(file, "utf8");
	module._compile(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, file);
};
const { normalizeModel } = require("../src/lib/observatory/identity.ts");
const { reconcile, makeSnapshot, eventTimes, nextSnapshotChange } = require("../src/lib/observatory/ledger.ts");
const { scanJsonl, releaseCommittedJsonl } = require("../src/lib/observatory/jsonl.ts");
const { readDshSessionFile } = require("../src/lib/observatory/sources/dsh.ts");
const { ObservationArchive } = require("../src/lib/observatory/archive.ts");
const now = Date.parse("2026-10-14T06:00:00Z");
const row = (id, changes = {}) => ({ id, at: "2026-10-14T05:00:00Z", model: "gpt-6.1-sol", rawModel: "gpt-6.1-sol", client: "Codex", upstream: "未记录", input: 1000, output: 100, cache: 500, status: "unknown", duration: null, identity: "reported", evidence: [{ id, source: "codex", kind: "session" }], ...changes });
const route = (id, changes = {}) => row(id, { rawModel: "openai/gpt-6.1-sol", client: "未识别工具", upstream: "openai", evidence: [{ id, source: "router", kind: "router" }], ...changes });

test("archive caches remain correct after unchanged replay, revised usage and another connection's WAL commit", async () => {
	const dir = await mkdtemp(join(tmpdir(), "observatory-cache-"));
	const file = join(dir, "history.sqlite");
	const first = new ObservationArchive(file), second = new ObservationArchive(file);
	const coverage = [{ id: "codex", name: "Codex", state: "connected", count: 1, latest: null, description: "fixture" }];
	try {
		first.commit([row("a")], coverage);
		assert.equal(first.read().observations.length, 1);
		first.commit([row("a")], coverage);
		assert.equal(first.read().coverage[0].count, 1);
		second.commit([row("a", { output: 300 }), row("b")], coverage);
		assert.equal(first.read().observations.length, 2);
		assert.equal(first.read().observations.find((r) => r.id === "a").output, 300);
		first.commit([row("a")], coverage);
		assert.equal(first.read().observations.find((r) => r.id === "a").output, 300);
		second.commit([], [{ ...coverage[0], state: "error" }]);
		assert.equal(first.read().coverage[0].state, "error");
		assert.equal(first.read().coverage[0].count, 2);
	} finally { first.close(); second.close(); await rm(dir, { recursive: true, force: true }); }
});

test("archive shares immutable reader records, keeps prior snapshots stable and rolls back rejected writes", async () => {
	const dir = await mkdtemp(join(tmpdir(), "observatory-sharing-"));
	const file = join(dir, "history.sqlite");
	const archive = new ObservationArchive(file);
	const first = row("a"), second = row("b");
	try {
		archive.commit([first, second], []);
		const old = archive.read();
		assert.equal(old.observations[0], first);
		assert.ok(Object.isFrozen(first) && Object.isFrozen(first.evidence) && Object.isFrozen(first.evidence[0]));
		archive.commit([first, second], []);
		assert.equal(archive.read(), old);
		const revised = row("a", { output: 300 });
		archive.commit([revised, second], []);
		assert.equal(archive.read().observations.find((r) => r.id === "a"), revised);
		assert.equal(archive.read().observations.find((r) => r.id === "b"), second);
		assert.equal(old.observations[0].output, 100);
		const { DatabaseSync } = require("node:sqlite");
		const sql = new DatabaseSync(file);
		sql.exec("CREATE TRIGGER reject_fixture BEFORE INSERT ON observations WHEN NEW.id='reject' BEGIN SELECT RAISE(ABORT, 'fixture rollback'); END");
		assert.throws(() => archive.commit([row("a", { output: 999 }), row("reject")], []), /fixture rollback/);
		assert.equal(archive.read().observations.find((r) => r.id === "a").output, 300);
		assert.equal(archive.read().observations.length, 2);
		sql.close();
	} finally { archive.close(); await rm(dir, { recursive: true, force: true }); }
});

test("reconciliation does not mutate shared observations through aliases, revisions or router matches", () => {
	const rows = [row("a", { requestId: "same", output: 5 }), row("b", { requestId: "same" }), route("r"), row("unchanged", { rawModel: "separate-model", model: "separate-model" })];
	const before = JSON.stringify(rows);
	for (const event of rows) { event.evidence.forEach(Object.freeze); Object.freeze(event.evidence); Object.freeze(event); }
	const result = reconcile(rows);
	assert.equal(result.events.find((r) => r.requestId === "same").evidence.length, 2);
	assert.equal(result.events.find((r) => r.id === "unchanged"), rows[3]);
	assert.equal(JSON.stringify(rows), before);
	const mapped = reconcile(rows, { "separate-model": "renamed-model" });
	assert.equal(mapped.events.find((r) => r.id === "unchanged").model, "renamed-model");
	assert.equal(rows[3].model, "separate-model");
});

test("prepared ledger matches fresh snapshots across ranges, advancing time and aliases", () => {
	const rows = [row("boundary", { at: new Date(now - 86_400_000 + 1).toISOString() }), row("now"), route("r"), row("unknown", { timeKnown: false })];
	for (const aliases of [{}, { "gpt-6.1-sol": "renamed-model" }]) {
		const prepared = reconcile(rows, aliases);
		prepared.events.sort((a, b) => b.at.localeCompare(a.at));
		const timed = { ...prepared, times: eventTimes(prepared.events) };
		for (const at of [now, now + 1000, now + 86_400_000]) for (const range of ["today", "24h", "7d", "30d", "all"]) {
			assert.deepEqual(makeSnapshot(rows, [], range, aliases, at, prepared), makeSnapshot(rows, [], range, aliases, at));
			assert.deepEqual(makeSnapshot(rows, [], range, aliases, at, timed), makeSnapshot(rows, [], range, aliases, at));
		}
	}
});

test("saved history is readable during slow catch-up, then refreshes after commit and alias changes", async () => {
	const { execFileSync } = require("node:child_process");
	const dir = await mkdtemp(join(tmpdir(), "observatory-store-"));
	const worker = `const fs=require('node:fs'),path=require('node:path'),ts=require('typescript'),assert=require('node:assert/strict');
		require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,f);
		const {ObservationArchive}=require('./src/lib/observatory/archive.ts');
		const rows=JSON.parse(process.argv[2]),file=path.join(process.env.OBSERVATORY_DATA_DIR,'history.sqlite');
		const archive=new ObservationArchive(file); archive.commit([rows[0]],[]); archive.close();
		let finish; const gate=new Promise(resolve=>finish=resolve);
		require('./src/lib/observatory/readers.ts').collectObservations=()=>gate;
		const store=require('./src/lib/observatory/store.ts');
		(async()=>{
			const timeout=new Promise((_,reject)=>setTimeout(()=>reject(new Error('History blocked on catch-up')),2000).unref());
			const old=await Promise.race([store.getSnapshot('all'),timeout]);
			assert.equal(old.totals.requests,1); assert.equal(old.collection.collecting,true,'Even a recent previous-process commit must start catch-up immediately');
			finish({observations:rows,coverage:[]}); await store.collectNow(true);
			assert.equal((await store.getSnapshot('all')).totals.requests,2);
			const warm=await store.getSnapshot('all');
			assert.equal((await store.getSnapshot('all')).generatedAt, warm.generatedAt);
			fs.writeFileSync(path.join(process.env.OBSERVATORY_DATA_DIR,'aliases.json'),JSON.stringify({'gpt-6.1-sol':'fixture-renamed'}));
			assert.equal((await store.getSnapshot('all')).models[0].model,'fixture-renamed');
			await store.setCollectionPaused(true); assert.equal((await store.getSnapshot('all')).collection.paused,true);
		})().catch(e=>{console.error(e);process.exitCode=1});`;
	try {
		execFileSync(process.execPath, ["-e", worker, "unused", JSON.stringify([row("saved"), row("new")])], { cwd: process.cwd(), env: { ...process.env, OBSERVATORY_DATA_DIR: dir }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 10000 });
	} finally { await rm(dir, { recursive: true, force: true }); }
});

test("durable archive retains history across process exit, paused writes and offline catch-up without duplicates", async () => {
	const { execFileSync } = require("node:child_process");
	const dir = await mkdtemp(join(tmpdir(), "observatory-archive-"));
	const database = join(dir, "history.sqlite"), log = join(dir, "source.jsonl");
	const coverage = [{ id: "codex", name: "Codex", state: "connected", count: 0, latest: null, description: "fixture" }];
	const worker = `const fs=require('node:fs'),ts=require('typescript');
		require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,f);
		const {ObservationArchive}=require(process.argv[1]); const db=new ObservationArchive(process.argv[2]);
		const rows=fs.readFileSync(process.argv[3],'utf8').trim().split('\\n').map(JSON.parse);
		db.commit(rows,JSON.parse(process.argv[4])); console.log(JSON.stringify({state:db.state(),rows:db.read().observations})); db.close();`;
	const collectInNewProcess = () => JSON.parse(execFileSync(process.execPath, ["-e", worker, require.resolve("../src/lib/observatory/archive.ts"), database, log, JSON.stringify(coverage)], { cwd: process.cwd(), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
	let db;
	try {
		await writeFile(log, JSON.stringify(row("first")) + "\n");
		assert.equal(collectInNewProcess().state.observations, 1);
		// The collector process is gone; the harness continues writing its own log.
		await appendFile(log, JSON.stringify(row("offline")) + "\n");
		assert.equal(collectInNewProcess().state.observations, 2);
		assert.equal(collectInNewProcess().state.observations, 2);
		db = new ObservationArchive(database);
		db.setPaused(true);
		await appendFile(log, JSON.stringify(row("paused")) + "\n");
		const paused = collectInNewProcess();
		assert.equal(paused.state.paused, true);
		assert.equal(paused.state.observations, 2);
		db.setPaused(false);
		assert.equal(collectInNewProcess().state.observations, 3);
		const revised = row("first", { output: 200 });
		db.commit([revised], coverage);
		db.commit([row("first")], coverage);
		assert.equal(db.state().observations, 3);
		assert.equal(db.read().observations.find((r) => r.id === "first").output, 200);
		await rm(log);
		db.commit([], [{ ...coverage[0], state: "error" }]);
		assert.equal(db.read().observations.length, 3);
		assert.equal(db.read().coverage[0].state, "error");
		assert.equal(db.read().coverage[0].count, 3);
	} finally { db?.close(); await rm(dir, { recursive: true, force: true }); }
});

test("DSH plaintext changes reparse appended calls, same-size rewrites and truncated step clocks", async () => {
	const dir = await mkdtemp(join(tmpdir(), "observatory-dsh-"));
	const file = join(dir, "session.jsonl");
	const message = (turn, output) => ({ type: "assistant/message", time: turn * 2000, data: { turn, step: 0, message: { source: { provider: "native", model: "deepseek-flash" } }, usage: { inputTokens: 10, cacheReadTokens: 5, outputTokens: output } } });
	const encode = (...rows) => rows.map((r) => JSON.stringify(r) + "\n").join("");
	const start = (turn) => ({ type: "step/start", time: turn * 2000 - 1000, data: { turn, step: 0 } });
	try {
		await writeFile(file, encode(start(1), message(1, 3)));
		const first = await readDshSessionFile(file);
		assert.equal(first.length, 1);
		assert.equal(first[0].inputTokens, 15);
		await appendFile(file, encode(start(2), message(2, 4)));
		const appended = await readDshSessionFile(file);
		assert.equal(appended.length, 2);
		assert.deepEqual(appended.map((r) => r.sequence), [0, 1]);
		assert.equal(appended[0].sequence, first[0].sequence);
		assert.equal(appended[1].durationMs, 1000);
		await writeFile(file, encode(message(1, 5)));
		const truncated = await readDshSessionFile(file);
		assert.equal(truncated.length, 1);
		assert.equal(truncated[0].durationMs, undefined);
		await writeFile(file, encode(message(1, 6)));
		await utimes(file, new Date(), new Date(Date.now() + 2000));
		const rewritten = await readDshSessionFile(file);
		assert.equal(rewritten.length, 1);
		assert.equal(rewritten[0].outputTokens, 6);
	} finally { await rm(dir, { recursive: true, force: true }); }
});

test("DSH compressed frames append without losing earlier calls or step timing", async () => {
	const { zstdCompressSync } = require("node:zlib");
	const dir = await mkdtemp(join(tmpdir(), "observatory-dsh-zstd-"));
	const file = join(dir, "session.jsonl.zstd");
	const frame = (turn) => zstdCompressSync(Buffer.from([
		{ type: "step/start", time: turn * 2000 - 1000, data: { turn, step: 0 } },
		{ type: "assistant/message", time: turn * 2000, data: { turn, step: 0, message: { source: { model: "deepseek-flash" } }, usage: { inputTokens: 7, outputTokens: turn } } },
	].map((r) => JSON.stringify(r) + "\n").join("")));
	try {
		await writeFile(file, frame(1));
		assert.equal((await readDshSessionFile(file)).length, 1);
		await appendFile(file, frame(2));
		const events = await readDshSessionFile(file);
		assert.deepEqual(events.map((e) => e.outputTokens), [1, 2]);
		assert.equal(events[1].durationMs, 1000);
		await writeFile(file, frame(3));
		await utimes(file, new Date(), new Date(Date.now() + 2000));
		assert.deepEqual((await readDshSessionFile(file)).map((e) => e.outputTokens), [3]);
	} finally { await rm(dir, { recursive: true, force: true }); }
});

test("usage coverage distinguishes missing values, known zero and partial reports", () => {
	const unknown = row("unknown", { rawModel: "unknown-usage", input: null, output: null, cache: null });
	const zero = row("zero", { rawModel: "known-zero", input: 0, output: 0, cache: 0 });
	const partial = row("partial", { rawModel: "partial-usage", input: 100, output: null, cache: null });
	const snapshot = makeSnapshot([unknown, zero, partial], [], "all", {}, now);
	const missing = snapshot.models.find((m) => m.model === "unknown-usage");
	const known = snapshot.models.find((m) => m.model === "known-zero");
	const incomplete = snapshot.models.find((m) => m.model === "partial-usage");
	assert.equal(missing.inputRequests + missing.outputRequests + missing.cacheRequests, 0);
	assert.equal(known.tokenRequests, 1);
	assert.equal(known.input + known.output, 0);
	assert.equal(incomplete.inputRequests, 1);
	assert.equal(incomplete.outputRequests, 0);
	assert.equal(incomplete.tokenRequests, 0);
	assert.equal(snapshot.totals.input, 100);
	assert.equal(snapshot.totals.tokenRequests, 1);
	assert.equal(snapshot.totals.inputRequests, 2);
});

test("the same specific model crosses tools and routes without splitting", () => {
	const s = makeSnapshot([row("a"), row("b", { client: "pi", rawModel: "openai/gpt-6.1-sol" }), row("c", { client: "ZCode" })], [], "today", {}, now);
	assert.equal(s.models.length, 1);
	assert.equal(s.models[0].requests, 3);
	assert.equal(s.models[0].clients.length, 3);
	assert.equal(s.totals.input + s.totals.output, 3300);
});
test("versions, variants and unknown namespaces never collapse into a family", () => {
	assert.notEqual(normalizeModel("deepseek-v4-flash"), normalizeModel("deepseek-v4.1-flash"));
	assert.notEqual(normalizeModel("deepseek-v4-flash"), normalizeModel("deepseek-v4-flash-fast"));
	assert.equal(normalizeModel("commandcode/deepseek/deepseek-v4-flash"), "deepseek-v4-flash");
	assert.equal(normalizeModel("unverified/name"), "unverified/name");
	assert.equal(normalizeModel("constructor"), "constructor");
});
test("explicit alias mapping is reversible and retains raw evidence", () => {
	const observations = [row("a", { rawModel: "friendly-alias" }), row("b")];
	const mapped = makeSnapshot(observations, [], "all", { "friendly-alias": "gpt-6.1-sol" }, now);
	assert.equal(mapped.models.length, 1);
	assert.ok(mapped.models[0].aliases.includes("friendly-alias"));
	assert.equal(makeSnapshot(observations, [], "all", {}, now).models.length, 2);
});
test("one session and one router observation become one call with two pieces of evidence", () => {
	const result = reconcile([row("a"), route("r")]);
	assert.equal(result.events.length, 1);
	assert.equal(result.events[0].evidence.length, 2);
	assert.equal(result.events[0].client, "Codex");
	assert.equal(result.merged, 1);
});
test("two identical calls from one reader are two calls", () => {
	assert.equal(reconcile([row("a"), row("b")]).events.length, 2);
});
test("ambiguous matches are held for review rather than guessed or added twice", () => {
	const result = reconcile([row("a"), row("b"), route("r")]);
	assert.equal(result.events.length, 2);
	assert.equal(result.pending.length, 1);
});
test("one native observation cannot swallow two independent routed calls", () => {
	assert.equal(reconcile([row("a"), route("r1"), route("r2")]).events.length, 2);
});
test("different token usage and distant timestamps never match", () => {
	assert.equal(reconcile([row("a"), route("r", { input: 999 })]).events.length, 2);
	assert.equal(reconcile([row("a"), route("r", { at: "2026-10-14T05:01:00Z" })]).events.length, 2);
});
test("stable ids are idempotent and later message usage replaces earlier usage", () => {
	const result = reconcile([row("a", { requestId: "response-1", output: 5 }), row("b", { requestId: "response-1", output: 20 })]);
	assert.equal(result.events.length, 1);
	assert.equal(result.events[0].output, 20);
});
test("a time window stays cached until a record enters or leaves it", () => {
	const at = Date.parse("2026-10-14T05:00:00.000Z");
	const events = [row("a", { at: new Date(at).toISOString() })];
	const times = eventTimes(events);
	const day = 86_400_000;
	assert.equal(makeSnapshot(events, [], "24h", {}, at + day, { events, pending: [], merged: 0, times }).totals.requests, 1);
	assert.equal(makeSnapshot(events, [], "24h", {}, at + day + 1).totals.requests, 0);
	assert.equal(nextSnapshotChange("24h", at + day - 1000, events, times), at + day + 1);
	const future = [row("future", { at: new Date(at + 5000).toISOString() })];
	assert.equal(nextSnapshotChange("all", at, future, eventTimes(future)), at + 5000);
	assert.ok(nextSnapshotChange("today", now, events, times) > now);
});
test("missing usage stays unknown and never creates known zero usage", () => {
	const s = makeSnapshot([row("a", { input: null, output: null, cache: null })], [], "all", {}, now);
	assert.equal(s.totals.requests, 1);
	assert.equal(s.totals.tokenRequests, 0);
	assert.equal(s.requests[0].input, null);
});
test("today follows Shanghai midnight; unknown times appear only in all history", () => {
	const s = makeSnapshot([row("a", { at: "2026-10-13T17:00:00Z" }), row("b", { at: "2026-10-13T15:59:00Z" }), row("c", { timeKnown: false })], [], "today", {}, now);
	assert.equal(s.totals.requests, 1);
	assert.equal(s.since, "2026-10-13T16:00:00.000Z");
	assert.equal(makeSnapshot([row("c", { timeKnown: false })], [], "all", {}, now).totals.requests, 1);
});
test("model and chart totals conserve the counted request ledger", () => {
	const s = makeSnapshot([row("a"), row("b", { rawModel: "glm-5.3-flash" }), route("r")], [], "today", {}, now);
	assert.equal(s.models.reduce((n, m) => n + m.requests, 0), s.totals.requests);
	assert.equal(s.activity.reduce((n, m) => n + m.requests, 0), s.totals.requests);
});
test("live JSONL supports append, partial UTF-8 lines, malformed lines and truncation", async () => {
	const dir = await mkdtemp(join(tmpdir(), "observatory-test-"));
	try {
		const path = join(dir, "events.jsonl");
		const scan = () => scanJsonl(path, "fixture", () => ({}), (record) => [record.n]);
		await writeFile(path, '{"n":1}\n{"n":');
		assert.deepEqual(await scan(), [1]);
		await appendFile(path, '"中文"}\ninvalid\n{"n":2}\n');
		assert.deepEqual(await scan(), [1, "中文", 2]);
		assert.deepEqual(await scan(), [1, "中文", 2]);
		await writeFile(path, '{"n":3}\n');
		assert.deepEqual(await scan(), [3]);
	} finally { await rm(dir, { recursive: true }); }
});

test("committed JSONL keeps its cursor and returns only rows appended afterward", async () => {
	const dir = await mkdtemp(join(tmpdir(), "observatory-jsonl-release-"));
	try {
		const path = join(dir, "events.jsonl");
		const scan = () => scanJsonl(path, "release-fixture", () => ({}), (record) => [record.n]);
		await writeFile(path, '{"n":1}\n');
		assert.deepEqual(await scan(), [1]);
		await releaseCommittedJsonl("release-fixture");
		assert.deepEqual(await scan(), []);
		await appendFile(path, '{"n":2}\n');
		assert.deepEqual(await scan(), [2]);
		await rm(path);
		await releaseCommittedJsonl("release-fixture");
		await writeFile(path, '{"n":3}\n');
		assert.deepEqual(await scan(), [3]);
	} finally { await rm(dir, { recursive: true, force: true }); }
});
test("multi-megabyte incomplete JSONL lines and replacement by a larger file preserve exact records", async () => {
	const dir = await mkdtemp(join(tmpdir(), "observatory-large-line-"));
	const file = join(dir, "events.jsonl"), replacement = join(dir, "replacement.jsonl");
	const scan = () => scanJsonl(file, "large-line-fixture", () => ({}), (r) => [r.n]);
	try {
		await writeFile(file, '{"n":1,"text":"' + "x".repeat(4 * 1024 * 1024));
		assert.deepEqual(await scan(), []);
		await appendFile(file, '中文"}\n{"n":2}\n');
		assert.deepEqual(await scan(), [1, 2]);
		await writeFile(replacement, JSON.stringify({ n: 3, text: "y".repeat(5 * 1024 * 1024) }) + '\n');
		await rename(replacement, file);
		assert.deepEqual(await scan(), [3]);
	} finally { await rm(dir, { recursive: true, force: true }); }
});
const { DatabaseSync } = require("node:sqlite");
const { readCursor } = require("../src/lib/observatory/sources/cursor.ts");

function cursorFixture(path) {
	const db = new DatabaseSync(path);
	db.exec("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE cursorDiskKV(key TEXT PRIMARY KEY,value BLOB); CREATE TABLE ItemTable(key TEXT PRIMARY KEY,value BLOB)");
	const put = db.prepare("INSERT OR REPLACE INTO cursorDiskKV VALUES (?,?)");
	const bubble = (composer, id, fields) => put.run(`bubbleId:${composer}:${id}`, Buffer.from(JSON.stringify({ bubbleId: id, tokenCount: { inputTokens: 0, outputTokens: 0 }, createdAt: "2026-10-14T05:00:00Z", ...fields })));
	const headers = (composer, ids) => put.run(`composerData:${composer}`, JSON.stringify({ modelConfig: { modelName: "latest-model-must-not-backfill-history" }, fullConversationHeadersOnly: ids.map((bubbleId) => ({ bubbleId })) }));
	return { db, bubble, headers };
}

test("Cursor counts responding request IDs once across chunks and forks, with explicit turn scope and unknown usage", async () => {
	const dir = await mkdtemp(join(tmpdir(), "observatory-cursor-")), path = join(dir, "state.vscdb");
	const { db, bubble, headers } = cursorFixture(path);
	try {
		bubble("original", "human-a", { type: 1, requestId: "request-a", modelInfo: { modelName: "grok-4.7" }, text: "private-prompt-never-export" });
		bubble("original", "response-a", { type: 2, text: "private-answer-never-export" });
		bubble("original", "thinking-a", { type: 2, tokenCount: { inputTokens: 1000, outputTokens: 50 } });
		bubble("original", "human-b", { type: 1, requestId: "request-b", modelInfo: { modelName: "grok-4.8" } });
		bubble("original", "response-b", { type: 2 });
		headers("original", ["human-a", "response-a", "thinking-a", "human-b", "response-b"]);
		bubble("fork", "human-a", { type: 1, requestId: "request-a" });
		bubble("fork", "response-a", { type: 2 });
		headers("fork", ["human-a", "response-a"]);
		db.prepare("INSERT INTO ItemTable VALUES (?,?)").run("secret-auth", "private-token-never-export");
		const rows = await readCursor(path);
		assert.equal(rows.length, 2);
		assert.deepEqual(rows.map((r) => r.rawModel).sort(), ["grok-4.7", "grok-4.8"]);
		assert.ok(rows.every((r) => r.scope === "turn" && r.identity === "configured" && r.input === null && r.output === null && r.cache === null && r.status === "unknown"));
		assert.ok(!JSON.stringify(rows).includes("private-"));
		assert.deepEqual(await readCursor(path), rows);
		const snapshot = makeSnapshot(rows, [], "all", {}, now);
		assert.equal(snapshot.totals.requests, 2);
		assert.equal(snapshot.totals.turnRequests, 2);
		assert.equal(snapshot.totals.tokenRequests, 0);
		assert.equal(snapshot.models.reduce((n, m) => n + m.turnRequests, 0), 2);
	} finally { db.close(); await rm(dir, { recursive: true, force: true }); }
});

test("Cursor skips drafts and simulated turns, never uses a composer's current model to fill historical gaps", async () => {
	const dir = await mkdtemp(join(tmpdir(), "observatory-cursor-boundaries-")), path = join(dir, "state.vscdb");
	const { db, bubble, headers } = cursorFixture(path);
	try {
		bubble("a", "unknown-human", { type: 1, requestId: "unknown-model" });
		bubble("a", "unknown-response", { type: 2 });
		bubble("a", "simulated-human", { type: 1, requestId: "simulated", isSimulatedMsg: true, modelInfo: { modelName: "grok-4.7" } });
		bubble("a", "simulated-response", { type: 2 });
		bubble("a", "draft-human", { type: 1, requestId: "draft", modelInfo: { modelName: "grok-4.7" } });
		headers("a", ["unknown-human", "unknown-response", "simulated-human", "simulated-response", "draft-human"]);
		bubble("invalid-date", "bad-human", { type: 1, requestId: "bad-date", createdAt: "invalid" });
		bubble("invalid-date", "bad-response", { type: 2 });
		db.prepare("INSERT INTO cursorDiskKV VALUES (?,?)").run("bubbleId:invalid:broken", "{broken");
		const rows = await readCursor(path);
		assert.equal(rows.length, 1);
		assert.equal(rows[0].requestId, "unknown-model");
		assert.equal(rows[0].rawModel, "unknown");
		assert.deepEqual(await readCursor(join(dir, "missing.vscdb")), []);
	} finally { db.close(); await rm(dir, { recursive: true, force: true }); }
});

test("Cursor notices WAL-only updates, preserves IDs and retains history after source removal", async () => {
	const dir = await mkdtemp(join(tmpdir(), "observatory-cursor-wal-")), path = join(dir, "state.vscdb");
	const { db, bubble, headers } = cursorFixture(path);
	let archive;
	try {
		bubble("a", "h1", { type: 1, requestId: "one", modelInfo: { modelName: "grok-4.7" } });
		bubble("a", "r1", { type: 2 });
		headers("a", ["h1", "r1"]);
		const first = await readCursor(path);
		const disk = require("node:fs").statSync(path);
		bubble("a", "h2", { type: 1, requestId: "two", modelInfo: { modelName: "grok-4.7" } });
		bubble("a", "r2", { type: 2 });
		headers("a", ["h1", "r1", "h2", "r2"]);
		await utimes(path + "-wal", new Date(), new Date(Date.now() + 2000));
		const second = await readCursor(path);
		assert.equal(require("node:fs").statSync(path).mtimeMs, disk.mtimeMs);
		assert.equal(second.length, 2);
		assert.equal(second.find((r) => r.requestId === "one").id, first[0].id);
		archive = new ObservationArchive(join(dir, "history.sqlite"));
		const coverage = [{ id: "cursor", name: "Cursor", state: "connected", count: 2, latest: null, description: "fixture" }];
		archive.commit(second, coverage);
		archive.commit(second, coverage);
		assert.equal(archive.state().observations, 2);
		db.close();
		await rm(path);
		assert.deepEqual(await readCursor(path), []);
		archive.commit([], [{ ...coverage[0], state: "empty" }]);
		assert.equal(archive.read().coverage[0].count, 2);
	} finally { try { db.close(); } catch {} archive?.close(); await rm(dir, { recursive: true, force: true }); }
});
