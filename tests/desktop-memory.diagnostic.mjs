import assert from "node:assert/strict";
import { _electron } from "playwright";
import { backup, DatabaseSync } from "node:sqlite";
import { appendFile, copyFile, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const [label, executableArgument, fixtureArgument, roundsArgument, networkMode = "metadata"] = process.argv.slice(2);
assert.ok(label && executableArgument && fixtureArgument, "Usage: node tests/desktop-memory.diagnostic.mjs <label> <exe> <fixture> [rounds] [metadata|cdp-network]");
assert.match(label, /^[a-z0-9][a-z0-9._-]*$/, "Label must use lowercase letters, digits, dot, underscore or hyphen");
const rounds = Number(roundsArgument ?? "5");
assert.ok(Number.isInteger(rounds) && rounds > 0 && rounds <= 100, "Rounds must be an integer from 1 to 100");
assert.ok(["metadata", "cdp-network"].includes(networkMode), "Network mode must be metadata or cdp-network");
const executable = path.resolve(executableArgument);
const fixture = path.resolve(fixtureArgument);
assert.ok(existsSync(executable), `Missing packaged executable: ${executable}`);
const manifest = JSON.parse(await readFile(path.join(fixture, "fixture.json"), "utf8"));
assert.equal(manifest.format, "model-observatory-runtime-memory-fixture-v1");
const expected = manifest.expected;

const startedAt = new Date().toISOString();
const run = startedAt.replace(/[:.]/g, "-");
const evidenceDir = path.join(root, "logs", "runtime-memory", "diagnostics", label, run);
await mkdir(evidenceDir, { recursive: true });
const samplesFile = path.join(evidenceDir, "samples.jsonl");
const appEventsFile = path.join(evidenceDir, "app-events.jsonl");
const failureFile = path.join(evidenceDir, "failure.json");
const failureScreenshot = path.join(evidenceDir, "failure.png");
await writeFile(samplesFile, "", "utf8");
await writeFile(appEventsFile, "", "utf8");

const scratch = await mkdtemp(path.join(os.tmpdir(), "ModelObservatoryDiagnostic-"));
const home = path.join(scratch, "home");
const store = path.join(scratch, "store");
const profile = path.join(scratch, "profile");
const temp = path.join(scratch, "temp");
for (const directory of [home, store, profile, temp]) await mkdir(directory, { recursive: true });
if (existsSync(path.join(fixture, "sources"))) await cp(path.join(fixture, "sources"), home, { recursive: true });
const sourceFile = path.join(home, ".codex", "sessions", "fixture-catchup.jsonl");
const sourceSuffix = await readFile(path.join(fixture, "recovery", "partial-suffix.txt"), "utf8");
const database = new DatabaseSync(path.join(fixture, "history.sqlite"), { readOnly: true });
try { await backup(database, path.join(store, "history.sqlite")); } finally { database.close(); }
const eventsFile = path.join(store, "events.jsonl");
await copyFile(path.join(fixture, "events.jsonl"), eventsFile);
await copyFile(path.join(fixture, "aliases.json"), path.join(store, "aliases.json"));

const env = {
	...process.env,
	USERPROFILE: home,
	HOME: home,
	APPDATA: path.join(home, "AppData", "Roaming"),
	LOCALAPPDATA: path.join(home, "AppData", "Local"),
	TEMP: temp,
	TMP: temp,
	OBSERVATORY_DESKTOP_USER_DATA: profile,
	OBSERVATORY_DATA_DIR: store,
	PATH: path.join(process.env.SystemRoot || "C:\\Windows", "System32"),
};
delete env.ELECTRON_RUN_AS_NODE;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const array = (value) => value === undefined || value === null ? [] : Array.isArray(value) ? value : [value];
const powershell = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
let electronApp;
let page;
let cdp;
const errors = [];
const consoleErrors = [];
const requests = [];
const responses = [];
const networkFailures = [];
let networkEncodedBytes = 0;
let networkContentBytes = 0;
const networkEncodedByRequest = new Map();
let completed = false;
let counterGroupSequence = 0;

async function processRows(pids) {
	const ids = [...new Set(pids.filter(Number.isInteger).filter((pid) => pid > 0))];
	if (!ids.length) return [];
	const script = `$ErrorActionPreference='SilentlyContinue';$items=@(Get-Process | Where-Object { @(${ids.join(",")}) -contains $_.Id } | ForEach-Object { [pscustomobject]@{ Id=$_.Id; ProcessName=$_.ProcessName; Path=$_.Path; PrivateMemorySize64=$_.PrivateMemorySize64; WorkingSet64=$_.WorkingSet64; CPU=$_.CPU } }); if($items.Count -eq 0){'[]'}else{$items|ConvertTo-Json -Compress}`;
	try {
		const { stdout } = await execFileAsync(powershell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], {
			windowsHide: true, timeout: 10000, maxBuffer: 2 * 1024 * 1024,
		});
		return array(JSON.parse(stdout.trim() || "[]"));
	} catch (error) {
		return { error: error instanceof Error ? error.message : String(error) };
	}
}

