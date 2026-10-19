import assert from "node:assert/strict";
import { backup, DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { existsSync } from "node:fs";
import { appendFile, copyFile, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const [label, executableArgument, fixtureArgument, roundsArgument] = process.argv.slice(2);
assert.ok(label && executableArgument && fixtureArgument, "Usage: node tests/desktop-memory.main-inspector.mjs <label> <exe> <fixture> [rounds=8]");
assert.match(label, /^[a-z0-9][a-z0-9._-]*$/, "Invalid label");
const executable = path.resolve(executableArgument), fixture = path.resolve(fixtureArgument);
const rounds = Number(roundsArgument ?? "8");
assert.ok(Number.isInteger(rounds) && rounds > 0 && rounds <= 20);
const manifest = JSON.parse(await readFile(path.join(fixture, "fixture.json"), "utf8"));
const run = new Date().toISOString().replace(/[:.]/g, "-");
const evidenceDir = path.join(root, "logs/runtime-memory/main-inspector", label, run);
await mkdir(evidenceDir, { recursive: true });
const samplesFile = path.join(evidenceDir, "samples.jsonl"), stderrFile = path.join(evidenceDir, "stderr.log");
await writeFile(samplesFile, "", "utf8"); await writeFile(stderrFile, "", "utf8");
const scratch = await mkdtemp(path.join(os.tmpdir(), "ModelObservatoryMainInspector-"));
const home = path.join(scratch, "home"), store = path.join(scratch, "store"), profile = path.join(scratch, "profile"), temp = path.join(scratch, "temp");
for (const directory of [home, store, profile, temp]) await mkdir(directory, { recursive: true });
if (existsSync(path.join(fixture, "sources"))) await cp(path.join(fixture, "sources"), home, { recursive: true });
const sourceFile = path.join(home, ".codex", "sessions", "fixture-catchup.jsonl");
const sourceSuffix = await readFile(path.join(fixture, "recovery", "partial-suffix.txt"), "utf8");
const fixtureDb = new DatabaseSync(path.join(fixture, "history.sqlite"), { readOnly: true });
try { await backup(fixtureDb, path.join(store, "history.sqlite")); } finally { fixtureDb.close(); }
await copyFile(path.join(fixture, "events.jsonl"), path.join(store, "events.jsonl"));
await copyFile(path.join(fixture, "aliases.json"), path.join(store, "aliases.json"));
const env = {
	...process.env, USERPROFILE: home, HOME: home,
	APPDATA: path.join(home, "AppData", "Roaming"), LOCALAPPDATA: path.join(home, "AppData", "Local"),
	TEMP: temp, TMP: temp, OBSERVATORY_DESKTOP_USER_DATA: profile, OBSERVATORY_DATA_DIR: store,
	PATH: path.join(process.env.SystemRoot || "C:\\Windows", "System32"),
};
delete env.ELECTRON_RUN_AS_NODE;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const median = (values) => {
	const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
	return sorted.length ? (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2 : null;
};
const array = (value) => value == null ? [] : Array.isArray(value) ? value : [value];
const powershell = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
let child, socket, completed = false, rpcId = 0;
const pending = new Map(), samples = [];
function rejectPending(reason) {
	for (const waiter of pending.values()) {
		clearTimeout(waiter.timer);
		waiter.reject(new Error(reason));
	}
	pending.clear();
}
function closeInspector() {
	const current = socket;
	socket = undefined;
	try { current?.close(); } catch {}
	rejectPending("Inspector closed");
}
async function waitUntil(check, timeout, description) {
	const end = Date.now() + timeout;
	while (Date.now() < end) { const value = await check(); if (value) return value; await sleep(200); }
	throw new Error(`Timed out: ${description}`);
}
async function processRows(pids) {
	if (!pids.length) return [];
	const script = `$ErrorActionPreference='SilentlyContinue';$items=@(Get-Process | Where-Object { @(${pids.join(",")}) -contains $_.Id } | ForEach-Object { [pscustomobject]@{Id=$_.Id;ProcessName=$_.ProcessName;Path=$_.Path;PrivateMemorySize64=$_.PrivateMemorySize64;WorkingSet64=$_.WorkingSet64;CPU=$_.CPU} });if($items.Count -eq 0){'[]'}else{$items|ConvertTo-Json -Compress}`;
	const { stdout } = await execFileAsync(powershell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true, timeout: 10000, maxBuffer: 2 * 1024 * 1024 });
	return array(JSON.parse(stdout.trim() || "[]"));
}
function send(method, params = {}) {
	assert.ok(socket && socket.readyState === WebSocket.OPEN, "Node inspector is not connected");
	return new Promise((resolve, reject) => {
		const id = ++rpcId, timer = setTimeout(() => { pending.delete(id); reject(new Error(`Inspector timeout: ${method}`)); }, 45000);
		pending.set(id, { timer, resolve: (value) => { clearTimeout(timer); resolve(value); }, reject: (error) => { clearTimeout(timer); reject(error); } });
		socket.send(JSON.stringify({ id, method, params }));
	});
}
async function evaluate(expression) {
	const response = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, silent: true });
	if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text);
	return response.result?.value;
}
async function api(origin, suffix, options) {
	const response = await fetch(origin + suffix, options), text = await response.text();
	return { status: response.status, headers: Object.fromEntries(response.headers), text };
}
async function waitCount(origin, count, timeout = 120000) {
	return waitUntil(async () => {
		try { const result = await api(origin, "/api/observatory?range=all&limit=0"); return result.status === 200 && JSON.parse(result.text).totals.requests === count; }
		catch { return false; }
	}, timeout, `request count ${count}`);
}

