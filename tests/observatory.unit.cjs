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
const { timeBounds, validCustomDates } = require("../src/lib/observatory/time-range.ts");
const { scanJsonl, releaseCommittedJsonl } = require("../src/lib/observatory/jsonl.ts");
const { discardCodexPrefix } = require("../src/lib/observatory/readers.ts");
const { readDshSessionFile, releaseCommittedDsh } = require("../src/lib/observatory/sources/dsh.ts");
const { ObservationArchive } = require("../src/lib/observatory/archive.ts");
const now = Date.parse("2026-10-14T06:00:00Z");
const row = (id, changes = {}) => ({ id, at: "2026-10-14T05:00:00Z", model: "gpt-6.1-sol", rawModel: "gpt-6.1-sol", client: "Codex", upstream: "未记录", input: 1000, output: 100, cache: 500, status: "unknown", duration: null, identity: "reported", evidence: [{ id, source: "codex", kind: "session" }], ...changes });
const route = (id, changes = {}) => row(id, { rawModel: "openai/gpt-6.1-sol", client: "未识别工具", upstream: "openai", evidence: [{ id, source: "router", kind: "router" }], ...changes });

test("Codex discards only recognized non-usage envelopes and resumes after split, long and rotated lines", async () => {
	for (const prefix of ['{"type":"response_item","payload":', '{"timestamp":"2026-10-18","type":"response_item",', '{"type":"event_msg","payload":{"type":"agent_message",']) assert.equal(discardCodexPrefix(prefix), true);
	for (const prefix of ['{"type":"event_msg","payload":{"type":"token_count",', '{"type":"session_meta",', '{"type":"turn_context",', '{"unknown":{},"type":"response_item",', '{"payload":{"type":"response_item"},"type":"event_msg"}', '{"type":"new_record_type"}', '{"type":"event_msg","payload":{"unknown":1,"type":"token_count"}}']) assert.equal(discardCodexPrefix(prefix), false);
	const dir = await mkdtemp(join(tmpdir(), "observatory-prefix-")), path = join(dir, "log.jsonl"), ns = `observatory-prefix-${dir}`;
	const parsed = [];
	const read = () => scanJsonl(path, ns, () => ({}), (value, _state, ordinal) => { parsed.push(value.type); return [{ ordinal, value }]; }, undefined, (prefix) => { assert.ok(Buffer.byteLength(prefix) <= 514); return discardCodexPrefix(prefix); });
	const wanted = { type: "event_msg", payload: { type: "token_count", value: "用量" } };
	try {
		await writeFile(path, '{"type":"res');
		assert.deepEqual(await read(), []);
		await appendFile(path, 'ponse_item","payload":{"text":"' + "x".repeat(3 * 1024 * 1024));
		assert.deepEqual(await read(), []);
		await releaseCommittedJsonl(ns);
		await appendFile(path, '"}}\n' + JSON.stringify(wanted) + '\n');
		assert.deepEqual(await read(), [{ ordinal: 0, value: wanted }]);
		assert.deepEqual(parsed, ["event_msg"]);
		await releaseCommittedJsonl(ns);
		const reordered = { payload: { type: "token_count" }, type: "event_msg" };
		await appendFile(path, JSON.stringify(reordered) + '\n');
		assert.deepEqual(await read(), [{ ordinal: 1, value: reordered }]);
		await appendFile(path, '{"type":"response_item","payload":"pending');
		await read();
		await writeFile(path, JSON.stringify(wanted) + '\n');
		assert.deepEqual(await read(), [{ ordinal: 0, value: wanted }]);
	} finally { await rm(dir, { recursive: true, force: true }); await releaseCommittedJsonl(ns); }
});

test("calendar ranges use Beijing Monday/month boundaries and expire at rollover", () => {
	const sunday = Date.parse("2026-11-01T15:59:59.999Z"), monday = sunday + 1;
	assert.equal(new Date(timeBounds("week", sunday).since).toISOString(), "2026-10-25T16:00:00.000Z");
	assert.equal(new Date(timeBounds("week", monday).since).toISOString(), "2026-11-01T16:00:00.000Z");
	assert.equal(new Date(timeBounds("month", sunday).since).toISOString(), "2026-10-31T16:00:00.000Z");
	assert.equal(timeBounds("month", Date.parse("2026-10-31T15:59:59Z")).until, Date.parse("2026-10-31T16:00:00Z"));
	for (const range of ["week", "month"]) {
		const bounds = timeBounds(range, sunday);
		const rows = [row("before", { at: new Date(bounds.since - 1).toISOString() }), row("start", { at: new Date(bounds.since).toISOString() }), row("current", { at: new Date(sunday).toISOString() }), row("future", { at: new Date(sunday + 1).toISOString() }), row("unknown", { timeKnown: false })];
		assert.deepEqual(makeSnapshot(rows, [], range, {}, sunday).requests.map((r) => r.id), ["current", "start"]);
		assert.equal(nextSnapshotChange(range, sunday, [], new Float64Array()), bounds.until);
	}
});

