const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { test, after } = require("node:test");
const ts = require("typescript");

const home = fs.mkdtempSync(path.join(os.tmpdir(), "observatory-attribution-"));
process.env.USERPROFILE = home;
process.env.HOME = home;
process.env.APPDATA = path.join(home, "AppData", "Roaming");
process.env.CURSOR_USER_DATA_DIR = path.join(home, "cursor");
process.env.OBSERVATORY_DATA_DIR = path.join(home, "ledger");

require.extensions[".ts"] = (module, file) => {
	const source = fs.readFileSync(file, "utf8");
	module._compile(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, file);
};

const { collectObservations, releaseCommittedReaders } = require("../src/lib/observatory/readers.ts");
const { releaseCommittedJsonl } = require("../src/lib/observatory/jsonl.ts");

after(async () => {
	releaseCommittedReaders();
	await releaseCommittedJsonl();
	fs.rmSync(home, { recursive: true, force: true });
});

function writeFixture(relative, rows) {
	const file = path.join(home, relative);
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
	return file;
}

function sourceRows(result, source) {
	return result.observations.filter((row) => row.evidence.some((item) => item.source === source));
}

function cursorFixture(file) {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	const db = new DatabaseSync(file);
	db.exec("PRAGMA journal_mode=WAL; CREATE TABLE cursorDiskKV(key TEXT PRIMARY KEY, value BLOB)");
	const put = db.prepare("INSERT INTO cursorDiskKV VALUES (?, ?)");
	const bubble = (composer, id, fields) => put.run(`bubbleId:${composer}:${id}`, JSON.stringify({
		bubbleId: id,
		type: fields.type,
		requestId: fields.requestId,
		createdAt: "2026-10-18T02:00:00.000Z",
		modelInfo: fields.model ? { modelName: fields.model } : undefined,
		text: "ATTRIBUTION_PRIVATE_BODY",
	}));
	const headers = (composer, ids) => put.run(`composerData:${composer}`, JSON.stringify({
		fullConversationHeadersOnly: ids.map((bubbleId) => ({ bubbleId })),
	}));
	return { db, bubble, headers };
}

