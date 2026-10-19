import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";

const [output, profile = "normal"] = process.argv.slice(2);
assert.ok(output, "Usage: node scripts/memory-fixture.mjs <output> <normal|large>");
assert.ok(profile === "normal" || profile === "large", "Profile must be normal or large");
assert.equal(path.extname(output), "", "Fixture output must be a new directory");

const scales = {
	normal: { requests: 3000, label: "普通历史" },
	large: { requests: 30000, label: "大历史" },
};
const scale = scales[profile];
const bootstrap = 25;
const historyCount = scale.requests - bootstrap;
const continuousCount = 3;
const start = Date.parse("2025-01-02T00:00:00.000Z");
const stepMs = Math.floor((330 * 86_400_000) / Math.max(1, scale.requests - 1));
const sourceStart = Date.parse("2025-12-02T00:00:00.000Z");
const incrementStart = Date.parse("2025-12-10T00:00:00.000Z");
const restartAt = Date.parse("2025-12-20T00:00:00.000Z");

function sha(value) {
	return createHash("sha256").update(value).digest("hex");
}

function seeded(seed) {
	let value = seed >>> 0;
	return () => {
		value ^= value << 13;
		value ^= value >>> 17;
		value ^= value << 5;
		return (value >>> 0) / 0x1_0000_0000;
	};
}

const random = seeded(profile === "normal" ? 0x6e6f726d : 0x6c617267);
const models = [
	"deepseek-v3.2",
	"gpt-6.1-sol",
	"claude-sonnet-4.5",
	"glm-5",
	"kimi-k2.5",
	"qwen3.5-max",
	"deepseek-v3.1-terminus",
	"gpt-6-astra",
	"claude-opus-4.5",
	"minimax-m2.1",
	"gemini-3-pro",
	"grok-4.1",
	"o4-mini",
	"deepseek-r2",
];
const clients = ["Codex CLI", "Codex Desktop", "DeepSeek Harness", "pi", "ZCode", "OpenCode"];
const projectPaths = [
	"C:\\Fixture\\Dashboard",
	"C:\\Fixture\\Night Web",
	"D:\\Fixture\\Research Ledger",
	"D:\\Fixture\\Shared Work",
	"E:\\Fixture\\Archive",
	"E:\\Fixture\\Tooling",
];
const source = "fixture-memory";

function candidate(value, label, key, extra = {}) {
	return { source: value, label, key, ...extra };
}

function projectValue(index) {
	const projectPath = projectPaths[index % projectPaths.length].replaceAll("\\", "/");
	const label = projectPath.slice(projectPath.lastIndexOf("/") + 1);
	const key = `project-path:${projectPath}`;
	return {
		status: "known",
		key,
		label,
		source,
		path: projectPath,
		candidates: [candidate(source, label, key, { path: projectPath })],
	};
}

function sessionValue(index) {
	const id = `fixture-session-${String(Math.floor(index / 20) + 1).padStart(6, "0")}`;
	const key = `session:${JSON.stringify([source, "Memory Fixture", id])}`;
	return {
		status: "known",
		key,
		label: id,
		source,
		client: "Memory Fixture",
		id,
		candidates: [candidate(source, id, key, { client: "Memory Fixture", id })],
	};
}

function unknownValue(kind, reason = "not-provided") {
	return {
		status: kind === "source-unsupported" ? "unsupported" : "missing",
		key: null,
		label: kind === "source-unsupported" ? "来源不支持" : "未知",
		source,
		reason: reason,
		candidates: [],
	};
}

function attribution(index) {
	const bucket = index % 25;
	return {
		project: bucket < 2 ? unknownValue("missing") : bucket < 3 ? unknownValue("source-unsupported", "source-unsupported") : projectValue(index),
		session: bucket < 2 ? unknownValue("missing") : bucket < 4 ? unknownValue("source-unsupported", "source-unsupported") : sessionValue(index),
		parentSession: unknownValue("missing"),
	};
}

function usage() {
	const input = 120 + Math.floor(random() * 6_000);
	return {
		input,
		output: 20 + Math.floor(random() * 900),
		cache: Math.floor(input * random() * .55),
	};
}

