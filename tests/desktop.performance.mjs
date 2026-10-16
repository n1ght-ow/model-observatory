import assert from "node:assert/strict";
import { _electron } from "playwright";
import { DatabaseSync, backup } from "node:sqlite";
import { appendFile, copyFile, cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const [label, executable, fixture] = process.argv.slice(2);
const launchArgs = JSON.parse(process.env.DESKTOP_PERFORMANCE_ARGS ?? "[]");
assert.ok(Array.isArray(launchArgs) && launchArgs.every((arg) => typeof arg === "string"));
assert.ok(label && executable && fixture, "Provide label, executable and a fixed ledger fixture directory");
assert.match(label, /^[a-z0-9-]+$/);
const scratch = await mkdtemp(path.join(os.tmpdir(), "ModelObservatoryPerformance-"));
const store = path.join(scratch, "ledger"), home = path.join(scratch, "home");
await mkdir(store); await mkdir(home);
// Optional metadata-only source logs let the same harness measure collectors,
// rather than only the archive/query path. Never read the real home implicitly.
const sources = path.join(fixture, "sources");
if (existsSync(sources)) await cp(sources, home, { recursive: true });
const db = new DatabaseSync(path.join(fixture, "history.sqlite"), { readOnly: true });
try { await backup(db, path.join(store, "history.sqlite")); } finally { db.close(); }
await copyFile(path.join(fixture, "events.jsonl"), path.join(store, "events.jsonl"));
await copyFile(path.join(fixture, "aliases.json"), path.join(store, "aliases.json")).catch(() => {});
const env = { ...process.env, USERPROFILE: home, HOME: home, APPDATA: path.join(home, "AppData", "Roaming"), LOCALAPPDATA: path.join(home, "AppData", "Local"), OBSERVATORY_DESKTOP_USER_DATA: path.join(scratch, "profile"), OBSERVATORY_DATA_DIR: store };
delete env.ELECTRON_RUN_AS_NODE;
let app;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const median = (values) => { const sorted = [...values].sort((a, b) => a - b); return (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2; };
const summarize = (samples) => ({ privateMiB: median(samples.map((sample) => sample.reduce((n, row) => n + row.memory.privateBytes, 0))) / 1024, workingSetMiB: median(samples.map((sample) => sample.reduce((n, row) => n + row.memory.workingSetSize, 0))) / 1024, cpuPercent: median(samples.map((sample) => sample.reduce((n, row) => n + row.cpu.percentCPUUsage, 0))), processes: samples.at(-1) });
async function sampleMemory(count = 8) {
	const samples = [];
	for (let i = 0; i < count; i++) { await sleep(1000); samples.push(await app.evaluate(({ app }) => app.getAppMetrics())); }
	return summarize(samples);
}
try {
	const started = performance.now();
	app = await _electron.launch({ executablePath: path.resolve(executable), args: launchArgs, cwd: scratch, env, timeout: 60000 });
	const page = await app.firstWindow();
	await page.waitForURL(/^http:\/\/127\.0\.0\.1:\d+\//, { timeout: 60000 });
	await page.getByTestId("request-total").waitFor({ timeout: 60000 });
	const firstUiMs = performance.now() - started;
	const origin = new URL(page.url()).origin;
	const query = async (range = "all") => {
		const started = performance.now();
		const response = await fetch(`${origin}/api/observatory?range=${range}`);
		assert.equal(response.status, 200);
		const snapshot = await response.json();
		return { ms: performance.now() - started, snapshot };
	};
	const catchup = await fetch(origin + "/api/observatory/collection", { method: "POST", headers: { "Content-Type": "application/json" }, body: '{"action":"collect"}' });
	assert.equal(catchup.status, 200); await catchup.json();
	const initial = (await query()).snapshot;
	await page.getByRole("button", { name: "暂停实时刷新", exact: true }).click();
	// Alternate ranges under normal cache reuse, including a collection cycle.
	const queries = [];
	for (let i = 0; i < 12; i++) { await sleep(1100); queries.push((await query(i % 2 ? "today" : "all")).ms); }
	await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.show(); if (w.isMinimized()) w.restore(); });
	await page.getByRole("button", { name: "恢复实时刷新", exact: true }).click();
	await sleep(3000);
	await app.evaluate(({ app }) => app.getAppMetrics());
	const visible = await sampleMemory();
	await page.getByRole("link", { name: "请求流水", exact: true }).click();
	await page.locator(".obs-request-table tbody tr").first().waitFor();
	const requestView = await sampleMemory();
	await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].hide());
	const hidden = await sampleMemory();
	// The public collect operation has a three-second debounce. An automatic
	// timer just before this step must not turn the measured call into a no-op.
	const lastCollection = await (await fetch(origin + "/api/observatory/collection")).json();
	if (lastCollection.collectedAt) await sleep(Math.max(0, 3100 - (Date.now() - Date.parse(lastCollection.collectedAt))));
	const added = { ...initial.requests[0], id: "performance-appended-event", requestId: "performance-appended-event", at: new Date().toISOString(), client: "Performance fixture", evidence: [{ id: "performance-appended-event", source: "event:Performance fixture", kind: "event" }] };
	await appendFile(path.join(store, "events.jsonl"), JSON.stringify(added) + "\n");
	const collectStart = performance.now();
	const response = await fetch(origin + "/api/observatory/collection", { method: "POST", headers: { "Content-Type": "application/json" }, body: '{"action":"collect"}' });
	assert.equal(response.status, 200); await response.json();
	const collectionMs = performance.now() - collectStart;
	await sleep(1100);
	const afterAppend = await query();
	assert.equal(afterAppend.snapshot.totals.requests, initial.totals.requests + 1);
	const restoreStart = performance.now();
	await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.show(); if (w.isMinimized()) w.restore(); });
	await page.waitForResponse((response) => response.url().includes("/api/observatory?") && response.status() === 200);
	const restoreMs = performance.now() - restoreStart;
	await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].focus());
	const scroll = await page.evaluate(() => new Promise((resolve) => {
		const samples = []; let previous, started;
		function frame(at) {
			started ??= at;
			if (previous !== undefined) samples.push(at - previous);
			previous = at;
			scrollTo(0, (document.documentElement.scrollHeight - innerHeight) * (.5 - .5 * Math.cos((at - started) / 500)));
			if (at - started < 4000) requestAnimationFrame(frame);
			else { samples.sort((a, b) => a - b); resolve({ frames: samples.length, medianMs: samples[Math.floor(samples.length / 2)], p95Ms: samples[Math.floor(samples.length * .95)], over33Ms: samples.filter((at) => at > 33.4).length }); }
		}
		requestAnimationFrame(frame);
	}));
	const graphics = await app.evaluate(({ app }) => ({ hardwareAcceleration: app.isHardwareAccelerationEnabled(), features: app.getGPUFeatureStatus() }));
	const result = { label, graphics, executable: path.resolve(executable), launchArgs, scroll, version: await app.evaluate(({ app }) => app.getVersion()), fixture: path.resolve(fixture), sourceFixture: existsSync(sources), initialRequests: initial.totals.requests, afterAppendRequests: afterAppend.snapshot.totals.requests, firstUiMs, queryMs: queries, queryMedianMs: median(queries), visible, requestView, hidden, collectionMs, afterAppendQueryMs: afterAppend.ms, restoreMs, testedAt: new Date().toISOString(), method: "Fixed metadata-only ledger and JSONL copy, plus optional fixture/sources logs; isolated home/profile; packaged EXEs; executable paths may differ; startup timings reported separately; 12 queries alternating all/today, reusing a snapshot until the ledger or time-window membership changes; 8 one-second samples per window state; four-second foreground scroll afterwards; no forced GC, memory caps or working-set trimming. Electron metrics are KiB; summed working sets may include shared pages." };
	await mkdir(path.join(root, "logs", "performance"), { recursive: true });
	await writeFile(path.join(root, "logs", "performance", label + ".json"), JSON.stringify(result, null, 2));
	console.log(JSON.stringify({ label, firstUiMs, requests: initial.totals.requests, queryMedianMs: result.queryMedianMs, visiblePrivateMiB: visible.privateMiB, requestPrivateMiB: requestView.privateMiB, hiddenPrivateMiB: hidden.privateMiB, collectionMs, restoreMs, scroll }));
} finally {
	if (app) await app.close();
	assert.equal(path.dirname(path.resolve(scratch)), path.resolve(os.tmpdir()));
	assert.ok(path.basename(scratch).startsWith("ModelObservatoryPerformance-"));
	await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}