test("source readers project only confirmed attribution metadata and preserve conflicts", async () => {
	writeFixture(".codex/sessions/2026/10/18/turn.jsonl", [
		{ type: "session_meta", payload: { id: "codex-session", cwd: "C:\\work\\codex", originator: "Codex CLI", source: { subagent: { spawn: { parent_thread_id: "codex-parent" } } } } },
		{ type: "turn_context", payload: { model: "codex-model", cwd: "C:\\work\\codex-turn" } },
		{ timestamp: "2026-10-18T01:00:00.000Z", type: "event_msg", payload: { type: "token_count", info: { last_token_usage: { input_tokens: 10, output_tokens: 2, cached_input_tokens: 1 }, total_token_usage: { input_tokens: 10, output_tokens: 2 } } } },
		{ timestamp: "2026-10-18T01:00:01.000Z", type: "event_msg", payload: { type: "token_count", info: { last_token_usage: { input_tokens: 10, output_tokens: 2, cached_input_tokens: 1 }, total_token_usage: { input_tokens: 20, output_tokens: 4 } } } },
		{ type: "turn_context", payload: { model: "codex-model", cwd: "C:\\work\\codex-changed" } },
		{ timestamp: "2026-10-18T01:00:02.000Z", type: "event_msg", payload: { type: "token_count", info: { last_token_usage: { input_tokens: 10, output_tokens: 2, cached_input_tokens: 1 }, total_token_usage: { input_tokens: 30, output_tokens: 6 } } } },
	]);
	writeFixture(".codex/sessions/2026/10/18/meta.jsonl", [
		{ type: "session_meta", payload: { id: "codex-meta-session", cwd: "C:\\work\\codex-meta", originator: "Codex Desktop" } },
		{ type: "turn_context", payload: { model: "codex-meta-model" } },
		{ timestamp: "2026-10-18T01:01:00.000Z", type: "event_msg", payload: { type: "token_count", info: { last_token_usage: { input_tokens: 4, output_tokens: 1 }, total_token_usage: { input_tokens: 4, output_tokens: 1 } } } },
	]);
	writeFixture(".codex/codex-router/usage-events.jsonl", [
		{ at: "2026-10-18T01:01:30.000Z", model: "router-model", requestId: "router-request", status: 200, inputTokens: 1, outputTokens: 1 },
	]);
	writeFixture(".claude/projects/project-a/session.jsonl", [
		{ type: "assistant", sessionId: "claude-session", cwd: "C:\\work\\claude", timestamp: "2026-10-18T01:02:00.000Z", message: { id: "claude-request", model: "claude-model", usage: { input_tokens: 2, cache_read_input_tokens: 1, cache_creation_input_tokens: 3, output_tokens: 4 }, content: "ATTRIBUTION_PRIVATE_BODY" } },
	]);
	writeFixture(".pi/agent/sessions/session.jsonl", [
		{ type: "session", id: "pi-session", cwd: "C:\\work\\pi", parentSession: "C:\\pi-parent.jsonl" },
		{ type: "message", id: "pi-request", timestamp: "2026-10-18T01:03:00.000Z", message: { role: "assistant", model: "pi-model", usage: { input: 1, cacheRead: 2, cacheWrite: 3, output: 4 } } },
	]);
	writeFixture(".dsh/sessions/dsh-project/dsh-session/session.jsonl", [
		{ type: "session", id: "dsh-session", cwd: "C:\\work\\dsh" },
		{ type: "assistant/message", time: Date.parse("2026-10-18T01:04:00.000Z"), data: { turn: 1, step: 1, message: { source: { provider: "native", model: "dsh-model" } }, usage: { inputTokens: 1, cacheReadTokens: 2, outputTokens: 3 } } },
	]);
	writeFixture(".grok/sessions/grok/chat_history.jsonl", [
		{ type: "assistant", model_id: "grok-model" },
	]);
	writeFixture(".commandcode/projects/project/session.jsonl", [
		{ type: "message", id: "command-request", timestamp: "2026-10-18T01:04:30.000Z", model: "command-model", usage: { input: 1, output: 1 }, message: { role: "assistant" } },
	]);

	const opencodePath = path.join(home, ".local", "share", "opencode", "opencode.db");
	fs.mkdirSync(path.dirname(opencodePath), { recursive: true });
	const opencode = new DatabaseSync(opencodePath);
	try {
		opencode.exec("CREATE TABLE message(id TEXT PRIMARY KEY, session_id TEXT NOT NULL, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL); CREATE TABLE session(id TEXT PRIMARY KEY, project_id TEXT NOT NULL, workspace_id TEXT, parent_id TEXT, slug TEXT NOT NULL, directory TEXT, title TEXT NOT NULL, version TEXT NOT NULL, cost REAL NOT NULL, tokens_input INTEGER NOT NULL, tokens_output INTEGER NOT NULL, tokens_reasoning INTEGER NOT NULL, tokens_cache_read INTEGER NOT NULL, tokens_cache_write INTEGER NOT NULL, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL)");
		opencode.prepare("INSERT INTO message VALUES (?, ?, ?, ?, ?)").run("opencode-request", "opencode-session", 1000, 2000, JSON.stringify({
			role: "assistant", modelID: "opencode-model", providerID: "opencode-provider",
			tokens: { input: 5, output: 3, reasoning: 2, cache: { read: 4, write: 1 } },
			time: { created: 1000, completed: 2000 }, content: "ATTRIBUTION_PRIVATE_BODY",
		}));
		opencode.prepare("INSERT INTO session (id, project_id, parent_id, slug, directory, title, version, cost, tokens_input, tokens_output, tokens_reasoning, tokens_cache_read, tokens_cache_write, time_created, time_updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
			"opencode-session", "opencode-project", "opencode-parent", "fixture", "C:\\work\\opencode", "ATTRIBUTION_PRIVATE_BODY", "1", 0, 0, 0, 0, 0, 0, 1000, 2000,
		);
		opencode.prepare("INSERT INTO message VALUES (?, ?, ?, ?, ?)").run("opencode-id-only-request", "opencode-id-only-session", 1000, 2000, JSON.stringify({
			role: "assistant", modelID: "opencode-id-model", tokens: { input: 1, output: 1 }, time: { created: 1000, completed: 2000 },
		}));
		opencode.prepare("INSERT INTO session (id, project_id, parent_id, slug, directory, title, version, cost, tokens_input, tokens_output, tokens_reasoning, tokens_cache_read, tokens_cache_write, time_created, time_updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
			"opencode-id-only-session", "opencode-id-project", null, "fixture", null, "fixture", "1", 0, 0, 0, 0, 0, 0, 1000, 2000,
		);
	} finally { opencode.close(); }

	const zcodePath = path.join(home, ".zcode", "cli", "db", "db.sqlite");
	fs.mkdirSync(path.dirname(zcodePath), { recursive: true });
	const zcode = new DatabaseSync(zcodePath);
	try {
		zcode.exec("CREATE TABLE model_usage(id TEXT PRIMARY KEY, session_id TEXT NOT NULL, model_id TEXT NOT NULL, provider_id TEXT NOT NULL, status TEXT NOT NULL, started_at INTEGER NOT NULL, duration_ms INTEGER, input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL, cache_read_input_tokens INTEGER NOT NULL); CREATE TABLE session(id TEXT PRIMARY KEY, project_id TEXT NOT NULL, parent_id TEXT, directory TEXT NOT NULL)");
		zcode.prepare("INSERT INTO model_usage VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run("zcode-request", "zcode-session", "zcode-model", "zcode-provider", "completed", "2026-10-18T01:05:00.000Z", 100, 6, 2, 1);
		zcode.prepare("INSERT INTO session VALUES (?, ?, ?, ?)").run("zcode-session", "zcode-project", "zcode-parent", "C:\\work\\zcode");
	} finally { zcode.close(); }

	const cursorPath = path.join(home, "cursor", "User", "globalStorage", "state.vscdb");
	const cursor = cursorFixture(cursorPath);
	try {
		cursor.bubble("alpha", "single-human", { type: 1, requestId: "cursor-single", model: "cursor-model" });
		cursor.bubble("alpha", "single-response", { type: 2 });
		cursor.bubble("alpha", "shared-human", { type: 1, requestId: "cursor-shared", model: "cursor-model" });
		cursor.bubble("alpha", "shared-response", { type: 2 });
		cursor.bubble("beta", "shared-human", { type: 1, requestId: "cursor-shared", model: "cursor-model" });
		cursor.bubble("beta", "shared-response", { type: 2 });
		cursor.headers("alpha", ["single-human", "single-response", "shared-human", "shared-response"]);
		cursor.headers("beta", ["shared-human", "shared-response"]);
	} finally { cursor.db.close(); }

	const first = await collectObservations();
	assert.ok(!first.coverage.some((source) => source.state === "error"));
	assert.ok(!JSON.stringify(first.observations).includes("ATTRIBUTION_PRIVATE_BODY"));

	const codex = sourceRows(first, "codex").find((row) => row.attribution.session.id === "codex-session");
	assert.ok(codex);
	assert.equal(codex.client, "Codex CLI");
	assert.equal(codex.attribution.project.status, "known");
	assert.equal(codex.attribution.project.path, "C:/work/codex-turn");
	assert.equal(codex.attribution.session.client, "Codex");
	assert.equal(codex.attribution.parentSession.id, "codex-parent");
	const codexTurns = sourceRows(first, "codex").filter((row) => row.attribution.session.id === "codex-session");
	assert.equal(codexTurns.length, 3);
	assert.equal(codexTurns[0].attribution, codexTurns[1].attribution);
	assert.ok(Object.isFrozen(codexTurns[0].attribution));
	assert.notEqual(codexTurns[0].attribution, codexTurns[2].attribution);
	assert.equal(codexTurns[2].attribution.project.path, "C:/work/codex-changed");
	const codexMeta = sourceRows(first, "codex").find((row) => row.attribution.session.id === "codex-meta-session");
	assert.equal(codexMeta.client, "Codex Desktop");
	assert.equal(codexMeta.attribution.project.path, "C:/work/codex-meta");
	assert.equal(codexMeta.attribution.parentSession.status, "missing");
	assert.equal(codexMeta.attribution.parentSession.reason, "not-provided");

	const claude = sourceRows(first, "claude-code")[0];
	assert.equal(claude.requestId, "claude-request");
	assert.equal(claude.attribution.project.path, "C:/work/claude");
	assert.equal(claude.attribution.session.id, "claude-session");
	assert.equal(claude.attribution.parentSession.reason, "not-provided");

	const pi = sourceRows(first, "pi")[0];
	assert.equal(pi.attribution.project.path, "C:/work/pi");
	assert.equal(pi.attribution.session.id, "pi-session");
	assert.equal(pi.attribution.parentSession.status, "missing");
	assert.equal(pi.attribution.parentSession.reason, "not-provided");

	const dsh = sourceRows(first, "dsh")[0];
	assert.equal(dsh.attribution.project.path, "C:/work/dsh");
	assert.equal(dsh.attribution.session.id, "dsh-session");

	const opencodeRow = sourceRows(first, "opencode")[0];
	assert.equal(opencodeRow.requestId, "opencode-request");
	assert.equal(opencodeRow.attribution.project.path, "C:/work/opencode");
	assert.equal(opencodeRow.attribution.project.id, "opencode-project");
	assert.equal(opencodeRow.attribution.session.id, "opencode-session");
	assert.equal(opencodeRow.attribution.parentSession.id, "opencode-parent");
	const opencodeIdOnly = sourceRows(first, "opencode").find((row) => row.requestId === "opencode-id-only-request");
	assert.equal(opencodeIdOnly.attribution.project.id, "opencode-id-project");
	assert.equal(opencodeIdOnly.attribution.project.path, undefined);

	const zcodeRow = sourceRows(first, "zcode")[0];
	assert.equal(zcodeRow.requestId, "zcode-request");
	assert.equal(zcodeRow.attribution.project.path, "C:/work/zcode");
	assert.equal(zcodeRow.attribution.project.id, "zcode-project");
	assert.equal(zcodeRow.attribution.session.id, "zcode-session");
	assert.equal(zcodeRow.attribution.parentSession.id, "zcode-parent");

	const cursorRows = sourceRows(first, "cursor");
	const cursorSingle = cursorRows.find((row) => row.requestId === "cursor-single");
	assert.equal(cursorSingle.attribution.session.id, "alpha");
	assert.equal(cursorSingle.attribution.project.status, "missing");
	const cursorShared = cursorRows.find((row) => row.requestId === "cursor-shared");
	assert.equal(cursorShared.attribution.session.status, "conflict");
	assert.deepEqual(cursorShared.attribution.session.candidates.map((candidate) => candidate.id).sort(), ["alpha", "beta"]);
	assert.equal(cursorRows.length, 2, "a request repeated across composers remains one counted request");

	for (const source of ["router", "grok-cli", "command-code"]) {
		const row = sourceRows(first, source)[0];
		assert.ok(row, `${source} fixture produced an event`);
		assert.equal(row.attribution.project.reason, "source-unsupported");
		assert.equal(row.attribution.session.reason, "source-unsupported");
		assert.equal(row.attribution.parentSession.reason, "source-unsupported");
	}

	const duplicateDb = new DatabaseSync(opencodePath);
	try {
		duplicateDb.exec("DROP TABLE session; CREATE TABLE session(id TEXT, project_id TEXT, parent_id TEXT, directory TEXT); INSERT INTO session VALUES ('duplicate-session', 'project-a', NULL, 'C:/duplicate-a'); INSERT INTO session VALUES ('duplicate-session', 'project-b', NULL, 'C:/duplicate-b')");
		duplicateDb.prepare("INSERT INTO message VALUES (?, ?, ?, ?, ?)").run("opencode-duplicate-request", "duplicate-session", 1000, 2000, JSON.stringify({
			role: "assistant", modelID: "opencode-duplicate-model", tokens: { input: 1, output: 1 }, time: { created: 1000, completed: 2000 },
		}));
	} finally { duplicateDb.close(); }
	const duplicated = await collectObservations();
	const duplicateRows = sourceRows(duplicated, "opencode").filter((row) => row.requestId === "opencode-duplicate-request");
	assert.equal(duplicateRows.length, 1, "duplicate session ids must not multiply usage rows");
	assert.equal(duplicateRows[0].attribution.session.id, "duplicate-session");
	assert.equal(duplicateRows[0].attribution.project.status, "invalid");
	assert.equal(duplicateRows[0].attribution.project.reason, "invalid-id");
	assert.equal(duplicateRows[0].attribution.parentSession.status, "invalid");
	assert.equal(duplicateRows[0].attribution.parentSession.reason, "invalid-id");

	const oldSchemaDb = new DatabaseSync(opencodePath);
	try {
		oldSchemaDb.exec("DROP TABLE message; CREATE TABLE message(id TEXT PRIMARY KEY, data TEXT NOT NULL); INSERT INTO message VALUES ('opencode-old-schema-request', '{\"role\":\"assistant\",\"modelID\":\"opencode-old-schema-model\",\"tokens\":{\"input\":1,\"output\":1},\"time\":{\"created\":1000,\"completed\":2000}}')");
	} finally { oldSchemaDb.close(); }
	const oldSchema = await collectObservations();
	const oldSchemaRow = sourceRows(oldSchema, "opencode")[0];
	assert.equal(oldSchemaRow.attribution.session.status, "unsupported");
	assert.equal(oldSchemaRow.attribution.session.reason, "source-unsupported");
	assert.equal(oldSchemaRow.attribution.project.status, "unsupported");

	const nullSchemaDb = new DatabaseSync(opencodePath);
	try {
		nullSchemaDb.exec("DROP TABLE session; CREATE TABLE session(id TEXT PRIMARY KEY, project_id TEXT, parent_id TEXT, directory TEXT); DROP TABLE message; CREATE TABLE message(id TEXT PRIMARY KEY, session_id TEXT, data TEXT NOT NULL); INSERT INTO message VALUES ('opencode-null-session-request', NULL, '{\"role\":\"assistant\",\"modelID\":\"opencode-null-model\",\"tokens\":{\"input\":1,\"output\":1},\"time\":{\"created\":1000,\"completed\":2000}}')");
	} finally { nullSchemaDb.close(); }
	const nullSchema = await collectObservations();
	const nullRow = sourceRows(nullSchema, "opencode")[0];
	assert.equal(nullRow.attribution.session.status, "missing");
	assert.equal(nullRow.attribution.session.reason, "not-provided");
	assert.equal(nullRow.attribution.project.status, "missing");
	assert.equal(nullRow.attribution.parentSession.status, "missing");

	writeFixture(".dsh/sessions/fallback/session.jsonl", [
		{ type: "assistant/message", time: Date.parse("2026-10-18T01:06:00.000Z"), data: { turn: 1, step: 1, message: { source: { model: "dsh-fallback-model" } }, usage: { inputTokens: 1, outputTokens: 1 } } },
	]);
	writeFixture(".dsh/sessions/invalid/session.jsonl", [
		{ type: "session", id: 42, cwd: "relative/path" },
		{ type: "assistant/message", time: Date.parse("2026-10-18T01:07:00.000Z"), data: { turn: 1, step: 1, message: { source: { model: "dsh-invalid-model" } }, usage: { inputTokens: 1, outputTokens: 1 } } },
	]);
	writeFixture(".dsh/sessions/null-id/session.jsonl", [
		{ type: "session", id: null },
		{ type: "assistant/message", time: Date.parse("2026-10-18T01:08:00.000Z"), data: { turn: 1, step: 1, message: { source: { model: "dsh-null-id-model" } }, usage: { inputTokens: 1, outputTokens: 1 } } },
	]);

	const second = await collectObservations();
	const fallback = second.observations.find((row) => row.rawModel === "dsh-fallback-model");
	assert.equal(fallback.attribution.session.status, "missing");
	assert.equal(fallback.attribution.session.reason, "not-provided");
	assert.equal(fallback.attribution.project.status, "missing");
	const invalid = second.observations.find((row) => row.rawModel === "dsh-invalid-model");
	assert.equal(invalid.attribution.session.status, "invalid");
	assert.equal(invalid.attribution.session.reason, "invalid-id");
	assert.equal(invalid.attribution.project.status, "invalid");
	assert.equal(invalid.attribution.project.reason, "invalid-path");
	const nullId = second.observations.find((row) => row.rawModel === "dsh-null-id-model");
	assert.equal(nullId.attribution.session.status, "invalid");
	assert.equal(nullId.attribution.session.reason, "invalid-id");
	assert.notEqual(nullId.attribution, fallback.attribution, "Null and an absent identifier carry different evidence");

	const fallbackAgain = (await collectObservations()).observations.find((row) => row.rawModel === "dsh-fallback-model");
	assert.equal(fallbackAgain.id, fallback.id, "path fallback may stabilize the event id but not the session attribution");
});