function baseEvent(index) {
	const id = `memory-${profile}-${String(index + 1).padStart(6, "0")}`;
	const model = models[Math.floor(random() * models.length)];
	const client = clients[index % clients.length];
	const values = usage();
	return {
		id,
		at: new Date(start + index * stepMs).toISOString(),
		model,
		rawModel: model,
		client,
		upstream: index % 9 === 0 ? "fixture-router" : "fixture-direct",
		...values,
		status: index % 137 === 0 ? "error" : "ok",
		duration: 300 + (index % 700),
		identity: "reported",
		requestId: id,
		evidence: [{ id, source, kind: "session" }],
		attribution: attribution(index),
	};
}

function sourceLine(counter, full) {
	const at = new Date(sourceStart + counter * 60_000).toISOString();
	const input = 500 + counter * 17, output = 40 + counter * 3, cache = 100 + counter * 5;
	const total = counter * 10_000;
	const records = [
		{ timestamp: at, type: "session_meta", payload: { id: "fixture-codex-catchup", originator: "Codex CLI", cwd: "C:\\Fixture\\Source Catchup" } },
		{ timestamp: at, type: "turn_context", payload: { model: "gpt-6.1-sol", cwd: "C:\\Fixture\\Source Catchup" } },
		{ timestamp: at, type: "event_msg", payload: { type: "token_count", info: {
			last_token_usage: { input_tokens: input, output_tokens: output, cached_input_tokens: cache },
			total_token_usage: { input_tokens: total + input, output_tokens: total / 10 + output },
		} } },
	];
	const text = records.map((row) => JSON.stringify(row)).join("\n");
	return full ? text + "\n" : text.slice(0, Math.floor(text.length / 2));
}

function directEvent(kind, index) {
	const id = `memory-${profile}-${kind}-${index + 1}`;
	const at = kind === "restart" ? restartAt : incrementStart + index * 60_000;
	const values = { input: 1_000 + index * 100, output: 100 + index * 10, cache: 200 + index * 10 };
	return {
		id,
		at: new Date(at).toISOString(),
		model: ["deepseek-v3.2", "gpt-6.1-sol", "claude-sonnet-4.5"][index % 3],
		rawModel: ["deepseek-v3.2", "gpt-6.1-sol", "claude-sonnet-4.5"][index % 3],
		client: "Memory Fixture Events",
		upstream: "fixture-events",
		...values,
		status: "ok",
		duration: 250,
		identity: "reported",
		requestId: id,
		evidence: [{ id, source: "fixture-memory-events", kind: "event" }],
		attribution: attribution(historyCount + bootstrap + index),
	};
}

function expected(rows) {
	const totals = { requests: rows.length, input: 0, output: 0, cache: 0, errors: 0 };
	const byModel = {};
	let knownProjects = 0, knownSessions = 0;
	for (const row of rows) {
		totals.input += row.input ?? 0;
		totals.output += row.output ?? 0;
		totals.cache += row.cache ?? 0;
		totals.errors += Number(row.status === "error");
		byModel[row.model] ??= { requests: 0, input: 0, output: 0 };
		byModel[row.model].requests++;
		byModel[row.model].input += row.input ?? 0;
		byModel[row.model].output += row.output ?? 0;
		knownProjects += Number(row.attribution?.project?.status === "known");
		knownSessions += Number(row.attribution?.session?.status === "known");
	}
	return { ...totals, knownProjects, knownSessions, unknownProjects: rows.length - knownProjects, unknownSessions: rows.length - knownSessions, byModel };
}

assert.equal(existsSync(output), false, `Fixture output already exists: ${output}`);
await mkdir(path.dirname(path.resolve(output)), { recursive: true });
await mkdir(output);
const sources = path.join(output, "sources", ".codex", "sessions");
const recovery = path.join(output, "recovery");
await mkdir(sources, { recursive: true });
await mkdir(recovery, { recursive: true });

const base = Array.from({ length: historyCount }, (_, index) => baseEvent(index));
const database = new DatabaseSync(path.join(output, "history.sqlite"));
database.exec("PRAGMA journal_mode=DELETE; PRAGMA synchronous=OFF; CREATE TABLE observations (id TEXT PRIMARY KEY, event TEXT NOT NULL); CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);");
const insert = database.prepare("INSERT INTO observations VALUES (?, ?)");
database.exec("BEGIN IMMEDIATE");
for (const row of base) insert.run(row.id, JSON.stringify(row));
database.prepare("INSERT INTO metadata VALUES (?, ?)").run("fixtureProfile", profile);
database.exec("COMMIT");
database.exec("VACUUM");
database.close();

