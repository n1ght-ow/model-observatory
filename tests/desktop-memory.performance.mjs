import assert from "node:assert/strict";
import { _electron } from "playwright";
import { backup, DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { appendFile, copyFile, cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const [label, executableArgument, fixtureArgument, runArgument] = process.argv.slice(2);
assert.ok(label && executableArgument && fixtureArgument, "Usage: node tests/desktop-memory.performance.mjs <label> <exe> <fixture> [run]");
assert.match(label, /^[a-z0-9][a-z0-9._-]*$/, "Label must use lowercase letters, digits, dot, underscore or hyphen");
const soakRounds = Number(process.env.MEMORY_SOAK_ROUNDS ?? "0");
assert.ok(Number.isInteger(soakRounds) && soakRounds >= 0 && soakRounds <= 100, "MEMORY_SOAK_ROUNDS must be an integer from 0 to 100");
const executable = path.resolve(executableArgument);
const fixture = path.resolve(fixtureArgument);
assert.ok(existsSync(executable), `Missing packaged executable: ${executable}`);
assert.ok(existsSync(path.join(fixture, "fixture.json")), `Missing fixture manifest: ${fixture}`);
const run = (runArgument || new Date().toISOString().replace(/[:.]/g, "-")).replace(/[^a-z0-9._-]/gi, "-");
assert.match(run, /^[a-z0-9][a-z0-9._-]*$/i, "Run identifier is invalid");
const evidenceDir = path.join(root, "logs", "runtime-memory", label);
const summaryPath = path.join(evidenceDir, `${run}.summary.json`);
const samplesPath = path.join(evidenceDir, `${run}.samples.jsonl`);
assert.equal(existsSync(summaryPath), false, `Run already exists: ${summaryPath}`);

const manifest = JSON.parse(await readFile(path.join(fixture, "fixture.json"), "utf8"));
assert.equal(manifest.format, "model-observatory-runtime-memory-fixture-v1");
assert.ok(["normal", "large"].includes(manifest.profile));
for (const [relative, expected] of Object.entries(manifest.files)) {
	const value = await readFile(path.join(fixture, relative));
	assert.equal(value.length, expected.bytes, `Fixture size drifted: ${relative}`);
	assert.equal(createHash("sha256").update(value).digest("hex"), expected.sha256, `Fixture hash drifted: ${relative}`);
}
const expected = manifest.expected.afterRestartCatchup;
const increments = JSON.parse(await readFile(path.join(fixture, "increments.json"), "utf8"));
assert.equal(increments.continuous.length, manifest.scale.continuousRows);

await mkdir(evidenceDir, { recursive: true });
await writeFile(samplesPath, "", { flag: "wx" });
const scratch = await mkdtemp(path.join(os.tmpdir(), `ModelObservatoryRuntimeMemory-${run}-`));
const home = path.join(scratch, "home");
const store = path.join(scratch, "store");
const profile = path.join(scratch, "profile");
const temp = path.join(scratch, "temp");
for (const directory of [home, store, profile, temp]) await mkdir(directory, { recursive: true });
const sourceRoot = path.join(fixture, "sources");
if (existsSync(sourceRoot)) await cp(sourceRoot, home, { recursive: true });
const sourceFile = path.join(home, ".codex", "sessions", "fixture-catchup.jsonl");
const recoverySuffix = await readFile(path.join(fixture, "recovery", "partial-suffix.txt"), "utf8");
const eventsFile = path.join(store, "events.jsonl");
const database = new DatabaseSync(path.join(fixture, "history.sqlite"), { readOnly: true });
try { await backup(database, path.join(store, "history.sqlite")); } finally { database.close(); }
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
const median = (values) => {
	const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
	if (!sorted.length) return null;
	return (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2;
};
const rounded = (value, digits = 3) => value === null ? null : Number(value.toFixed(digits));
const sum = (values) => values.length ? values.reduce((total, value) => total + value, 0) : null;
const array = (value) => value === undefined || value === null ? [] : Array.isArray(value) ? value : [value];
const powershell = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");

async function osProcesses(where) {
	const script = `$ErrorActionPreference='SilentlyContinue';$items=@(Get-Process | Where-Object { ${where} } | ForEach-Object { [pscustomobject]@{ Id=$_.Id; ProcessName=$_.ProcessName; Path=$_.Path; PrivateMemorySize64=$_.PrivateMemorySize64; WorkingSet64=$_.WorkingSet64; CPU=$_.CPU } }); if($items.Count -eq 0){'[]'}else{$items|ConvertTo-Json -Compress}`;
	try {
		const { stdout } = await execFileAsync(powershell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], {
			windowsHide: true, timeout: 10000, maxBuffer: 2 * 1024 * 1024,
		});
		return array(JSON.parse(stdout.trim() || "[]"));
	} catch (error) {
		return { error: error instanceof Error ? error.message : String(error) };
	}
}

function osByDirectory(directory, excluded = new Set()) {
	const encoded = Buffer.from(path.resolve(directory), "utf8").toString("base64");
	const filter = `$_.Path -and $_.Path.StartsWith([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}')),[StringComparison]::OrdinalIgnoreCase)`;
	return osProcesses(filter).then((rows) => Array.isArray(rows) ? rows.filter((row) => !excluded.has(Number(row.Id))) : rows);
}

function osByPids(pids) {
	const ids = [...new Set(pids.filter(Number.isInteger).filter((pid) => pid > 0))];
	if (!ids.length) return Promise.resolve([]);
	return osProcesses(`@(${ids.join(",")}) -contains $_.Id`);
}

async function fileHash(filename) {
	const hash = createHash("sha256");
	for await (const chunk of createReadStream(filename)) hash.update(chunk);
	return hash.digest("hex");
}

async function optionalFileHash(filename) {
	if (!existsSync(filename)) return null;
	return { path: filename, bytes: (await stat(filename)).size, sha256: await fileHash(filename) };
}

let electronApp;
let page;
let samplesWritten = 0;
const pageErrors = [];
const consoleErrors = [];
const phases = {};
const rawSamples = [];

function processIds(metrics) {
	return metrics.map((metric) => Number(metric.pid)).filter(Number.isInteger);
}

async function sampleState(scenario, details = {}) {
	let electron = [];
	let electronError = null;
	if (electronApp) {
		try { electron = await electronApp.evaluate(({ app }) => app.getAppMetrics()); }
		catch (error) { electronError = error instanceof Error ? error.message : String(error); }
	}
	const appProcessIds = processIds(electron);
	const wrapperPid = electronApp ? electronApp.process().pid : null;
	const native = appProcessIds.length ? await osByPids(appProcessIds) : await osByDirectory(path.dirname(executable), baselinePids);
	const nativeRows = Array.isArray(native) ? native : [];
	const wrapper = wrapperPid && !appProcessIds.includes(wrapperPid) ? await osByPids([wrapperPid]) : [];
	const wrapperRows = Array.isArray(wrapper) ? wrapper : [];
	const osPrivate = nativeRows.map((row) => Number(row.PrivateMemorySize64)).filter((value) => Number.isFinite(value) && value > 0);
	const osWorking = nativeRows.map((row) => Number(row.WorkingSet64)).filter((value) => Number.isFinite(value) && value > 0);
	const osCpu = nativeRows.map((row) => Number(row.CPU)).filter(Number.isFinite);
	const privateFields = electron.map((metric) => metric.memory?.privateBytes).filter((value) => Number.isFinite(value) && value > 0);
	const workingFields = electron.map((metric) => metric.memory?.workingSetSize).filter((value) => Number.isFinite(value) && value > 0);
	const record = {
		at: new Date().toISOString(),
		elapsedMs: performance.now(),
		scenario,
		details,
		processCount: nativeRows.length,
		appProcessIds,
		playwrightWrapperPid: wrapperPid,
		os: nativeRows,
		wrapperOs: wrapperRows,
		electron,
		electronError,
		osError: Array.isArray(native) ? null : native.error,
		canonicalMemorySource: "os-private-bytes",
		osPrivateBytes: sum(osPrivate),
		osWorkingSetBytes: sum(osWorking),
		osCpuSeconds: sum(osCpu),
		electronPrivateBytes: electron.length && privateFields.length === electron.length ? sum(privateFields) * 1024 : null,
		electronWorkingSetBytes: electron.length && workingFields.length === electron.length ? sum(workingFields) * 1024 : null,
		electronCpuPercent: sum(electron.map((metric) => Number(metric.cpu?.percentCPUUsage)).filter(Number.isFinite)),
		electronPrivateBytesAvailable: electron.length > 0 && privateFields.length === electron.length,
	};
	rawSamples.push(record);
	await appendFile(samplesPath, JSON.stringify(record) + "\n", "utf8");
	samplesWritten++;
	return record;
}

async function sampleElectron(scenario, details = {}) {
	let electron = [];
	let electronError = null;
	if (electronApp) {
		try { electron = await electronApp.evaluate(({ app }) => app.getAppMetrics()); }
		catch (error) { electronError = error instanceof Error ? error.message : String(error); }
	}
	const privateFields = electron.map((metric) => metric.memory?.privateBytes).filter((value) => Number.isFinite(value) && value > 0);
	const workingFields = electron.map((metric) => metric.memory?.workingSetSize).filter((value) => Number.isFinite(value) && value > 0);
	const record = {
		at: new Date().toISOString(),
		elapsedMs: performance.now(),
		scenario,
		details,
		processCount: electron.length,
		os: [],
		electron,
		electronError,
		osError: null,
		canonicalMemorySource: "electron-getAppMetrics",
		osPrivateBytes: null,
		osWorkingSetBytes: null,
		osCpuSeconds: null,
		electronPrivateBytes: electron.length && privateFields.length === electron.length ? sum(privateFields) * 1024 : null,
		electronWorkingSetBytes: electron.length && workingFields.length === electron.length ? sum(workingFields) * 1024 : null,
		electronCpuPercent: sum(electron.map((metric) => Number(metric.cpu?.percentCPUUsage)).filter(Number.isFinite)),
		electronPrivateBytesAvailable: electron.length > 0 && privateFields.length === electron.length,
	};
	rawSamples.push(record);
	await appendFile(samplesPath, JSON.stringify(record) + "\n", "utf8");
	samplesWritten++;
	return record;
}

function summarize(samples) {
	const privateMiB = samples.map((sample) => sample.osPrivateBytes === null ? null : sample.osPrivateBytes / 1024 / 1024).filter((value) => Number.isFinite(value));
	const workingMiB = samples.map((sample) => sample.osWorkingSetBytes === null ? null : sample.osWorkingSetBytes / 1024 / 1024).filter((value) => Number.isFinite(value));
	const electronPrivateMiB = samples.map((sample) => sample.electronPrivateBytes === null ? null : sample.electronPrivateBytes / 1024 / 1024).filter((value) => Number.isFinite(value));
	const cpu = samples.map((sample) => sample.electronCpuPercent).filter((value) => Number.isFinite(value));
	const first = samples.find((sample) => Number.isFinite(sample.osCpuSeconds));
	const last = [...samples].reverse().find((sample) => Number.isFinite(sample.osCpuSeconds));
	const elapsed = first && last ? (last.elapsedMs - first.elapsedMs) / 1000 : 0;
	const osCpuPercent = first && last && elapsed > 0 ? (last.osCpuSeconds - first.osCpuSeconds) / elapsed * 100 : null;
	return {
		samples: samples.length,
		startedAt: samples[0]?.at ?? null,
		endedAt: samples.at(-1)?.at ?? null,
		privateMiBMedian: rounded(median(privateMiB)),
		privateMiBPeak: privateMiB.length ? rounded(Math.max(...privateMiB)) : null,
		workingSetMiBMedian: rounded(median(workingMiB)),
		workingSetMiBPeak: workingMiB.length ? rounded(Math.max(...workingMiB)) : null,
		electronPrivateMiBMedian: rounded(median(electronPrivateMiB)),
		electronCpuPercentMedian: rounded(median(cpu)),
		osCpuPercentAggregate: rounded(osCpuPercent),
		processCountMedian: median(samples.map((sample) => sample.processCount).filter(Number.isFinite)),
		electronPrivateBytesAvailable: samples.some((sample) => sample.electronPrivateBytesAvailable),
		processes: samples.at(-1)?.electron.map((metric) => ({ pid: metric.pid, type: metric.type, name: metric.name, serviceName: metric.serviceName })) ?? [],
	};
}

function summarizeElectron(samples) {
	const privateMiB = samples.map((sample) => sample.electronPrivateBytes === null ? null : sample.electronPrivateBytes / 1024 / 1024).filter((value) => Number.isFinite(value));
	const workingMiB = samples.map((sample) => sample.electronWorkingSetBytes === null ? null : sample.electronWorkingSetBytes / 1024 / 1024).filter((value) => Number.isFinite(value));
	return {
		samples: samples.length,
		startedAt: samples[0]?.at ?? null,
		endedAt: samples.at(-1)?.at ?? null,
		privateMiBMedian: rounded(median(privateMiB)),
		privateMiBPeak: privateMiB.length ? rounded(Math.max(...privateMiB)) : null,
		workingSetMiBMedian: rounded(median(workingMiB)),
		workingSetMiBPeak: workingMiB.length ? rounded(Math.max(...workingMiB)) : null,
		electronPrivateBytesAvailable: samples.some((sample) => sample.electronPrivateBytesAvailable),
		processes: samples.at(-1)?.electron.map((metric) => ({ pid: metric.pid, type: metric.type, name: metric.name, serviceName: metric.serviceName })) ?? [],
	};
}

async function capture(scenario, durationMs = 4000, intervalMs = 1000, details = {}) {
	const started = Date.now();
	const samples = [];
	do {
		samples.push(await sampleState(scenario, details));
		const remaining = durationMs - (Date.now() - started);
		if (remaining > 0) await sleep(Math.min(intervalMs, remaining));
	} while (Date.now() - started < durationMs);
	const summary = summarize(samples);
	phases[scenario] = summary;
	return { summary, samples };
}

async function waitUntil(check, timeoutMs, description, intervalMs = 250) {
	const end = Date.now() + timeoutMs;
	let last;
	while (Date.now() < end) {
		last = await check();
		if (last) return last;
		await sleep(intervalMs);
	}
	throw new Error(`Timed out: ${description}; last=${JSON.stringify(last)}`);
}

async function originApi(origin, suffix, options) {
	const started = performance.now();
	const response = await fetch(origin + suffix, options);
	assert.equal(response.status, 200, `${suffix} returned ${response.status}`);
	const data = await response.json();
	return { ms: performance.now() - started, data };
}

async function waitForCount(origin, count, timeout = 120000) {
	return waitUntil(async () => {
		try {
			const { data } = await originApi(origin, "/api/observatory?range=all&limit=0");
			return data.totals.requests === count ? data : false;
		} catch { return false; }
	}, timeout, `request count ${count}`);
}

async function closeElectron() {
	if (!electronApp) return;
	const current = electronApp;
	electronApp = undefined;
	page = undefined;
	await current.close().catch(() => {});
	await sleep(500);
}

const baselinePids = new Set();
const initialNative = await osByDirectory(path.dirname(executable));
if (Array.isArray(initialNative)) for (const row of initialNative) baselinePids.add(Number(row.Id));
const runStartedAt = new Date().toISOString();
let startupActive = true;
let startupPhase = "startup";
const startupPromise = (async () => {
	const samples = [];
	do {
		samples.push(await sampleState(startupPhase));
		await sleep(400);
	} while (startupActive);
	return samples;
})();
let fastStartupActive = false;
let fastStartupPromise;

let origin;
try {
	const launchStarted = performance.now();
	electronApp = await _electron.launch({ executablePath: executable, cwd: home, env, timeout: 60000 });
	fastStartupActive = true;
	fastStartupPromise = (async () => {
		while (fastStartupActive) {
			await sampleElectron(startupPhase === "startup" ? "startup-fast" : "catchup-fast");
			await sleep(250);
		}
	})();
	page = await electronApp.firstWindow();
	page.setDefaultTimeout(45000);
	page.on("pageerror", (error) => pageErrors.push(error.message));
	page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
	await page.waitForURL(/^http:\/\/127\.0\.0\.1:\d+\//, { timeout: 60000 });
	await electronApp.evaluate(({ BrowserWindow }) => {
		const window = BrowserWindow.getAllWindows()[0];
		window.setMinimumSize(900, 600);
		window.setContentSize(1440, 1000);
	});
	await page.emulateMedia({ reducedMotion: "reduce" });
	await page.getByTestId("request-total").waitFor({ timeout: 120000 });
	const uiReadyMs = performance.now() - launchStarted;
	origin = new URL(page.url()).origin;
	startupPhase = "catchup";
	const afterStartup = await waitForCount(origin, manifest.expected.afterStartupPartialLine.requests);
	assert.equal(afterStartup.totals.requests, manifest.expected.afterStartupPartialLine.requests);
	startupActive = false;
	fastStartupActive = false;
	const startupSamples = await startupPromise;
	await fastStartupPromise;
	const fastStartupSamples = rawSamples.filter((sample) => sample.scenario === "startup-fast" || sample.scenario === "catchup-fast");
	phases.startupCatchupPeak = {
		os: startupSamples.length ? summarize(startupSamples) : null,
		electronSampled: fastStartupSamples.length ? summarizeElectron(fastStartupSamples) : null,
		coverage: {
			osSamples: startupSamples.length,
			electronSamples: fastStartupSamples.length,
			startedAt: [...startupSamples, ...fastStartupSamples].map((sample) => sample.elapsedMs).filter(Number.isFinite).reduce((min, value) => Math.min(min, value), Infinity),
			endedAt: [...startupSamples, ...fastStartupSamples].map((sample) => sample.elapsedMs).filter(Number.isFinite).reduce((max, value) => Math.max(max, value), -Infinity),
			note: "OS sampling is canonical and lower-frequency; the Electron series is the explicitly sampled 250ms peak and is not substituted for stable OS measurements.",
		},
	};
	if (!Number.isFinite(phases.startupCatchupPeak.coverage.startedAt)) phases.startupCatchupPeak.coverage.startedAt = null;
	if (!Number.isFinite(phases.startupCatchupPeak.coverage.endedAt)) phases.startupCatchupPeak.coverage.endedAt = null;

	await appendFile(sourceFile, recoverySuffix + "\n", "utf8");
	await sleep(3100);
	const recoveryStarted = performance.now();
	const recoveryResponse = await originApi(origin, "/api/observatory/collection", {
		method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "collect" }),
	});
	const afterRecovery = await waitForCount(origin, manifest.expected.afterPartialRecovery.requests);
	phases.partialLineRecovery = {
		collectionHttpMs: rounded(recoveryResponse.ms),
		wallMs: rounded(performance.now() - recoveryStarted),
		requests: afterRecovery.totals.requests,
		state: recoveryResponse.data,
	};
	assert.equal(afterRecovery.totals.requests, manifest.expected.afterPartialRecovery.requests);

	const fullResponse = page.waitForResponse((response) => {
		const url = new URL(response.url());
		return url.pathname === "/api/observatory" && url.searchParams.get("range") === "all" && response.status() === 200;
	});
	await page.getByRole("button", { name: "全部", exact: true }).click();
	await fullResponse;
	await page.locator('main[aria-busy="false"]').waitFor();
	const initial = (await originApi(origin, "/api/observatory?range=all&limit=0")).data;
	const initialExpected = manifest.expected.afterPartialRecovery;
	assert.equal(initial.totals.requests, initialExpected.requests);
	assert.equal(initial.totals.input, initialExpected.input);
	assert.equal(initial.totals.output, initialExpected.output);
	assert.equal(initial.totals.cache, initialExpected.cache);
	assert.equal(initial.attribution.coverage.projects.knownRequests, initialExpected.knownProjects);
	assert.equal(initial.attribution.coverage.sessions.knownRequests, initialExpected.knownSessions);
	await sleep(1500);
	await capture("stable-idle", 6000, 1000);
	await capture("overview", 4000, 1000);

	const apis = [];
	for (let index = 0; index < 8; index++) {
		const result = await originApi(origin, `/api/observatory?range=${index % 2 ? "today" : "all"}&limit=50`);
		if (index % 2 === 0) assert.equal(result.data.totals.requests, initialExpected.requests);
		else assert.equal(result.data.totals.requests, 0, "Fixed historical fixture must not leak into today's range");
		apis.push({ range: index % 2 ? "today" : "all", requests: result.data.totals.requests, ms: rounded(result.ms) });
		await sleep(150);
	}
	phases.apiLatency = {
		samples: apis,
		medianMs: rounded(median(apis.map((sample) => sample.ms))),
		maxMs: rounded(Math.max(...apis.map((sample) => sample.ms))),
	};

	await page.getByRole("link", { name: "请求流水", exact: true }).click();
	await page.locator(".obs-request-table tbody tr").first().waitFor();
	await page.locator('main[aria-busy="false"]').waitFor();
	const rowCount = await page.locator(".obs-request-table tbody tr").count();
	assert.equal(rowCount, 50, "Request list must render exactly one 50-row page");
	await capture("requests-50", 4000, 1000, { rows: rowCount });
	const scroll = await page.evaluate(() => new Promise((resolve) => {
		const table = document.querySelector(".obs-table-scroll");
		const frameTimes = [];
		let previous, started;
		function frame(at) {
			started ??= at;
			if (previous !== undefined) frameTimes.push(at - previous);
			previous = at;
			const phase = Math.min(1, (at - started) / 1800);
			scrollTo(0, Math.max(0, (document.documentElement.scrollHeight - innerHeight) * phase));
			if (table) table.scrollLeft = Math.max(0, (table.scrollWidth - table.clientWidth) * Math.sin(phase * Math.PI * 2));
			if (at - started < 3600) requestAnimationFrame(frame);
			else {
				frameTimes.sort((a, b) => a - b);
				resolve({
					frames: frameTimes.length,
					medianMs: frameTimes[Math.floor(frameTimes.length / 2)] ?? null,
					p95Ms: frameTimes[Math.floor(frameTimes.length * .95)] ?? null,
					over33Ms: frameTimes.filter((value) => value > 33.4).length,
				});
			}
		}
		requestAnimationFrame(frame);
	}));
	phases.requests50Scroll = { rows: rowCount, ...scroll };

	await page.getByRole("link", { name: "模型总览", exact: true }).click();
	await page.getByTestId("request-total").waitFor();
	await page.locator('main[aria-busy="false"]').waitFor();
	const modelName = initial.models[0].model;
	await page.getByRole("button", { name: `展开 ${modelName}`, exact: true }).click();
	await page.locator(".obs-model-detail").waitFor();
	assert.ok(await page.getByRole("link", { name: "查看这个模型的请求" }).isVisible());
	await capture("model-detail", 4000, 1000, { model: modelName });

	let uiPolls = 0;
	const countUiPoll = (request) => {
		const url = new URL(request.url());
		if (url.pathname === "/api/observatory") uiPolls++;
	};
	page.on("request", countUiPoll);
	await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].hide());
	await page.evaluate(() => window.desktopWindow.isVisible()).then((visible) => assert.equal(visible, false));
	await sleep(1500);
	const hiddenPollsStart = uiPolls;
	const hiddenCapture = await capture("hidden", 4000, 1000);
	assert.equal(uiPolls, hiddenPollsStart, "Hidden window must stop UI polling");

	const restoredResponse = page.waitForResponse((response) => {
		const url = new URL(response.url());
		return url.pathname === "/api/observatory" && response.status() === 200;
	});
	const restoreStarted = performance.now();
	await electronApp.evaluate(({ BrowserWindow }) => {
		const window = BrowserWindow.getAllWindows()[0];
		window.show();
		if (window.isMinimized()) window.restore();
		window.focus();
	});
	await restoredResponse;
	const restoreMs = performance.now() - restoreStarted;
	page.off("request", countUiPoll);
	phases.restore = { responseMs: rounded(restoreMs), hidden: hiddenCapture.summary };
	await capture("restored", 4000, 1000);

	const switches = [];
	for (let index = 0; index < 4; index++) {
		const target = index % 2 ? "模型总览" : "请求流水";
		const started = performance.now();
		await page.getByRole("link", { name: target, exact: true }).click();
		if (target === "模型总览") await page.getByTestId("request-total").waitFor();
		else await page.locator(".obs-request-table tbody tr").first().waitFor();
		await page.locator('main[aria-busy="false"]').waitFor();
		switches.push({ target, ms: rounded(performance.now() - started) });
	}
	phases.repeatedSwitching = { cycles: switches, totalMs: rounded(switches.reduce((total, row) => total + row.ms, 0)) };
	await capture("after-repeated-switching", 4000, 1000);

	await page.getByRole("link", { name: "模型总览", exact: true }).click();
	await page.getByTestId("request-total").waitFor();
	await page.locator('main[aria-busy="false"]').waitFor();
	const incrementsEvidence = [];
	for (let index = 0; index < increments.continuous.length; index++) {
		const before = (await originApi(origin, "/api/observatory/collection")).data;
		const beforeCount = before.observations;
		const appendedAt = Date.now();
		await appendFile(eventsFile, JSON.stringify(increments.continuous[index]) + "\n", "utf8");
		const cycleSamples = [];
		let state;
		while (Date.now() - appendedAt < 23000) {
			state = (await originApi(origin, "/api/observatory/collection")).data;
			cycleSamples.push(await sampleState(`increment-${index + 1}-wait`, { cycle: index + 1 }));
			if (state.observations === beforeCount + 1) break;
			await sleep(1000);
		}
		assert.ok(state, `Increment ${index + 1} did not report state`);
		assert.equal(state.observations, beforeCount + 1, `Increment ${index + 1} was not automatically collected`);
		const cycleExpected = manifest.expected.afterContinuous.requests - increments.continuous.length + index + 1;
		const snapshot = await waitForCount(origin, cycleExpected, 5000);
		incrementsEvidence.push({
			cycle: index + 1,
			appendedAt: new Date(appendedAt).toISOString(),
			collectedAt: state.collectedAt,
			collectionLatencyMs: rounded(Date.now() - appendedAt),
			requests: snapshot.totals.requests,
			memory: summarize(cycleSamples),
		});
	}
	phases.continuousIncrements = incrementsEvidence;
	assert.ok(incrementsEvidence.length >= 3);
	await capture("after-increments", 4000, 1000);

	const soak = [];
	for (let round = 1; round <= soakRounds; round++) {
		const requestCountBefore = (await originApi(origin, "/api/observatory?range=all&limit=0")).data.totals.requests;
		const errorsBefore = pageErrors.length, consoleBefore = consoleErrors.length;
		const navigation = [];
		for (let pass = 0; pass < 2; pass++) {
			let started = performance.now();
			await page.getByRole("link", { name: "请求流水", exact: true }).click();
			await page.locator(".obs-request-table tbody tr").first().waitFor();
			await page.locator('main[aria-busy="false"]').waitFor();
			navigation.push({ target: "请求流水", ms: rounded(performance.now() - started) });
			started = performance.now();
			await page.getByRole("link", { name: "模型总览", exact: true }).click();
			await page.getByTestId("request-total").waitFor();
			await page.locator('main[aria-busy="false"]').waitFor();
			navigation.push({ target: "模型总览", ms: rounded(performance.now() - started) });
		}
		const memory = await capture(`soak-${round}`, 15000, 2000);
		const requestCountAfter = (await originApi(origin, "/api/observatory?range=all&limit=0")).data.totals.requests;
		assert.equal(requestCountAfter, requestCountBefore, `Soak round ${round} changed request count`);
		assert.equal(requestCountAfter, manifest.expected.afterContinuous.requests);
		assert.equal(pageErrors.length, errorsBefore, `Soak round ${round} produced a page error`);
		assert.equal(consoleErrors.length, consoleBefore, `Soak round ${round} produced a console error`);
		soak.push({
			round,
			requestCountBefore,
			requestCountAfter,
			navigation,
			memory: memory.summary,
			pageErrorsDelta: pageErrors.length - errorsBefore,
			consoleErrorsDelta: consoleErrors.length - consoleBefore,
		});
	}
	phases.soak = soak.length ? {
		rounds: soak,
		firstPrivateMiB: soak[0].memory.privateMiBMedian,
		lastPrivateMiB: soak.at(-1).memory.privateMiBMedian,
		peakPrivateMiB: soak.some((round) => Number.isFinite(round.memory.privateMiBPeak))
			? Math.max(...soak.map((round) => round.memory.privateMiBPeak).filter(Number.isFinite))
			: null,
		requestsConstant: true,
		pageErrorsDelta: 0,
		consoleErrorsDelta: 0,
	} : null;

	const beforeRestart = await waitForCount(origin, manifest.expected.afterContinuous.requests);
	assert.equal(beforeRestart.totals.input, manifest.expected.afterContinuous.input);
	await closeElectron();
	await appendFile(eventsFile, JSON.stringify(increments.restart) + "\n", "utf8");
	const restartStart = performance.now();
	electronApp = await _electron.launch({ executablePath: executable, cwd: home, env, timeout: 60000 });
	fastStartupActive = true;
	fastStartupPromise = (async () => {
		while (fastStartupActive) {
			await sampleElectron("restart-catchup-fast");
			await sleep(250);
		}
	})();
	page = await electronApp.firstWindow();
	page.setDefaultTimeout(45000);
	page.on("pageerror", (error) => pageErrors.push(error.message));
	page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
	await page.waitForURL(/^http:\/\/127\.0\.0\.1:\d+\//, { timeout: 60000 });
	await page.getByTestId("request-total").waitFor({ timeout: 120000 });
	origin = new URL(page.url()).origin;
	const afterRestart = await waitForCount(origin, manifest.expected.afterRestartCatchup.requests);
	fastStartupActive = false;
	await fastStartupPromise;
	phases.restartCatchup = {
		wallMs: rounded(performance.now() - restartStart),
		requests: afterRestart.totals.requests,
		collection: afterRestart.collection,
	};
	phases.restartCatchupElectronPeak = summarizeElectron(rawSamples.filter((sample) => sample.scenario === "restart-catchup-fast"));
	await sleep(1000);
	await capture("restart-stable", 5000, 1000);

	const final = (await originApi(origin, "/api/observatory?range=all&limit=50")).data;
	assert.equal(final.totals.requests, expected.requests);
	assert.equal(final.totals.turnRequests, 0);
	assert.equal(final.totals.input, expected.input);
	assert.equal(final.totals.output, expected.output);
	assert.equal(final.totals.cache, expected.cache);
	assert.equal(final.totals.errors, expected.errors);
	assert.equal(final.totals.inputRequests, expected.requests);
	assert.equal(final.totals.outputRequests, expected.requests);
	assert.equal(final.totals.cacheRequests, expected.requests);
	assert.equal(final.totals.tokenRequests, expected.requests);
	assert.equal(final.requestCount, expected.requests);
	assert.equal(final.requests.length, 50);
	assert.equal(final.reconciliation.observations, expected.requests);
	assert.equal(final.reconciliation.pending, 0);
	assert.equal(final.attribution.coverage.projects.knownRequests, expected.knownProjects);
	assert.equal(final.attribution.coverage.projects.unknownRequests, expected.unknownProjects);
	assert.equal(final.attribution.coverage.sessions.knownRequests, expected.knownSessions);
	assert.equal(final.attribution.coverage.sessions.unknownRequests, expected.unknownSessions);
	for (const model of final.models) {
		const oracle = expected.byModel[model.model];
		assert.ok(oracle, `Unexpected model ${model.model}`);
		assert.equal(model.requests, oracle.requests, `Model request count drifted: ${model.model}`);
		assert.equal(model.input, oracle.input, `Model input drifted: ${model.model}`);
		assert.equal(model.output, oracle.output, `Model output drifted: ${model.model}`);
	}
	assert.equal(Object.keys(expected.byModel).length, final.models.length);
	assert.equal(pageErrors.length, 0, pageErrors.join("\n"));
	assert.equal(consoleErrors.length, 0, consoleErrors.join("\n"));
	assert.ok(rawSamples.some((sample) => sample.canonicalMemorySource === "os-private-bytes" && Number.isFinite(sample.osPrivateBytes) && sample.osPrivateBytes > 0), "No positive OS Private Bytes sample");
	assert.ok(rawSamples.every((sample) => sample.osPrivateBytes === null || Number.isFinite(sample.osPrivateBytes)));

	const resources = path.join(path.dirname(executable), "resources");
	const artifacts = {
		executable: await optionalFileHash(executable),
		appAsar: await optionalFileHash(path.join(resources, "app.asar")),
		serverCjs: await optionalFileHash(path.join(resources, "server", "server.cjs")),
	};
	const harnessSha256 = await fileHash(fileURLToPath(import.meta.url));
	const exeHash = artifacts.executable?.sha256;
	const endedAt = new Date().toISOString();
	const electronMetadata = await electronApp.evaluate(({ app }) => ({
		version: app.getVersion(),
		packaged: app.isPackaged,
		hardwareAcceleration: app.isHardwareAccelerationEnabled(),
	})).catch(() => ({}));
	const summary = {
		format: "model-observatory-runtime-memory-run-v1",
		status: "complete",
		label,
		run,
		runStartedAt,
		runEndedAt: endedAt,
		uiReadyMs: rounded(uiReadyMs),
		durationSeconds: rounded((Date.parse(endedAt) - Date.parse(runStartedAt)) / 1000),
		executable,
		executableSha256: exeHash,
		applicationArtifacts: artifacts,
		harnessSha256,
		soakRoundsRequested: soakRounds,
		soak: phases.soak,
		electron: electronMetadata,
		fixture: {
			path: fixture,
			profile: manifest.profile,
			scale: manifest.scale,
			semanticSha256: manifest.semanticSha256,
			files: manifest.files,
			fixedTime: manifest.fixedTime,
		},
		environment: {
			platform: process.platform,
			arch: process.arch,
			osVersion: os.version(),
			cpu: os.cpus()[0]?.model ?? "unknown",
			logicalCpus: os.cpus().length,
			totalMemoryBytes: os.totalmem(),
			node: process.version,
		},
		isolation: {
			relocatedApplication: false,
			home,
			profile,
			store,
			temp,
			pathWithoutNode: !String(env.PATH).toLowerCase().includes("node"),
			playwrightLaunchWrapperExcludedFromCanonical: true,
		},
		correctness: {
			requests: final.totals.requests,
			input: final.totals.input,
			output: final.totals.output,
			cache: final.totals.cache,
			knownProjects: final.attribution.coverage.projects.knownRequests,
			unknownProjects: final.attribution.coverage.projects.unknownRequests,
			knownSessions: final.attribution.coverage.sessions.knownRequests,
			unknownSessions: final.attribution.coverage.sessions.unknownRequests,
			pageRows: 50,
			partialJsonLineRecovered: true,
			restartCatchup: true,
			pageErrors,
			consoleErrors,
		},
		electronMetricSemantics: {
			memoryUnit: "KiB",
			privateBytesWindowsFieldObserved: rawSamples.some((sample) => sample.electronPrivateBytesAvailable),
			canonicalSource: "PowerShell Get-Process PrivateMemorySize64 and WorkingSet64, summed only over PIDs returned by Electron getAppMetrics; the Playwright launch wrapper is recorded separately and excluded",
			cpuSource: "Electron percentCPUUsage for intervals and cumulative Get-Process CPU seconds for the window aggregate",
			note: "Electron privateBytes is retained for verification; missing or non-positive values become null and are never interpreted as zero memory.",
		},
		phases,
		apiLatency: phases.apiLatency,
		requests50Scroll: phases.requests50Scroll,
		rawSamples: samplesPath,
		rawSampleCount: samplesWritten,
		method: "Packaged Electron EXE through Playwright _electron. Each run copies a hash-verified fixture into a private home/profile/store; starts from database history with a deliberate partial source line; measures fixed windows; uses three automatic 15-second collection cycles; closes and relaunches for offline catch-up. No GC, heap cap, working-set trim, collector interval change, or production code change. OS Private Bytes are canonical; Electron metrics are collected by PID/type alongside.",
	};
	await writeFile(summaryPath, JSON.stringify(summary, null, 2) + "\n", "utf8");
	const summaries = [];
	for (const name of await readdir(evidenceDir)) {
		if (!name.endsWith(".summary.json")) continue;
		try { summaries.push(JSON.parse(await readFile(path.join(evidenceDir, name), "utf8"))); } catch { /* Ignore an interrupted sibling. */ }
	}
	const comparable = summaries.filter((row) =>
		row.status === "complete"
		&& row.fixture?.semanticSha256 === summary.fixture.semanticSha256
		&& row.executableSha256 === summary.executableSha256
		&& row.applicationArtifacts?.appAsar?.sha256 === summary.applicationArtifacts.appAsar?.sha256
		&& row.applicationArtifacts?.serverCjs?.sha256 === summary.applicationArtifacts.serverCjs?.sha256
		&& row.harnessSha256 === summary.harnessSha256,
	);
	const aggregate = {
		label,
		executableSha256: exeHash,
		appAsarSha256: summary.applicationArtifacts.appAsar?.sha256 ?? null,
		serverCjsSha256: summary.applicationArtifacts.serverCjs?.sha256 ?? null,
		harnessSha256,
		fixtureSemanticSha256: manifest.semanticSha256,
		profile: manifest.profile,
		minimumIndependentRuns: 3,
		runsObserved: comparable.length,
		meetsMinimumRuns: comparable.length >= 3,
		runs: comparable.map((row) => ({
			run: row.run,
			runStartedAt: row.runStartedAt,
			durationSeconds: row.durationSeconds,
			stableIdlePrivateMiB: row.phases["stable-idle"]?.privateMiBMedian,
			overviewPrivateMiB: row.phases.overview?.privateMiBMedian,
			requestsPrivateMiB: row.phases["requests-50"]?.privateMiBMedian,
			modelDetailPrivateMiB: row.phases["model-detail"]?.privateMiBMedian,
			hiddenPrivateMiB: row.phases.hidden?.privateMiBMedian,
			restoredPrivateMiB: row.phases.restored?.privateMiBMedian,
			cpuPercentMedian: row.phases["stable-idle"]?.electronCpuPercentMedian,
			soakRounds: row.phases.soak?.rounds.length ?? 0,
			soakFirstPrivateMiB: row.phases.soak?.firstPrivateMiB ?? null,
			soakLastPrivateMiB: row.phases.soak?.lastPrivateMiB ?? null,
			soakPeakPrivateMiB: row.phases.soak?.peakPrivateMiB ?? null,
		})),
		updatedAt: endedAt,
		note: "Three separate harness invocations with the same label, harness hash, EXE hash, app.asar hash, server.cjs hash and fixture semantic hash are required. A single run cannot satisfy the run-count requirement.",
	};
	await writeFile(path.join(evidenceDir, "aggregate.json"), JSON.stringify(aggregate, null, 2) + "\n", "utf8");
	console.log(JSON.stringify({
		label,
		run,
		profile: manifest.profile,
		requests: final.totals.requests,
		durationSeconds: summary.durationSeconds,
		stableIdlePrivateMiB: phases["stable-idle"]?.privateMiBMedian,
		requestsPrivateMiB: phases["requests-50"]?.privateMiBMedian,
		modelDetailPrivateMiB: phases["model-detail"]?.privateMiBMedian,
		hiddenPrivateMiB: phases.hidden?.privateMiBMedian,
		restoredPrivateMiB: phases.restored?.privateMiBMedian,
		electronPrivateBytesAvailable: summary.electronMetricSemantics.privateBytesWindowsFieldObserved,
		soakRounds,
		summary: summaryPath,
		aggregateRuns: comparable.length,
	}, null, 2));
} catch (error) {
	startupActive = false;
	fastStartupActive = false;
	const failure = {
		status: "failed",
		label,
		run,
		failedAt: new Date().toISOString(),
		error: error instanceof Error ? error.stack ?? error.message : String(error),
		phases,
		pageErrors,
		consoleErrors,
		rawSamples: samplesPath,
	};
	await writeFile(path.join(evidenceDir, `${run}.failure.json`), JSON.stringify(failure, null, 2) + "\n", "utf8");
	throw error;
} finally {
	startupActive = false;
	await closeElectron();
	if (path.dirname(scratch) === os.tmpdir() && path.basename(scratch).startsWith("ModelObservatoryRuntimeMemory-")) {
		await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
	}
}