async function originApi(origin, suffix, options) {
	const started = performance.now();
	const response = await fetch(origin + suffix, options);
	assert.equal(response.status, 200, `${suffix} returned ${response.status}`);
	return { ms: performance.now() - started, data: await response.json() };
}

async function waitUntil(check, timeoutMs, description, intervalMs = 250) {
	const end = Date.now() + timeoutMs;
	let observed;
	while (Date.now() < end) {
		observed = await check();
		if (observed) return observed;
		await sleep(intervalMs);
	}
	throw new Error(`Timed out: ${description}; last=${JSON.stringify(observed)}`);
}

async function uiState() {
	if (!page) return null;
	return page.evaluate(() => {
		const selectedRange = [...document.querySelectorAll(".obs-range-group button")].find((element) => element.getAttribute("aria-pressed") === "true")?.textContent?.trim() ?? null;
		const main = document.querySelector("main");
		return {
			url: location.href,
			pathname: location.pathname,
			range: new URL(location.href).searchParams.get("range"),
			heading: document.querySelector("h1")?.textContent?.trim() ?? null,
			selectedRange,
			busy: main?.getAttribute("aria-busy") ?? null,
			requestRows: document.querySelectorAll(".obs-request-table tbody > tr:not(.obs-expanded-row)").length,
			modelRows: document.querySelectorAll(".obs-model-table tbody > tr:not(.obs-expanded-row)").length,
			requestTotal: document.querySelector('[data-testid="request-total"]')?.textContent?.trim() ?? null,
			pagination: document.querySelector(".obs-pagination > span")?.textContent?.trim() ?? null,
			error: document.querySelector(".obs-error-banner")?.textContent?.trim() ?? null,
			loading: document.querySelector(".obs-loading")?.textContent?.trim() ?? null,
			liveStatus: document.querySelector(".obs-live-status")?.textContent?.trim() ?? null,
			rangeDescription: document.querySelector(".obs-range-description")?.textContent?.trim() ?? null,
			visibilityState: document.visibilityState,
			hasFocus: document.hasFocus(),
			bodyText: document.body.innerText.slice(-1200),
		};
	});
}