test("custom dates include both days, exclude unknown/future time and bound activity", () => {
	for (const dates of [{ from: "2026-02-30", to: "2026-03-01" }, { from: "2026-10-15", to: "2026-10-14" }, { from: "", to: "2026-10-14" }]) assert.equal(validCustomDates(dates), false);
	assert.equal(validCustomDates({ from: "2024-02-29", to: "2024-02-29" }), true);
	const dates = { from: "2026-10-12", to: "2026-10-13" };
	const rows = [row("before", { at: "2026-10-11T15:59:59.999Z" }), row("first", { at: "2026-10-11T16:00:00Z" }), row("last", { at: "2026-10-13T15:59:59.999Z" }), row("after", { at: "2026-10-13T16:00:00Z" }), row("unknown", { timeKnown: false })];
	const prepared = reconcile(rows), times = eventTimes(prepared.events);
	const snapshot = makeSnapshot(rows, [], "custom", {}, now, { ...prepared, times }, dates);
	assert.deepEqual(snapshot.requests.map((r) => r.id), ["first", "last"]);
	assert.equal(snapshot.until, "2026-10-13T16:00:00.000Z");
	assert.equal(snapshot.activity.reduce((n, p) => n + p.requests, 0), 2);
	assert.ok(snapshot.activity.every((p) => p.at < snapshot.until));
	assert.equal(nextSnapshotChange("custom", now, rows, eventTimes(rows), dates), Infinity);
	assert.equal(makeSnapshot(rows, [], "custom", {}, Date.parse("2026-10-12T00:00:00Z"), undefined, dates).totals.requests, 1);
	assert.ok(makeSnapshot(rows, [], "custom", {}, now, undefined, { from: "1900-01-01", to: "9999-12-31" }).activity.length <= 121);
});

test("activity model details conserve reconciled usage, preserve unknowns and respect time buckets", () => {
	const observations = [row("a"), route("mirror"), row("b", { at: "2026-10-14T05:10:00Z", input: null, output: 20, cache: null }), row("unknown", { model: "other-v2", rawModel: "other-v2", input: null, output: null, cache: null }), row("zero", { model: "other-v1", rawModel: "other-v1", input: 0, output: 0, cache: 0 }), row("next", { at: "2026-10-14T06:00:00Z" }), row("untimed", { timeKnown: false })];
	const snapshot = makeSnapshot(observations, [], "today", {}, now);
	const point = snapshot.activity.find((p) => p.at === "2026-10-14T05:00:00.000Z");
	assert.equal(point.until, "2026-10-14T06:00:00.000Z");
	assert.equal(point.requests, 4);
	assert.equal(point.tokens, 1120, "cache and mirrored evidence must not add to input + output");
	assert.equal(point.models.length, 3, "concrete model versions remain separate");
	assert.deepEqual(point.models.find((m) => m.model === "gpt-6.1-sol"), { model: "gpt-6.1-sol", requests: 2, input: 1000, output: 120, cache: 500, inputRequests: 1, outputRequests: 2, cacheRequests: 1, tokenRequests: 1 });
	assert.equal(point.models.find((m) => m.model === "other-v2").tokenRequests, 0);
	assert.equal(point.models.find((m) => m.model === "other-v1").tokenRequests, 1, "reported zero is known usage");
	for (const p of snapshot.activity) {
		assert.equal(p.models.reduce((sum, m) => sum + m.requests, 0), p.requests);
		assert.equal(p.models.reduce((sum, m) => sum + m.input + m.output, 0), p.tokens);
		assert.ok(p.until > p.at);
	}
	assert.equal(snapshot.activity.at(-1).requests, 1, "a boundary request belongs to the next period");
	assert.equal(snapshot.activity[0].models.length, 0);
	const custom = makeSnapshot(observations, [], "custom", {}, now, undefined, { from: "2026-10-01", to: "2026-10-14" });
	assert.ok(custom.activity.every((p) => p.at >= custom.since && p.until <= custom.until));
});

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
		const revision = archive.revision;
		archive.commit([row("a"), row("b")], []);
		assert.equal(archive.read(), old, "Unchanged SQLite metadata must not rebuild the ledger");
		assert.equal(archive.revision, revision);
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