let origin;
try {
	child = spawn(executable, ["--inspect=127.0.0.1:0"], { cwd: home, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
	let stderr = "", debuggerUrl;
	const inspectorReady = new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error("Node inspector URL was not published")), 30000);
		const inspect = (chunk) => {
			const text = chunk.toString();
			stderr += text; void appendFile(stderrFile, text, "utf8");
			const match = stderr.match(/Debugger listening on (ws:\/\/\S+)/);
			if (match && !debuggerUrl) { debuggerUrl = match[1]; clearTimeout(timer); resolve(debuggerUrl); }
		};
		child.stdout.on("data", inspect); child.stderr.on("data", inspect);
		child.once("error", (error) => { clearTimeout(timer); reject(error); });
		child.once("exit", (code) => { clearTimeout(timer); reject(new Error(`Electron exited before inspector was ready (${code})`)); });
	});
	debuggerUrl = await inspectorReady;
	socket = new WebSocket(debuggerUrl);
	await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
	socket.addEventListener("message", (event) => {
		const message = JSON.parse(String(event.data)), waiter = pending.get(message.id);
		if (!waiter) return; pending.delete(message.id);
		if (message.error) waiter.reject(new Error(`${message.error.code}: ${message.error.message}`)); else waiter.resolve(message.result);
	});
	socket.addEventListener("close", () => rejectPending("Inspector closed"));
	await send("Runtime.enable");
	await evaluate(`(() => {
		const moduleApi = process.getBuiltinModule("module");
		let load = process.mainModule?.require ? process.mainModule.require.bind(process.mainModule) : null;
		for (const candidate of [process.argv[1], process.cwd() + "/package.json", process.execPath].filter(Boolean)) {
			if (load) break;
			try { const attempt = moduleApi.createRequire(candidate); attempt("electron"); load = attempt; } catch {}
		}
		if (!load) throw new Error("Cannot acquire Electron from main inspector");
		globalThis.__moMainInspector = load("electron");
		return true;
	})()`);
	const mainState = () => evaluate(`(() => {
		const { app, BrowserWindow } = globalThis.__moMainInspector;
		return { metrics: app.getAppMetrics(), windows: BrowserWindow.getAllWindows().map((window) => ({
			id: window.id, url: window.webContents.getURL(), visible: window.isVisible(), minimized: window.isMinimized(), focused: window.isFocused(), loading: window.webContents.isLoading()
		})) };
	})()`);
	const pageEval = (code) => evaluate(`(async () => {
		const { BrowserWindow } = globalThis.__moMainInspector;
		const window = BrowserWindow.getAllWindows()[0];
		if (!window || window.isDestroyed()) throw new Error("No application window");
		return await window.webContents.executeJavaScript(${JSON.stringify(code)}, true);
	})()`);
	const uiState = () => pageEval(`(() => {
		const selected = [...document.querySelectorAll(".obs-range-group button")].find((node) => node.getAttribute("aria-pressed") === "true");
		return { url: location.href, pathname: location.pathname, range: new URL(location.href).searchParams.get("range"),
			selectedRange: selected?.textContent?.trim() ?? null, heading: document.querySelector("h1")?.textContent?.trim() ?? null,
			busy: document.querySelector("main")?.getAttribute("aria-busy") ?? null,
			requestRows: document.querySelectorAll(".obs-request-table tbody > tr:not(.obs-expanded-row)").length,
			modelRows: document.querySelectorAll(".obs-model-table tbody > tr:not(.obs-expanded-row)").length,
			requestTotal: document.querySelector('[data-testid="request-total"]')?.textContent?.trim() ?? null,
			error: document.querySelector(".obs-error-banner")?.textContent?.trim() ?? null,
			visibility: document.visibilityState, focus: document.hasFocus() };
	})()`);
	const waitView = (pathname, rows, count) => waitUntil(async () => {
		try {
			const state = await uiState();
			return state.pathname === pathname && state.range === "all" && state.selectedRange === "全部" && state.busy === "false" && (rows === null || state.requestRows === rows) && (count === null || state.requestTotal?.startsWith(new Intl.NumberFormat("zh-CN").format(count))) ? state : false;
		} catch { return false; }
	}, 45000, `view ${pathname}`);
	const click = (text) => pageEval(`(() => { const node = [...document.querySelectorAll("a")].find((item) => item.textContent.trim() === ${JSON.stringify(text)}); if (!node) return false; node.click(); return true; })()`);
	const clickAll = () => pageEval(`(() => { const node = [...document.querySelectorAll(".obs-range-group button")].find((item) => item.textContent.trim() === "全部"); if (!node) return false; node.click(); return true; })()`);
	const capture = async (phase, round) => {
		const main = await mainState(), state = await uiState();
		assert.equal(main.metrics.length, 5, "Expected five application processes");
		const pids = main.metrics.map((metric) => Number(metric.pid)).filter(Number.isInteger);
		const native = await processRows(pids);
		assert.equal(native.length, pids.length, "OS process sample did not cover all application PIDs");
		const record = { at: new Date().toISOString(), phase, round, main, ui: state, native };
		await appendFile(samplesFile, JSON.stringify(record) + "\n", "utf8"); samples.push(record); return record;
	};
	await waitUntil(async () => { try { const state = await mainState(); return state.windows[0]?.url.startsWith("http://127.0.0.1:") && !state.windows[0].loading; } catch { return false; } }, 60000, "application window");
	origin = (await mainState()).windows[0].url.match(/^http:\/\/127\.0\.0\.1:\d+/)?.[0];
	assert.ok(origin);
	await waitCount(origin, manifest.expected.afterStartupPartialLine.requests);
	await appendFile(sourceFile, sourceSuffix + "\n", "utf8"); await sleep(3100);
	await api(origin, "/api/observatory/collection", { method: "POST", headers: { "Content-Type": "application/json" }, body: '{"action":"collect"}' });
	await waitCount(origin, manifest.expected.afterPartialRecovery.requests);
	const apiSample = await api(origin, "/api/observatory?range=all&limit=0");
	await clickAll(); await waitView("/", null, manifest.expected.afterPartialRecovery.requests);
	await click("请求流水"); await waitView("/requests", 50, null);
	await click("模型总览"); await waitView("/", null, manifest.expected.afterPartialRecovery.requests);
	const soak = [];
	for (let round = 1; round <= rounds; round++) {
		const navigation = [];
		for (let pass = 0; pass < 2; pass++) {
			for (const [name, pathname, rows] of [["请求流水", "/requests", 50], ["模型总览", "/", null]]) {
				const started = performance.now(); assert.equal(await click(name), true); await waitView(pathname, rows, rows ? null : manifest.expected.afterPartialRecovery.requests);
				navigation.push({ target: name, ms: Number((performance.now() - started).toFixed(3)) });
			}
		}
		const roundSamples = [];
		for (let tick = 0; tick < 7; tick++) { roundSamples.push(await capture(`soak-${round}`, round)); if (tick < 6) await sleep(2500); }
		const last = roundSamples.at(-1), tab = last.main.metrics.find((metric) => metric.type === "Tab"), service = last.main.metrics.find((metric) => metric.name === "本机数据采集");
		assert.equal(last.ui.range, "all"); assert.equal(last.ui.requestTotal?.startsWith(new Intl.NumberFormat("zh-CN").format(manifest.expected.afterPartialRecovery.requests)), true);
		soak.push({ round, navigation, rendererPrivateKiB: tab?.memory?.privateBytes ?? null, rendererWorkingSetKiB: tab?.memory?.workingSetSize ?? null,
			rendererPeakWorkingSetKiB: tab?.memory?.peakWorkingSetSize ?? null, servicePrivateKiB: service?.memory?.privateBytes ?? null,
			rendererPrivateMedianKiB: median(roundSamples.map((sample) => sample.main.metrics.find((metric) => metric.type === "Tab")?.memory?.privateBytes)),
			rendererCpuPercentMedian: median(roundSamples.map((sample) => sample.main.metrics.find((metric) => metric.type === "Tab")?.cpu?.percentCPUUsage)),
			visibility: roundSamples.map((sample) => sample.ui.visibility), range: last.ui.range, requestTotal: last.ui.requestTotal });
	}
	const hash = async (file) => { const value = createHash("sha256"); for await (const chunk of createReadStream(file)) value.update(chunk); return value.digest("hex"); };
	const resources = path.join(path.dirname(executable), "resources");
	const appAsar = path.join(resources, "app.asar"), serverCjs = path.join(resources, "server", "server.cjs");
	const summary = { status: "complete", label, run, rounds, mode: "main-process-node-inspector", executable, executableSha256: await hash(executable),
		appAsarSha256: existsSync(appAsar) ? await hash(appAsar) : null, serverCjsSha256: existsSync(serverCjs) ? await hash(serverCjs) : null,
		fixtureSemanticSha256: manifest.semanticSha256, harnessSha256: await hash(fileURLToPath(import.meta.url)), isolation: { scratch, home, profile, store },
		apiMetadataSample: { status: apiSample.status, contentLength: apiSample.headers["content-length"] ?? null, transferEncoding: apiSample.headers["transfer-encoding"] ?? null, bodyBytes: Buffer.byteLength(apiSample.text) },
		soak, stderrFile, method: "Packaged EXE with main-process Node inspector only. UI navigation uses webContents.executeJavaScript; renderer debugger and Network domain are never enabled. No GC, heap cap, trim or collector changes." };
	await writeFile(path.join(evidenceDir, "summary.json"), JSON.stringify(summary, null, 2) + "\n", "utf8");
	console.log(JSON.stringify({ status: "complete", evidenceDir, rounds, firstRendererMiB: soak[0]?.rendererPrivateKiB / 1024, lastRendererMiB: soak.at(-1)?.rendererPrivateKiB / 1024 }, null, 2));
	completed = true;
} catch (error) {
	try { if (socket) await evaluate(`(async () => { const w = globalThis.__moMainInspector?.BrowserWindow.getAllWindows()[0]; if (!w) return null; const image = await w.webContents.capturePage(); return image.toPNG().toString("base64"); })()`).then((png) => png && writeFile(path.join(evidenceDir, "failure.png"), Buffer.from(png, "base64"))); } catch {}
	try { if (socket?.readyState === WebSocket.OPEN) await evaluate("globalThis.__moMainInspector?.app.quit(); true"); } catch {}
	closeInspector();
	const desktopLog = path.join(profile, "logs", "desktop.log");
	if (existsSync(desktopLog)) await copyFile(desktopLog, path.join(evidenceDir, "desktop.log")).catch(() => {});
	await writeFile(path.join(evidenceDir, "failure.json"), JSON.stringify({ status: "failed", label, run, error: error.stack ?? error.message, samples, scratch, stderrFile }, null, 2));
	throw error;
} finally {
	if (child && child.exitCode === null) {
		try { if (socket?.readyState === WebSocket.OPEN) await evaluate("globalThis.__moMainInspector?.app.quit(); true"); } catch {}
		closeInspector();
		await new Promise((resolve) => { const timer = setTimeout(resolve, 15000); child.once("exit", () => { clearTimeout(timer); resolve(); }); });
		if (child.exitCode === null) {
			const quit = spawn(executable, ["--quit"], { cwd: home, env, windowsHide: true, stdio: "ignore" });
			await new Promise((resolve) => { const timer = setTimeout(resolve, 15000); quit.once("exit", () => { clearTimeout(timer); resolve(); }); });
			if (child.exitCode === null) child.kill();
		}
	}
	closeInspector();
	if (completed) await rm(scratch, { recursive: true, force: true, retryDelay: 300, maxRetries: 5 });
	else console.error(JSON.stringify({ preservedScratch: scratch, stderrFile }, null, 2));
}