async function counters() {
	const result = { heap: null, dom: null, listeners: {}, reactRoots: null, error: null };
	if (!cdp) return result;
	const objectGroup = `diagnostic-counters-${++counterGroupSequence}`;
	const objectIds = new Set();
	try {
		const [heap, dom] = await Promise.all([
			cdp.send("Runtime.getHeapUsage"),
			cdp.send("Memory.getDOMCounters"),
		]);
		result.heap = heap;
		result.dom = dom;
		for (const [name, expression] of [["window", "window"], ["document", "document"], ["documentElement", "document.documentElement"], ["body", "document.body"]]) {
			try {
				const evaluated = await cdp.send("Runtime.evaluate", { expression, returnByValue: false, objectGroup });
				if (!evaluated.result?.objectId) continue;
				objectIds.add(evaluated.result.objectId);
				const found = await cdp.send("DOMDebugger.getEventListeners", { objectId: evaluated.result.objectId });
				result.listeners[name] = found.listeners?.length ?? 0;
				for (const listener of found.listeners ?? []) {
					for (const handle of [listener.handler, listener.originalHandler]) {
						if (handle?.objectId) objectIds.add(handle.objectId);
					}
				}
			} catch { result.listeners[name] = null; }
		}
		const react = await page.evaluate(() => ({
			nextRoots: document.querySelectorAll("[data-nextjs-router], nextjs-portal").length,
			reactRoots: document.querySelectorAll("body > div").length,
			scripts: document.scripts.length,
			styles: document.styleSheets.length,
			nodes: document.getElementsByTagName("*").length,
		}));
		result.reactRoots = react;
	} catch (error) {
		result.error = error instanceof Error ? error.message : String(error);
	} finally {
		for (const objectId of objectIds) await cdp.send("Runtime.releaseObject", { objectId }).catch(() => {});
		await cdp.send("Runtime.releaseObjectGroup", { objectGroup }).catch(() => {});
	}
	return result;
}

async function capture(labelName, details = {}) {
	const applicationState = electronApp ? await electronApp.evaluate(({ app, BrowserWindow }) => {
		const windows = BrowserWindow.getAllWindows();
		return {
			metrics: app.getAppMetrics(),
			windows: windows.map((window) => ({
				id: window.id,
				visible: window.isVisible(),
				minimized: window.isMinimized(),
				focused: window.isFocused(),
				destroyed: window.isDestroyed(),
			})),
		};
	}).catch(() => ({ metrics: [], windows: [] })) : { metrics: [], windows: [] };
	const electron = applicationState.metrics;
	const ids = electron.map((metric) => Number(metric.pid)).filter(Number.isInteger);
	const native = await processRows(ids);
	const nativeRows = Array.isArray(native) ? native : [];
	const state = await uiState().catch((error) => ({ uiError: error instanceof Error ? error.message : String(error) }));
	const metric = await counters();
	const record = {
		at: new Date().toISOString(),
		elapsedMs: performance.now(),
		label: labelName,
		details,
		url: state?.url ?? null,
		pathname: state?.pathname ?? null,
		range: state?.range ?? null,
		selectedRange: state?.selectedRange ?? null,
		heading: state?.heading ?? null,
		busy: state?.busy ?? null,
		requestRows: state?.requestRows ?? null,
		modelRows: state?.modelRows ?? null,
		requestTotal: state?.requestTotal ?? null,
		pagination: state?.pagination ?? null,
		error: state?.error ?? null,
		loading: state?.loading ?? null,
		liveStatus: state?.liveStatus ?? null,
		rangeDescription: state?.rangeDescription ?? null,
		visibilityState: state?.visibilityState ?? null,
		hasFocus: state?.hasFocus ?? null,
		bodyTail: state?.bodyText ?? null,
		windows: applicationState.windows,
		electron,
		os: nativeRows,
		osError: Array.isArray(native) ? null : native.error,
		osPrivateBytes: nativeRows.reduce((sum, row) => sum + (Number(row.PrivateMemorySize64) || 0), 0),
		osWorkingSetBytes: nativeRows.reduce((sum, row) => sum + (Number(row.WorkingSet64) || 0), 0),
		metrics: metric,
		networkMode,
		network: {
			requests: requests.length,
			responses: responses.length,
			failures: networkFailures.length,
			encodedBytes: networkEncodedBytes,
			contentBytes: networkContentBytes,
			responseBodyReads: 0,
		},
	};
	await appendFile(samplesFile, JSON.stringify(record) + "\n", "utf8");
	return record;
}