test("reopened archives share bounded metadata without changing names or immutable evidence", async () => {
	const dir = await mkdtemp(join(tmpdir(), "observatory-metadata-"));
	const file = join(dir, "history.sqlite");
	const rows = Array.from({ length: 2200 }, (_, index) => row(`metadata-${index}`, {
		model: `模型-${index}`, rawModel: `模型-${index}`, client: `工具-${index}`, upstream: "共享路由",
		evidence: [{ id: `metadata-${index}`, source: "共享来源", kind: "session" }],
	}));
	let archive = new ObservationArchive(file);
	try {
		archive.commit(rows, []); archive.close();
		archive = new ObservationArchive(file);
		const loaded = archive.read().observations;
		assert.deepEqual(loaded, rows);
		assert.ok(archive.strings.size <= 2048, "Unique metadata must not grow the shared-string pool without a bound");
		assert.ok(loaded.every((event) => Object.isFrozen(event) && Object.isFrozen(event.evidence) && Object.isFrozen(event.evidence[0])));
		archive.commit([row("metadata-0", { model: "修订模型", rawModel: "修订模型", output: 999 })], []);
		assert.equal(loaded[0].model, "模型-0");
		assert.equal(archive.read().observations[0].model, "修订模型");
	} finally { archive.close(); await rm(dir, { recursive: true, force: true }); }
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

test("compact reconciliation preserves revisions, unique ownership and ambiguity in large usage buckets", () => {
	const native = Array.from({ length: 5000 }, (_, index) => row(`same-usage-${index}`, { at: new Date(now - index * 60000).toISOString() }));
	const revised = row("revision-new-id", { requestId: "stream", output: 400 });
	const rows = [...native, row("revision-first", { requestId: "stream", output: 200 }), revised,
		route("unique", { at: native[2500].at }), route("used", { at: native[2500].at }),
		row("ambiguous-a"), row("ambiguous-b"), route("ambiguous"),
		route("revision-owner", { output: 400 }), route("missing", { output: null })];
	const before = JSON.stringify(rows);
	const result = reconcile(rows);
	assert.equal(result.merged, 3);
	assert.deepEqual(result.pending.map((r) => r.id), ["ambiguous"]);
	assert.equal(result.events.find((r) => r.id === native[2500].id).evidence[1].id, "unique");
	assert.ok(result.events.some((r) => r.id === "used"));
	assert.ok(result.events.some((r) => r.id === "missing"));
	assert.equal(result.events.find((r) => r.requestId === "stream").evidence[1].id, "revision-owner");
	assert.equal(JSON.stringify(rows), before);
});

test("archive coverage counts each evidence source once, including shared event ownership", async () => {
	const dir = await mkdtemp(join(tmpdir(), "observatory-coverage-"));
	const archive = new ObservationArchive(join(dir, "history.sqlite"));
	try {
		archive.commit([row("multi", { evidence: [
			{ id: "a", source: "codex", kind: "session" }, { id: "b", source: "codex", kind: "session" },
			{ id: "c", source: "event:a", kind: "event" }, { id: "d", source: "event:b", kind: "event" },
			{ id: "e", source: "router", kind: "router" },
		] })], ["codex", "events", "router"].map((id) => ({ id, name: id, state: "empty", count: 0, latest: null, description: "fixture" })));
		assert.deepEqual(archive.read().coverage.map((r) => [r.id, r.count, r.state]), [["codex", 1, "connected"], ["events", 1, "connected"], ["router", 1, "connected"]]);
	} finally { archive.close(); await rm(dir, { recursive: true, force: true }); }
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
			const day={from:'2026-10-14',to:'2026-10-14'}, empty={from:'2026-10-01',to:'2026-10-01'};
			assert.equal((await store.getSnapshot('custom',day)).totals.requests,2);
			assert.equal((await store.getSnapshot('custom',empty)).totals.requests,0);
			assert.equal((await store.getSnapshot('custom',day)).totals.requests,2,'Custom cache keys must include both dates');
			fs.writeFileSync(path.join(process.env.OBSERVATORY_DATA_DIR,'aliases.json'),JSON.stringify({'gpt-6.1-sol':'fixture-renamed'}));
			assert.equal((await store.getSnapshot('all')).models[0].model,'fixture-renamed');
			await store.setCollectionPaused(true); assert.equal((await store.getSnapshot('all')).collection.paused,true);
		})().catch(e=>{console.error(e);process.exitCode=1});`;
	try {
		execFileSync(process.execPath, ["-e", worker, "unused", JSON.stringify([row("saved"), row("new")])], { cwd: process.cwd(), env: { ...process.env, OBSERVATORY_DATA_DIR: dir }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 10000 });
	} finally { await rm(dir, { recursive: true, force: true }); }
});

test("UI polling never reschedules source scans; explicit collection and reopening still catch up", async () => {
	const { execFileSync } = require("node:child_process");
	const dir = await mkdtemp(join(tmpdir(), "observatory-schedule-"));
	const worker = `const fs=require('node:fs'),ts=require('typescript'),assert=require('node:assert/strict');
		require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,f);
		let scans=0; const rows=JSON.parse(process.argv[2]), now=Date.now;
		require('./src/lib/observatory/readers.ts').collectObservations=async()=>{scans++;return {observations:rows,coverage:[]}};
		const store=require('./src/lib/observatory/store.ts');
		(async()=>{try{
			await store.collectNow(true);
			assert.equal((await store.getSnapshot('all')).totals.requests,1);
			Date.now=()=>now()+5000;
			rows.push({...rows[0],id:'next',evidence:[{...rows[0].evidence[0],id:'next'}]});
			for(const range of ['all','today','week','all'])await store.getSnapshot(range);
			assert.equal(scans,1,'View polling and range changes must leave collection to the desktop timer');
			await store.collectNow();
			assert.equal(scans,2);assert.equal((await store.getSnapshot('all')).totals.requests,2);
			await store.closeCollection();
			Date.now=now;
			rows.push({...rows[0],id:'reopen',evidence:[{...rows[0].evidence[0],id:'reopen'}]});
			await store.getSnapshot('all');await store.collectNow();
			assert.equal(scans,3,'Reopening must not suppress cold catch-up');
			assert.equal((await store.getSnapshot('all')).totals.requests,3);
		}finally{Date.now=now;await store.closeCollection();}})().catch(e=>{console.error(e);process.exitCode=1});`;
	try {
		execFileSync(process.execPath, ["-e", worker, "unused", JSON.stringify([row("initial")])], { cwd: process.cwd(), env: { ...process.env, USERPROFILE: dir, HOME: dir, APPDATA: dir, OBSERVATORY_DATA_DIR: dir }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 10000 });
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

test("DSH releases committed plaintext and compressed records without reusing sequence IDs or losing pending data", async () => {
	const { zstdCompressSync } = require("node:zlib");
	const dir = await mkdtemp(join(tmpdir(), "observatory-dsh-release-"));
	const message = (turn) => JSON.stringify({ type: "assistant/message", time: turn * 2000, data: { turn, step: 0, usage: { inputTokens: 7, outputTokens: turn } } }) + "\n";
	try {
		for (const compressed of [false, true]) {
			const file = join(dir, compressed ? "session.jsonl.zstd" : "session.jsonl");
			const encode = (text) => compressed ? zstdCompressSync(Buffer.from(text)) : Buffer.from(text);
			const second = encode(message(2));
			await writeFile(file, Buffer.concat([encode(message(1)), second.subarray(0, 8)]));
			const first = await readDshSessionFile(file);
			assert.deepEqual(first.map((r) => r.sequence), [0]);
			releaseCommittedDsh();
			assert.deepEqual(await readDshSessionFile(file), []);
			await appendFile(file, second.subarray(8));
			const appended = await readDshSessionFile(file);
			assert.deepEqual(appended.map((r) => r.sequence), [1]);
			assert.equal(appended[0].outputTokens, 2);
			assert.equal(first.length, 1, "Published arrays remain unchanged");
			assert.equal(first[0].sequence, 0);
			releaseCommittedDsh();
			await writeFile(file, encode(message(3)));
			await utimes(file, new Date(), new Date(Date.now() + 2000));
			assert.deepEqual((await readDshSessionFile(file)).map((r) => [r.sequence, r.outputTokens]), [[0, 3]]);
		}
	} finally { await rm(dir, { recursive: true, force: true }); }
});

test("DSH waits for an incomplete Zstandard checksum before decoding the next frame", async () => {
	const { zstdCompressSync, constants } = require("node:zlib");
	const dir = await mkdtemp(join(tmpdir(), "observatory-dsh-checksum-"));
	const file = join(dir, "session.jsonl.zstd");
	const frame = (turn) => zstdCompressSync(Buffer.from(JSON.stringify({ type: "assistant/message", time: turn * 2000, data: { usage: { outputTokens: turn } } }) + "\n"), { params: { [constants.ZSTD_c_checksumFlag]: 1 } });
	try {
		const first = frame(1), second = frame(2);
		await writeFile(file, Buffer.concat([first, second.subarray(0, second.length - 1)]));
		assert.deepEqual((await readDshSessionFile(file)).map((r) => r.outputTokens), [1]);
		await appendFile(file, second.subarray(-1));
		assert.deepEqual((await readDshSessionFile(file)).map((r) => r.outputTokens), [1, 2]);
	} finally { await rm(dir, { recursive: true, force: true }); }
});

test("collectors retain large single-file histories and SQLite token semantics across incremental polls", async () => {
	const { execFileSync } = require("node:child_process");
	const dir = await mkdtemp(join(tmpdir(), "observatory-reader-volume-"));
	const worker = `const fs=require('node:fs'),path=require('node:path'),ts=require('typescript'),assert=require('node:assert/strict'),{DatabaseSync}=require('node:sqlite');
		require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,f);
		const home=process.env.HOME;
		const grok=path.join(home,'.grok','sessions','fixture','chat_history.jsonl');fs.mkdirSync(path.dirname(grok),{recursive:true});
		fs.writeFileSync(grok,(JSON.stringify({type:'assistant',model_id:'grok-fixture'})+'\\n').repeat(140000));
		const setup=(name,sql)=>{const file=path.join(home,...name);fs.mkdirSync(path.dirname(file),{recursive:true});const db=new DatabaseSync(file);try{db.exec(sql);}finally{db.close();}};
		setup(['.zcode','cli','db','db.sqlite'],"CREATE TABLE model_usage(id,model_id,provider_id,status,started_at,duration_ms,input_tokens,output_tokens,cache_read_input_tokens);INSERT INTO model_usage VALUES('z','z-model','route','completed','2026-10-14T05:00:00Z',100,10,3,4)");
		setup(['.local','share','opencode','opencode.db'],\`CREATE TABLE message(id,data);INSERT INTO message VALUES('o','{"role":"assistant","modelID":"o-model","tokens":{"input":10,"output":3,"reasoning":2,"cache":{"read":4,"write":1}},"time":{"created":1000,"completed":2000}}')\`);
		(async()=>{
			const {collectObservations,releaseCommittedReaders}=require('./src/lib/observatory/readers.ts'),{releaseCommittedJsonl}=require('./src/lib/observatory/jsonl.ts');
			const initial=await collectObservations();assert.ok(!initial.coverage.some(r=>r.state==='error'));
			const grokRows=initial.observations.filter(r=>r.client==='Grok CLI');assert.equal(grokRows.length,140000);assert.equal(new Set(grokRows.map(r=>r.id)).size,140000);
			const z=initial.observations.find(r=>r.client==='ZCode'),o=initial.observations.find(r=>r.client==='OpenCode');
			assert.deepEqual([z.input,z.output,z.cache],[10,3,4]);assert.deepEqual([o.input,o.output,o.cache],[15,5,4]);
			assert.equal((await collectObservations()).observations.find(r=>r.client==='ZCode'),z);
			await releaseCommittedJsonl();releaseCommittedReaders();fs.appendFileSync(grok,JSON.stringify({type:'assistant',model_id:'grok-fixture'})+'\\n');
			const next=await collectObservations(),appended=next.observations.filter(r=>r.client==='Grok CLI');assert.equal(appended.length,1);assert.ok(!grokRows.some(r=>r.id===appended[0].id));assert.ok(!next.observations.some(r=>r.client==='ZCode'||r.client==='OpenCode'));
			const zdb=new DatabaseSync(path.join(home,'.zcode','cli','db','db.sqlite'));zdb.exec('UPDATE model_usage SET output_tokens=5');zdb.close();const stamp=new Date(Date.now()+2000);fs.utimesSync(path.join(home,'.zcode','cli','db','db.sqlite'),stamp,stamp);
			const revised=(await collectObservations()).observations.find(r=>r.client==='ZCode');assert.equal(revised.id,z.id);assert.equal(revised.output,5);
		})().catch(e=>{console.error(e);process.exitCode=1});`;
	try {
		execFileSync(process.execPath, ["-e", worker], { cwd: process.cwd(), env: { ...process.env, USERPROFILE: dir, HOME: dir, APPDATA: dir }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30000 });
	} catch (error) { throw new Error(error.stderr || error.message); }
	finally { await rm(dir, { recursive: true, force: true }); }
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

test("fallback JSONL IDs survive committed-row release and restart from the same ordinals on replay", async () => {
	const dir = await mkdtemp(join(tmpdir(), "observatory-jsonl-ordinal-"));
	const path = join(dir, "events.jsonl");
	const scan = () => scanJsonl(path, "ordinal-fixture", () => ({}), (r, _state, ordinal) => r.skip ? [] : [{ id: ordinal, value: r.n }]);
	try {
		await writeFile(path, '{"skip":true}\ninvalid\n{"n":1}\n{"n":');
		assert.deepEqual(await scan(), [{ id: 0, value: 1 }]);
		await releaseCommittedJsonl("ordinal-fixture");
		await appendFile(path, '2}\n{"n":3}\n');
		assert.deepEqual(await scan(), [{ id: 1, value: 2 }, { id: 2, value: 3 }]);
		await releaseCommittedJsonl("ordinal-fixture");
		await writeFile(path, '{"n":4}\n');
		assert.deepEqual(await scan(), [{ id: 0, value: 4 }]);
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

const { projectAttribution, sessionAttribution, mergeAttribution, normalizeProjectPath, makeAttributionSelection } = require("../src/lib/observatory/attribution.ts");
const withAttribution = (id, changes = {}) => row(id, {
	attribution: {
		project: projectAttribution({ source: "codex", id: "project-a" }),
		session: sessionAttribution({ source: "codex", client: "Codex", id: "session-a" }),
	},
	...changes,
});

test("attribution keys encode every tuple segment and isolate source-scoped IDs", () => {
	const projectA = projectAttribution({ source: "source:a", id: "b:c" }), projectB = projectAttribution({ source: "source", id: "a:b:c" });
	assert.notEqual(projectA.key, projectB.key);
	assert.notEqual(projectAttribution({ source: "one", id: "same" }).key, projectAttribution({ source: "two", id: "same" }).key);
	const sessions = [
		sessionAttribution({ source: "event:a", client: "b", id: "c" }),
		sessionAttribution({ source: "event", client: "a:b", id: "c" }),
		sessionAttribution({ source: "event:a", client: "a", id: "b:c" }),
		sessionAttribution({ source: "event:a", client: "b:c", id: "d" }),
	];
	assert.equal(new Set(sessions.map((value) => value.key)).size, sessions.length);
	assert.match(sessions[0].key, /^session:\[/);
});

test("project paths merge only proven separator/drive spellings and preserve POSIX backslashes", () => {
	assert.equal(normalizeProjectPath("C:\\work\\repo\\"), "C:/work/repo");
	assert.equal(normalizeProjectPath("c:/work/repo"), "C:/work/repo");
	assert.equal(normalizeProjectPath("\\\\server\\share\\repo"), "//server/share/repo");
	assert.equal(normalizeProjectPath("\\\\?\\UNC\\server\\share\\repo\\"), "//server/share/repo");
	assert.equal(normalizeProjectPath("\\\\?\\C:\\work\\repo"), "C:/work/repo");
	assert.equal(normalizeProjectPath("/tmp/a\\b"), "/tmp/a\\b");
	for (const value of ["\\\\.\\pipe\\fixture", "\\\\?\\Volume{fixture}\\", "\\\\?\\GLOBALROOT\\fixture", "relative/path", "C:relative", "\\\\server"]) assert.equal(normalizeProjectPath(value), null, value);
	const posixA = projectAttribution({ source: "one", path: "/tmp/a\\b" }), posixB = projectAttribution({ source: "two", path: "/tmp/a/b" });
	assert.notEqual(posixA.key, posixB.key);
	const windows = projectAttribution({ source: "one", path: "C:\\Repro" }), windowsOtherSource = projectAttribution({ source: "two", path: "c:/Repro/" });
	assert.equal(windows.key, windowsOtherSource.key);
	assert.notEqual(projectAttribution({ source: "one", path: "C:/Repo" }).key, windows.key, "Path case is not folded");
});

test("attribution merging fills missing evidence and retains contradictory known evidence", () => {
	const missing = projectAttribution({ source: "router", id: undefined });
	const known = projectAttribution({ source: "codex", id: "project-a" });
	assert.equal(mergeAttribution(missing, known).key, known.key);
	const changed = projectAttribution({ source: "codex", id: "project-b" });
	const conflict = mergeAttribution(known, changed);
	assert.equal(conflict.status, "conflict");
	assert.equal(conflict.key, null);
	assert.deepEqual(conflict.candidates.map((candidate) => candidate.id).sort(), ["project-a", "project-b"]);
	assert.equal(mergeAttribution(conflict, known).status, "conflict", "Later single evidence cannot erase a conflict");
});

test("reconciliation keeps newer usage while retaining ownership evidence from an older revision", () => {
	const first = withAttribution("same", { requestId: "stream", output: 300, attribution: {
		project: projectAttribution({ source: "codex", id: "project-a" }),
		session: sessionAttribution({ source: "codex", client: "Codex", id: "session-a" }),
	} });
	const older = withAttribution("older", { requestId: "stream", output: 100, attribution: {
		project: projectAttribution({ source: "router", id: "project-b" }),
		session: sessionAttribution({ source: "router", client: "Codex", id: "session-a" }),
	} });
	const result = reconcile([first, older]).events[0];
	assert.equal(result.output, 300);
	assert.equal(result.attribution.project.status, "conflict");
	assert.deepEqual(result.attribution.project.candidates.map((candidate) => candidate.id).sort(), ["project-a", "project-b"]);
});

test("archive lazily reloads ownership across cold start, empty deltas, external and restarted revisions", async () => {
	const dir = await mkdtemp(join(tmpdir(), "observatory-attribution-revision-")), file = join(dir, "history.sqlite");
	const seed = new ObservationArchive(file);
	try {
		seed.commit([withAttribution("same", { output: 300 }), withAttribution("other", { output: 50 })], []);
	} finally {
		seed.close();
	}
	const { DatabaseSync } = require("node:sqlite");
	const prepare = DatabaseSync.prototype.prepare;
	let attributionScans = 0;
	DatabaseSync.prototype.prepare = function (statement) {
		if (/json_extract\(\s*event\s*,\s*'\$\.attribution'\s*\)/.test(statement)) attributionScans++;
		return prepare.call(this, statement);
	};
	let archive, external, reopened;
	try {
		archive = new ObservationArchive(file);
		external = new ObservationArchive(file);
		assert.equal(archive.commit([], []), true);
		archive.commit([withAttribution("same", { output: 100, attribution: {
			project: projectAttribution({ source: "router", id: "project-b" }),
			session: sessionAttribution({ source: "router", client: "Codex", id: "session-a" }),
		} })], []);
		const published = archive.read(), same = published.observations.find((event) => event.id === "same");
		assert.equal(same.output, 300);
		assert.equal(same.attribution.project.status, "conflict");
		assert.deepEqual(same.attribution.project.candidates.map((candidate) => candidate.id).sort(), ["project-a", "project-b"]);
		assert.ok(Object.isFrozen(same) && Object.isFrozen(same.attribution) && Object.isFrozen(same.attribution.project));
		const immutable = JSON.stringify(published);
		assert.equal(archive.commit([], []), true);
		assert.equal(archive.read(), published, "An empty delta must not rebuild published observations");
		external.commit([withAttribution("other", { output: 500, attribution: {
			project: projectAttribution({ source: "third", id: "project-c" }),
			session: sessionAttribution({ source: "third", client: "Codex", id: "session-a" }),
		} })], []);
		const refreshed = archive.read();
		assert.notEqual(refreshed, published);
		assert.equal(refreshed.observations.find((event) => event.id === "same").output, 300);
		assert.equal(refreshed.observations.find((event) => event.id === "same").attribution.project.status, "conflict");
		assert.equal(refreshed.observations.find((event) => event.id === "other").output, 500);
		assert.equal(JSON.stringify(published), immutable, "External revisions must not mutate an older snapshot");
		archive.close(); archive = undefined;
		external.close(); external = undefined;
		reopened = new ObservationArchive(file);
		reopened.commit([withAttribution("same", { output: 50, attribution: {
			project: projectAttribution({ source: "third", id: "project-c" }),
			session: sessionAttribution({ source: "third", client: "Codex", id: "session-a" }),
		} })], []);
		const stored = reopened.read().observations.find((event) => event.id === "same");
		assert.equal(stored.output, 300);
		assert.equal(stored.attribution.project.status, "conflict");
		assert.deepEqual(stored.attribution.project.candidates.map((candidate) => candidate.id).sort(), ["project-a", "project-b", "project-c"]);
		assert.equal(attributionScans, 0, "Archive must not prepare an eager full-table attribution query");
	} finally {
		DatabaseSync.prototype.prepare = prepare;
		archive?.close();
		external?.close();
		reopened?.close();
		await rm(dir, { recursive: true, force: true });
	}
});

test("event ingest rejects whitespace identifiers and invalid project paths", () => {
	const { parseIngest } = require("../src/lib/observatory/store.ts");
	const base = { id: "ingest", at: new Date(now).toISOString(), model: "gpt-6.1-sol", client: "fixture" };
	for (const changes of [{ projectId: " project" }, { sessionId: "session " }, { parentSessionId: "parent" }, { cwd: "relative/path" }, { cwd: "\\\\.\\pipe\\fixture" }]) {
		assert.throws(() => parseIngest({ ...base, ...changes }), changes.parentSessionId ? /父会话/ : /无效/);
	}
	const parsed = parseIngest({ ...base, cwd: "C:\\work\\repo", projectId: "p", sessionId: "s", parentSessionId: "p0" });
	assert.equal(parsed.attribution.project.key, "project-path:C:/work/repo");
	assert.equal(parsed.attribution.session.id, "s");
	assert.equal(parsed.attribution.parentSession.id, "p0");
});

test("attribution groups conserve requests and keep conflicts in one unknown bucket", () => {
	const conflict = withAttribution("conflict"), changed = projectAttribution({ source: "router", id: "project-b" });
	conflict.attribution = { ...conflict.attribution, project: mergeAttribution(conflict.attribution.project, changed) };
	const rows = [
		withAttribution("known", { model: "model-a", input: 10, output: 2 }),
		withAttribution("conflict", { model: "model-b", input: 20, output: 3, attribution: conflict.attribution }),
		row("legacy", { model: "model-c", input: null, output: null, cache: null }),
	];
	const selection = makeAttributionSelection(rows, {});
	assert.equal(selection.totals.requests, 3);
	assert.equal(selection.totals.input, 30);
	assert.deepEqual(selection.models.map((model) => model.model).sort(), ["model-a", "model-b", "model-c"]);
	const unknown = selection.unknownProjects.reduce((sum, bucket) => sum + bucket.totals.requests, 0);
	const known = selection.projects.reduce((sum, project) => sum + project.totals.requests, 0);
	assert.equal(unknown + known, selection.totals.requests);
	const projectTotals = [...selection.projects.map((project) => project.totals), ...selection.unknownProjects.map((bucket) => bucket.totals)];
	for (const metric of ["input", "output", "cache", "inputRequests", "outputRequests", "cacheRequests", "tokenRequests"]) {
		assert.equal(projectTotals.reduce((sum, totals) => sum + totals[metric], 0), selection.totals[metric], metric);
	}
	assert.equal(selection.unknownProjects.find((bucket) => bucket.status === "conflict").totals.requests, 1);
	const sessionUnknown = selection.unknownSessions.reduce((sum, bucket) => sum + bucket.totals.requests, 0);
	const sessionKnown = selection.sessions.reduce((sum, session) => sum + session.totals.requests, 0);
	assert.equal(sessionUnknown + sessionKnown, selection.totals.requests);
});

test("time-window attribution recomputes a session from selected requests only", () => {
	const beforeWindow = withAttribution("before-window", { at: "2026-10-13T15:59:59.999Z", model: "model-before", rawModel: "model-before", output: 9 });
	const firstInWindow = withAttribution("first-in-window", { at: "2026-10-13T16:00:00.000Z", model: "model-window-a", rawModel: "model-window-a" });
	const secondInWindow = withAttribution("second-in-window", { at: "2026-10-14T05:00:00.000Z", model: "model-window-b", rawModel: "model-window-b" });
	const today = makeSnapshot([beforeWindow, firstInWindow, secondInWindow], [], "today", {}, now);
	assert.equal(today.totals.requests, 2);
	assert.equal(today.attribution.sessions.length, 1);
	assert.equal(today.attribution.sessions[0].totals.requests, 2);
	assert.equal(today.attribution.sessions[0].start, "2026-10-13T16:00:00.000Z");
	assert.deepEqual(today.attribution.sessions[0].models.map((model) => model.model).sort(), ["model-window-a", "model-window-b"]);
	const all = makeSnapshot([beforeWindow, firstInWindow, secondInWindow], [], "all", {}, now);
	assert.equal(all.attribution.sessions[0].totals.requests, 3);
	assert.deepEqual(all.attribution.sessions[0].models.map((model) => model.model).sort(), ["model-before", "model-window-a", "model-window-b"]);
});

test("store cache refreshes after an external ownership conflict and a restart reads the same revision", async () => {
	const { execFileSync } = require("node:child_process");
	const dir = await mkdtemp(join(tmpdir(), "observatory-attribution-store-"));
	const initial = withAttribution("cache-row", { output: 300 });
	const revised = withAttribution("cache-row", { output: 100, attribution: {
		project: projectAttribution({ source: "router", id: "project-b" }),
		session: sessionAttribution({ source: "codex", client: "Codex", id: "session-a" }),
	} });
	const worker = `const fs=require('node:fs'),path=require('node:path'),ts=require('typescript'),assert=require('node:assert/strict');
		require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,f);
		const {ObservationArchive}=require('./src/lib/observatory/archive.ts');
		const [initial,revised]=JSON.parse(process.argv[2]),file=path.join(process.env.OBSERVATORY_DATA_DIR,'history.sqlite');
		let archive=new ObservationArchive(file);archive.commit([initial],[]);archive.close();
		const store=require('./src/lib/observatory/store.ts');
		(async()=>{try{
			await store.setCollectionPaused(true);
			const first=await store.getSnapshot('all');
			assert.equal(first.totals.requests,1);assert.equal(first.attribution.projects.length,1);assert.equal(first.attribution.sessions[0].project.status,'known');
			archive=new ObservationArchive(file);archive.setPaused(false);assert.equal(archive.commit([revised],[]),true);archive.setPaused(true);archive.close();
			const second=await store.getSnapshot('all');
			assert.equal(second.totals.requests,1);assert.equal(second.requests[0].output,300);
			assert.equal(second.attribution.projects.length,0);assert.equal(second.attribution.unknownProjects.find(row=>row.status==='conflict').totals.requests,1);
			assert.equal(second.attribution.sessions[0].project.status,'conflict');
			await store.closeCollection();
			const reopened=await store.getSnapshot('all');
			assert.equal(reopened.totals.requests,1);assert.equal(reopened.requests[0].output,300);
			assert.equal(reopened.attribution.unknownProjects.find(row=>row.status==='conflict').totals.requests,1);
			assert.equal(reopened.attribution.sessions[0].project.status,'conflict');
		}finally{await store.closeCollection();}})().catch(e=>{console.error(e);process.exitCode=1});`;
	try {
		execFileSync(process.execPath, ["-e", worker, "unused", JSON.stringify([initial, revised])], { cwd: process.cwd(), env: { ...process.env, USERPROFILE: dir, HOME: dir, APPDATA: dir, OBSERVATORY_DATA_DIR: dir }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 10000 });
	} finally { await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); }
});