const completeSource = [];
for (let index = 0; index < 24; index++) completeSource.push(sourceLine(index, true));
const partialFull = sourceLine(24, true);
const split = Math.max(80, Math.floor(partialFull.length * .58));
const sourceFile = path.join(sources, "fixture-catchup.jsonl");
await writeFile(sourceFile, completeSource.join("") + partialFull.slice(0, split), "utf8");
await writeFile(path.join(recovery, "partial-prefix.txt"), partialFull.slice(0, split), "utf8");
await writeFile(path.join(recovery, "partial-suffix.txt"), partialFull.slice(split), "utf8");
await writeFile(path.join(output, "events.jsonl"), "", "utf8");
await writeFile(path.join(output, "aliases.json"), "{}\n", "utf8");

const continuous = Array.from({ length: continuousCount }, (_, index) => directEvent("continuous", index));
const restart = directEvent("restart", 0);
await writeFile(path.join(output, "increments.json"), JSON.stringify({ continuous, restart }, null, 2) + "\n", "utf8");

// The source reader has existing semantics for test token records. Use the
// values asserted by the harness after a real collection, not a guessed count.
const sourceAt = (index) => new Date(sourceStart + index * 60_000).toISOString();
const sourceRows = Array.from({ length: 25 }, (_, index) => ({
	id: `source-catchup-${index}`,
	at: sourceAt(index),
	model: "gpt-6.1-sol",
	rawModel: "gpt-6.1-sol",
	client: "Codex CLI",
	input: 500 + index * 17,
	output: 40 + index * 3,
	cache: 100 + index * 5,
	status: "unknown",
	attribution: { project: { status: "known" }, session: { status: "known" } },
}));
const allRows = [...base, ...sourceRows, ...continuous, restart];
const phases = {
	afterStartupPartialLine: expected([...base, ...sourceRows.slice(0, 24)]),
	initialAfterCatchup: expected([...base, ...sourceRows]),
	afterPartialRecovery: expected([...base, ...sourceRows]),
	afterContinuous: expected([...base, ...sourceRows, ...continuous]),
	afterRestartCatchup: expected(allRows),
};
const files = {};
for (const relative of ["history.sqlite", "events.jsonl", "aliases.json", "increments.json", path.join("sources", ".codex", "sessions", "fixture-catchup.jsonl")]) {
	const filename = path.join(output, relative);
	const value = await readFile(filename);
	const info = await stat(filename);
	files[relative.replaceAll("\\", "/")] = { bytes: info.size, sha256: sha(value) };
}
const schemaRows = base.map((row) => JSON.stringify(row)).join("\n") + "\n";
const manifest = {
	format: "model-observatory-runtime-memory-fixture-v1",
	profile,
	label: scale.label,
	seed: profile === "normal" ? "0x6e6f726d" : "0x6c617267",
	fixedTime: {
		firstRequest: base[0]?.at,
		lastBaseRequest: base.at(-1)?.at,
		sourceCatchup: [sourceAt(0), sourceAt(24)],
		continuous: continuous.map((row) => row.at),
		restart: restart.at,
		policy: "All fixture timestamps are fixed historical UTC instants; no run appends future records.",
	},
	scale: {
		profileRequests: scale.requests,
		historyRows: base.length,
		sourceCompleteRows: 24,
		sourcePartialRows: 1,
		continuousRows: continuous.length,
		restartRows: 1,
		finalRows: allRows.length,
	},
	expected: phases,
	files,
	semanticSha256: sha(schemaRows),
	method: "Seeded metadata-only events with explicit known and unknown project/session attribution. The history database is copied per run; the Codex fixture ends in a deliberate partial JSON line, then three fixed event increments exercise the 15-second collector and one fixed event exercises restart catch-up.",
	generatedAt: new Date().toISOString(),
};
await writeFile(path.join(output, "fixture.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8");
console.log(JSON.stringify({
	output: path.resolve(output),
	profile,
	baseRequests: base.length,
	finalRequests: allRows.length,
	historyBytes: files["history.sqlite"].bytes,
	semanticSha256: manifest.semanticSha256,
}, null, 2));