async function assertStable(expectedPath, expectedRows, requestTotal, description) {
	const state = await waitUntil(async () => {
		await capture(`${description}-poll`);
		const current = await uiState();
		if (!current || current.pathname !== expectedPath || current.range !== "all" || current.busy !== "false") return false;
		if (expectedRows !== null && current.requestRows !== expectedRows) return false;
		if (requestTotal !== null && !current.requestTotal?.startsWith(new Intl.NumberFormat("zh-CN").format(requestTotal))) return false;
		return current;
	}, 45000, description);
	assert.equal(state.pathname, expectedPath);
	assert.equal(state.range, "all");
	assert.equal(state.selectedRange, "全部");
	if (expectedRows !== null) assert.equal(state.requestRows, expectedRows);
	assert.equal(state.error, null);
	return state;
}

async function navigate(name, expectedPath, expectedRows, requestTotal) {
	const started = performance.now();
	const target = page.getByRole("link", { name, exact: true });
	await target.waitFor();
	await target.click();
	const state = await assertStable(expectedPath, expectedRows, requestTotal, `navigate-${expectedPath === "/requests" ? "requests" : "models"}`);
	return { target: name, pathname: state.pathname, range: state.range, rows: state.requestRows, ms: Number((performance.now() - started).toFixed(3)) };
}

function assertCounters(metric, description) {
	assert.ok(metric && !metric.error, `${description}: CDP counters unavailable: ${metric?.error ?? "missing"}`);
	assert.ok(Number(metric.heap?.usedSize) > 0, `${description}: heap usage was not measured`);
	assert.ok(Number(metric.heap?.totalSize) > 0, `${description}: heap total was not measured`);
	assert.ok(Number(metric.dom?.nodes) > 0, `${description}: DOM node count was not measured`);
	assert.ok(Number(metric.dom?.documents) > 0, `${description}: document count was not measured`);
	assert.ok(Number.isFinite(Number(metric.dom?.jsEventListeners)), `${description}: listener count was not measured`);
	for (const target of ["window", "document", "documentElement", "body"]) {
		assert.ok(Number.isFinite(Number(metric.listeners?.[target])), `${description}: ${target} listener count was not measured`);
	}
}

try {
	const launchStarted = performance.now();
	electronApp = await _electron.launch({ executablePath: executable, cwd: home, env, timeout: 60000 });
	await electronApp.evaluate(({ app, BrowserWindow }, logPath) => {
		const fs = process.getBuiltinModule("fs");
		const write = (type, details = {}) => {
			try { fs.appendFileSync(logPath, JSON.stringify({ at: new Date().toISOString(), pid: process.pid, type, details }) + "\n", "utf8"); }
			catch { /* Diagnostics must not change application behavior. */ }
		};
		const observeWindow = (window) => {
			const id = window.id, contents = window.webContents;
			for (const event of ["show", "hide", "focus", "blur", "minimize", "restore", "close", "closed"]) {
				window.on(event, () => write(`window:${event}`, {
					id,
					visible: !window.isDestroyed() && window.isVisible(),
					minimized: !window.isDestroyed() && window.isMinimized(),
				}));
			}
			for (const event of ["did-start-navigation", "did-finish-load", "did-fail-load", "destroyed", "unresponsive", "responsive", "render-process-gone"]) {
				contents.on(event, (...args) => write(`webContents:${event}`, {
					id,
					details: args.map((value) => typeof value === "object" && value ? {
						url: value.url,
						errorCode: value.errorCode,
						errorDescription: value.errorDescription,
						reason: value.reason,
						exitCode: value.exitCode,
						isMainFrame: value.isMainFrame,
					} : String(value)),
				}));
			}
		};
		write("diagnostic-attached", { windows: BrowserWindow.getAllWindows().length, argv: process.argv, execPath: process.execPath });
		for (const window of BrowserWindow.getAllWindows()) observeWindow(window);
		app.on("browser-window-created", (_event, window) => { write("app:browser-window-created", { id: window.id }); observeWindow(window); });
		app.on("render-process-gone", (_event, contents, details) => write("app:render-process-gone", { webContentsId: contents.id, reason: details.reason, exitCode: details.exitCode }));
		app.on("child-process-gone", (_event, details) => write("app:child-process-gone", { type: details.type, reason: details.reason, exitCode: details.exitCode, serviceName: details.serviceName, name: details.name }));
		for (const event of ["window-all-closed", "before-quit", "will-quit", "quit"]) {
			app.on(event, (...args) => write(`app:${event}`, { args: args.map((value) => typeof value === "object" && value ? value.constructor?.name ?? "object" : String(value)) }));
		}
		process.on("exit", (code) => write("main-process:exit", { code }));
		process.on("uncaughtExceptionMonitor", (error) => write("main-process:uncaughtException", { error: error.stack ?? error.message }));
		process.on("unhandledRejection", (reason) => write("main-process:unhandledRejection", { error: reason instanceof Error ? reason.stack ?? reason.message : String(reason) }));
	}, appEventsFile);
	page = await electronApp.firstWindow();
	page.setDefaultTimeout(45000);
	await page.waitForURL(/^http:\/\/127\.0\.0\.1:\d+\//, { timeout: 60000 });
	await electronApp.evaluate(({ BrowserWindow }) => {
		const window = BrowserWindow.getAllWindows()[0];
		window.setMinimumSize(900, 600);
		window.setContentSize(1440, 1000);
	});
	await page.emulateMedia({ reducedMotion: "reduce" });
	page.on("pageerror", (error) => errors.push(error.message));
	page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
	page.on("close", () => errors.push("page:close"));
	page.on("crash", () => errors.push("page:crash"));
	electronApp.on("close", () => errors.push("electron-app:close"));
	electronApp.process().once("exit", (code, signal) => errors.push(`electron-process:exit:${code}:${signal ?? ""}`));
	page.on("request", (request) => {
		const url = new URL(request.url());
		if (url.origin === new URL(page.url()).origin) requests.push({ at: new Date().toISOString(), method: request.method(), path: url.pathname, search: url.search, resourceType: request.resourceType() });
	});
	page.on("response", (response) => {
		const requestUrl = new URL(response.url());
		if (requestUrl.origin !== new URL(page.url()).origin) return;
		const headers = response.headers();
		const contentLength = Number(headers["content-length"]);
		if (Number.isFinite(contentLength)) networkContentBytes += contentLength;
		responses.push({ at: new Date().toISOString(), status: response.status(), path: requestUrl.pathname, search: requestUrl.search, contentLength: Number.isFinite(contentLength) ? contentLength : null });
	});
	page.on("requestfailed", (request) => networkFailures.push({ at: new Date().toISOString(), url: request.url(), error: request.failure()?.errorText ?? null }));
	cdp = await electronApp.context().newCDPSession(page);
	await cdp.send("Runtime.enable");
	await cdp.send("DOM.enable");
	if (networkMode === "cdp-network") {
		cdp.on("Network.responseReceived", (event) => {
			const value = Number(event.response?.encodedDataLength);
			if (Number.isFinite(value)) networkEncodedByRequest.set(event.requestId, value);
			networkEncodedBytes = [...networkEncodedByRequest.values()].reduce((sum, size) => sum + size, 0);
		});
		cdp.on("Network.loadingFinished", (event) => {
			const value = Number(event.encodedDataLength);
			if (Number.isFinite(value)) networkEncodedByRequest.set(event.requestId, value);
			networkEncodedBytes = [...networkEncodedByRequest.values()].reduce((sum, size) => sum + size, 0);
		});
		await cdp.send("Network.enable");
	}

	await page.getByTestId("request-total").waitFor({ timeout: 120000 });
	const origin = new URL(page.url()).origin;
	const startup = (await originApi(origin, "/api/observatory?range=all&limit=0")).data;
	await waitUntil(async () => {
		try {
			const snapshot = (await originApi(origin, "/api/observatory?range=all&limit=0")).data;
			return snapshot.totals.requests === expected.afterStartupPartialLine.requests ? snapshot : false;
		} catch { return false; }
	}, 120000, "startup-catchup");
	await appendFile(sourceFile, sourceSuffix + "\n", "utf8");
	await sleep(3100);
	await originApi(origin, "/api/observatory/collection", { method: "POST", headers: { "Content-Type": "application/json" }, body: '{"action":"collect"}' });
	await waitUntil(async () => {
		const snapshot = (await originApi(origin, "/api/observatory?range=all&limit=0")).data;
		return snapshot.totals.requests === expected.afterPartialRecovery.requests ? snapshot : false;
	}, 30000, "partial-line-recovery");
	await page.getByRole("button", { name: "全部", exact: true }).click();
	await page.locator('main[aria-busy="false"]').waitFor();
	const baseline = await capture("after-recovery", { startupRequests: startup.totals.requests, uiReadyMs: Number((performance.now() - launchStarted).toFixed(3)) });
	assertCounters(baseline.metrics, "after-recovery");

	await navigate("请求流水", "/requests", 50, null);
	await capture("before-soak-request-page");
	await navigate("模型总览", "/", null, expected.afterPartialRecovery.requests);
	await capture("before-soak-model-page");

	const soak = [];
	for (let round = 1; round <= rounds; round++) {
		const beforeSnapshot = (await originApi(origin, "/api/observatory?range=all&limit=0")).data;
		const errorsBefore = errors.length, consoleBefore = consoleErrors.length;
		const networkBefore = requests.length;
		const navigation = [];
		for (let pass = 0; pass < 2; pass++) {
			navigation.push(await navigate("请求流水", "/requests", 50, null));
			navigation.push(await navigate("模型总览", "/", null, beforeSnapshot.totals.requests));
		}
		const collectionBefore = (await originApi(origin, "/api/observatory/collection")).data;
		assert.equal(collectionBefore.observations, beforeSnapshot.totals.requests);
		assert.equal(collectionBefore.error, null);
		const roundSamples = [];
		for (let tick = 0; tick < 7; tick++) {
			roundSamples.push(await capture(`soak-${round}`, { round, tick, navigation }));
			if (tick < 6) await sleep(2500);
		}
		const afterSnapshot = (await originApi(origin, "/api/observatory?range=all&limit=0")).data;
		const collectionAfter = (await originApi(origin, "/api/observatory/collection")).data;
		assert.equal(afterSnapshot.totals.requests, beforeSnapshot.totals.requests, `Soak round ${round} changed request count`);
		assert.equal(afterSnapshot.totals.input, beforeSnapshot.totals.input, `Soak round ${round} changed input tokens`);
		assert.equal(afterSnapshot.totals.output, beforeSnapshot.totals.output, `Soak round ${round} changed output tokens`);
		assert.equal(errors.length, errorsBefore, `Soak round ${round} produced a page error`);
		assert.equal(consoleErrors.length, consoleBefore, `Soak round ${round} produced a console error`);
		assert.equal(collectionAfter.observations, afterSnapshot.totals.requests);
		assert.equal(collectionAfter.error, null);
		assertCounters(roundSamples.at(-1)?.metrics, `soak-${round}`);
		const renderer = roundSamples.at(-1)?.electron.find((metric) => metric.type === "Tab")?.memory?.privateBytes;
		const service = roundSamples.at(-1)?.electron.find((metric) => metric.name === "本机数据采集")?.memory?.privateBytes;
		const roundRequests = requests.slice(networkBefore);
		soak.push({
			round,
			navigation,
			requests: afterSnapshot.totals.requests,
			collectionBefore,
			collectionAfter,
			rendererPrivateKiB: renderer ?? null,
			servicePrivateKiB: service ?? null,
			heap: roundSamples.at(-1)?.metrics.heap ?? null,
			dom: roundSamples.at(-1)?.metrics.dom ?? null,
			listeners: roundSamples.at(-1)?.metrics.listeners ?? {},
			reactRoots: roundSamples.at(-1)?.metrics.reactRoots ?? null,
			network: roundSamples.at(-1)?.network ?? null,
			roundNetwork: {
				allRequests: roundRequests.length,
				observatoryApiRequests: roundRequests.filter((request) => request.path === "/api/observatory").length,
				nextDataRequests: roundRequests.filter((request) => request.path.startsWith("/_next/data/")).length,
				documentRequests: roundRequests.filter((request) => request.resourceType === "document").length,
			},
		});
	}
	const summary = {
		status: "complete",
		label,
		run,
		harness: "desktop-memory.diagnostic",
		networkMode,
		rounds,
		executable,
		fixture,
		fixtureSemanticSha256: manifest.semanticSha256,
		startedAt,
		endedAt: new Date().toISOString(),
		isolation: { home, profile, store },
		soak,
		pageErrors: errors,
		consoleErrors,
		network: {
			requests: requests.length,
			responses: responses.length,
			failures: networkFailures.length,
			encodedBytes: networkEncodedBytes,
			contentBytes: networkContentBytes,
			responseBodyReads: 0,
		},
		method: "Read-only DOM and CDP counters around the frozen soak navigation pattern. No heap snapshot, GC, trim, heap cap or collector change. CDP Runtime/Memory observation remains active in both modes; cdp-network adds Network event metadata only and never reads response bodies.",
	};
	await writeFile(path.join(evidenceDir, "summary.json"), JSON.stringify(summary, null, 2) + "\n", "utf8");
	console.log(JSON.stringify({ status: "complete", evidenceDir, rounds, networkMode }, null, 2));
	completed = true;
} catch (error) {
	completed = false;
	let state = null, metrics = null, electron = [], native = [];
	try { state = await uiState(); } catch { /* Preserve the original failure. */ }
	try { metrics = await counters(); } catch { /* Preserve the original failure. */ }
	try { electron = await electronApp?.evaluate(({ app }) => app.getAppMetrics()) ?? []; } catch { /* App may be gone. */ }
	try { native = await processRows(electron.map((metric) => Number(metric.pid))); } catch { /* Preserve the original failure. */ }
	try { if (page) await page.screenshot({ path: failureScreenshot, fullPage: false }); } catch { /* Keep the JSON evidence. */ }
	const desktopLog = path.join(profile, "logs", "desktop.log");
	const desktopLogCopy = path.join(evidenceDir, "desktop.log");
	if (existsSync(desktopLog)) await copyFile(desktopLog, desktopLogCopy).catch(() => {});
	const windowSettings = path.join(profile, "window.json");
	const windowSettingsCopy = path.join(evidenceDir, "window.json");
	if (existsSync(windowSettings)) await copyFile(windowSettings, windowSettingsCopy).catch(() => {});
	const failure = {
		status: "failed",
		label,
		run,
		networkMode,
		failedAt: new Date().toISOString(),
		error: error instanceof Error ? error.stack ?? error.message : String(error),
		ui: state,
		metrics,
		electron,
		os: native,
		pageErrors: errors,
		consoleErrors,
		network: {
			recentRequests: requests.slice(-50),
			recentResponses: responses.slice(-50),
			failures: networkFailures.slice(-20),
			encodedBytes: networkEncodedBytes,
			contentBytes: networkContentBytes,
			responseBodyReads: 0,
		},
		scratch,
		appEvents: appEventsFile,
		desktopLog: existsSync(desktopLogCopy) ? desktopLogCopy : null,
		windowSettings: existsSync(windowSettingsCopy) ? windowSettingsCopy : null,
		samples: samplesFile,
		screenshot: existsSync(failureScreenshot) ? failureScreenshot : null,
	};
	await writeFile(failureFile, JSON.stringify(failure, null, 2) + "\n", "utf8");
	throw error;
} finally {
	if (cdp && networkMode === "cdp-network") await cdp.send("Network.disable").catch(() => {});
	if (cdp) await cdp.detach().catch(() => {});
	if (electronApp) await electronApp.close().catch(() => {});
	if (!completed) {
		if (existsSync(path.join(profile, "logs", "desktop.log"))) await copyFile(path.join(profile, "logs", "desktop.log"), path.join(evidenceDir, "desktop.log")).catch(() => {});
	}
	if (completed && path.dirname(scratch) === os.tmpdir() && path.basename(scratch).startsWith("ModelObservatoryDiagnostic-")) {
		await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
	}
	if (!completed) console.error(JSON.stringify({ preservedScratch: scratch, appEvents: appEventsFile, failure: failureFile }, null, 2));
}
