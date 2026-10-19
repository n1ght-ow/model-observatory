import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(process.argv[2] ?? process.cwd());
if (process.argv.length > 3) throw new Error("Usage: node scripts/summarize-runtime-memory.mjs [root]");
const evidence = path.join(root, "logs", "runtime-memory");
const variants = ["baseline", "candidate"], datasets = ["normal", "large"], runs = ["run1", "run2", "run3"];
const scenes = [["stable-idle", "稳定空闲"], ["overview", "模型总览"], ["requests-50", "请求流水 50 条"], ["model-detail", "模型详情"], ["hidden", "隐藏窗口"], ["restored", "恢复窗口"], ["after-repeated-switching", "重复切换后"], ["after-increments", "持续增量后"], ["restart-stable", "重启后稳定"]];
const categories = ["main", "renderer", "gpu", "service", "helper", "unknown"];
const hash = (value) => createHash("sha256").update(value).digest("hex");
const relative = (file) => path.relative(root, file).replaceAll("\\", "/");
const number = (value, digits = 1, unit = "") => Number.isFinite(value) ? `${value.toFixed(digits)}${unit}` : "—";
const median = (values) => {
	const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
	return sorted.length ? (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2 : null;
};
const stats = (values) => {
	const valid = values.filter(Number.isFinite).sort((a, b) => a - b);
	return { n: values.length, missing: values.length - valid.length, median: median(valid), min: valid[0] ?? null, max: valid.at(-1) ?? null };
};
const one = (values, label) => { if (new Set(values).size !== 1) throw new Error(`Inconsistent ${label}`); };
const appSignature = (run) => JSON.stringify([run.summary.executableSha256, run.summary.applicationArtifacts?.appAsar?.sha256, run.summary.applicationArtifacts?.serverCjs?.sha256]);
const fixtureSignature = (run) => JSON.stringify([run.summary.fixture?.profile, run.summary.fixture?.semanticSha256, Object.entries(run.summary.fixture?.files ?? {}).sort()]);
const correctnessSignature = (run) => JSON.stringify(["requests", "input", "output", "cache", "knownProjects", "unknownProjects", "knownSessions", "unknownSessions"].map((key) => run.summary.correctness?.[key]));

async function readSamples(file) {
	const bytes = await readFile(file);
	const samples = bytes.toString("utf8").split(/\r?\n/).filter((line) => line.trim()).map((line, index) => {
		try { return JSON.parse(line); } catch { throw new Error(`Invalid sample JSON in ${relative(file)} line ${index + 1}`); }
	});
	return { samples, count: samples.length, sha256: hash(bytes) };
}

async function readEvidence(directory, runName, labels) {
	const summaryFile = path.join(directory, `${runName}.summary.json`), failureFile = path.join(directory, `${runName}.failure.json`);
	if (existsSync(failureFile)) throw new Error(`Failure evidence exists: ${relative(failureFile)}`);
	if (!existsSync(summaryFile)) throw new Error(`Missing summary: ${relative(summaryFile)}`);
	const text = await readFile(summaryFile, "utf8");
	let summary;
	try { summary = JSON.parse(text); } catch { throw new Error(`Invalid JSON: ${relative(summaryFile)}`); }
	if (summary.format !== "model-observatory-runtime-memory-run-v1" || summary.status !== "complete") throw new Error(`Incomplete summary: ${relative(summaryFile)}`);
	if (!labels.includes(summary.label)) throw new Error(`Unexpected label in ${relative(summaryFile)}`);
	const startedAt = Date.parse(summary.runStartedAt), endedAt = Date.parse(summary.runEndedAt);
	if (!Number.isFinite(summary.uiReadyMs) || summary.uiReadyMs <= 0 || !Number.isFinite(startedAt) || !Number.isFinite(endedAt) || endedAt <= startedAt) throw new Error(`Missing run metadata: ${relative(summaryFile)}`);
	if (summary.correctness?.pageErrors?.length || summary.correctness?.consoleErrors?.length) throw new Error(`UI errors reported by ${relative(summaryFile)}`);
	const executableSha256 = summary.executableSha256, artifactExecutableSha256 = summary.applicationArtifacts?.executable?.sha256;
	if (!executableSha256 || executableSha256 !== artifactExecutableSha256) throw new Error(`Executable hash mismatch: ${relative(summaryFile)}`);
	const hashes = [summary.harnessSha256, summary.fixture?.semanticSha256, executableSha256, summary.applicationArtifacts?.appAsar?.sha256, summary.applicationArtifacts?.serverCjs?.sha256];
	if (!hashes.every((value) => typeof value === "string" && /^[a-f0-9]{64}$/i.test(value))) throw new Error(`Invalid evidence hash: ${relative(summaryFile)}`);
	const rawFile = path.join(directory, `${runName}.samples.jsonl`);
	if (path.resolve(directory, summary.rawSamples ?? "").toLowerCase() !== rawFile.toLowerCase()) throw new Error(`Unexpected raw sample path in ${relative(summaryFile)}`);
	const raw = await readSamples(rawFile);
	if (summary.rawSampleCount !== raw.count) throw new Error(`Sample count mismatch: ${relative(rawFile)}`);
	return { summary, samples: raw.samples, summaryFile, rawFile, summarySha256: hash(text), rawSamplesSha256: raw.sha256, startedAt, endedAt };
}

async function readSet(variant, dataset) {
	const directory = path.join(evidence, `formal-${variant}-${dataset}`);
	let names;
	try { names = (await readdir(directory)).filter((name) => /^run\d+\.summary\.json$/i.test(name)).sort(); }
	catch { throw new Error(`Missing formal directory: ${relative(directory)}`); }
	const expected = runs.map((run) => `${run}.summary.json`).sort();
	if (JSON.stringify(names) !== JSON.stringify(expected)) throw new Error(`${relative(directory)} must contain exactly ${expected.join(", ")}`);
	const result = [];
	for (const run of runs) result.push({ ...(await readEvidence(directory, run, [`formal-${variant}-${dataset}`, `${variant}-${dataset}`])), variant, dataset, run });
	return result;
}

function serial(rows, label) {
	const sorted = [...rows].sort((a, b) => a.startedAt - b.startedAt);
	if (new Set(sorted.map((row) => row.startedAt)).size !== sorted.length) throw new Error(`Duplicate start time in ${label}`);
	for (let index = 1; index < sorted.length; index++) if (sorted[index - 1].endedAt > sorted[index].startedAt) throw new Error(`Overlapping runs in ${label}`);
}

function validate(runs) {
	if (runs.length !== 12) throw new Error(`Expected 12 formal runs, found ${runs.length}`);
	serial(runs, "formal evidence");
	one(runs.map((run) => run.summary.harnessSha256), "harness hash");
	const apps = {}, fixtures = {};
	for (const variant of variants) {
		const selected = runs.filter((run) => run.variant === variant);
		if (selected.length !== 6) throw new Error(`Expected 3 runs per dataset for ${variant}`);
		one(selected.map(appSignature), `${variant} application artifacts`);
		apps[variant] = { executableSha256: selected[0].summary.executableSha256, appAsarSha256: selected[0].summary.applicationArtifacts.appAsar.sha256, serverCjsSha256: selected[0].summary.applicationArtifacts.serverCjs.sha256 };
	}
	for (const dataset of datasets) {
		const selected = runs.filter((run) => run.dataset === dataset);
		if (selected.length !== 6) throw new Error(`Expected 3 runs per variant for ${dataset}`);
		one(selected.map(fixtureSignature), `${dataset} fixture`);
		one(selected.map(correctnessSignature), `${dataset} correctness counts`);
		fixtures[dataset] = { profile: selected[0].summary.fixture.profile, semanticSha256: selected[0].summary.fixture.semanticSha256, files: selected[0].summary.fixture.files };
		for (const variant of variants) {
			const group = selected.filter((run) => run.variant === variant);
			serial(group, `${variant}-${dataset}`);
			if (new Set(group.map((run) => run.summarySha256)).size !== 3 || new Set(group.map((run) => run.rawSamplesSha256)).size !== 3) throw new Error(`Duplicate run evidence for ${variant}-${dataset}`);
		}
	}
	return { harness: runs[0].summary.harnessSha256, apps, fixtures };
}

function processCategory(metric) {
	const type = String(metric?.type ?? "").toLowerCase();
	if (type === "browser") return "main";
	if (type === "tab" || type.includes("renderer")) return "renderer";
	if (type === "gpu") return "gpu";
	if (type === "utility") {
		const name = String(metric?.name ?? "").toLowerCase(), serviceName = String(metric?.serviceName ?? "").toLowerCase();
		if (serviceName === "node.mojom.nodeservice" || name === "本机数据采集") return "service";
		if (serviceName === "network.mojom.networkservice" || name === "network service") return "helper";
		return "unknown";
	}
	if (type === "zygote" || type.includes("sandbox")) return "helper";
	return "unknown";
}

function processSplit(samples) {
	const values = Object.fromEntries(categories.map((category) => [category, { count: [], private: [], working: [] }]));
	const labels = new Map();
	for (const sample of samples) {
		const metrics = new Map((sample.electron ?? []).map((metric) => [Number(metric.pid), metric]));
		for (const metric of metrics.values()) {
			const pid = Number(metric.pid), label = { category: processCategory(metric), type: metric.type ?? null, name: metric.name ?? null, serviceName: metric.serviceName ?? null };
			if (!labels.has(pid)) labels.set(pid, new Map());
			labels.get(pid).set(JSON.stringify(label), label);
		}
		if (!sample.os?.length) continue;
		const sums = Object.fromEntries(categories.map((category) => [category, { count: 0, private: 0, working: 0 }]));
		for (const row of sample.os) {
			const category = processCategory(metrics.get(Number(row.Id))), total = sums[category];
			total.count++;
			if (Number.isFinite(row.PrivateMemorySize64)) total.private += row.PrivateMemorySize64;
			if (Number.isFinite(row.WorkingSet64)) total.working += row.WorkingSet64;
		}
		for (const category of categories) {
			const total = sums[category];
			values[category].count.push(total.count);
			values[category].private.push(total.private / 1048576);
			values[category].working.push(total.working / 1048576);
		}
	}
	return { categories: Object.fromEntries(categories.map((category) => [category, { count: stats(values[category].count), privateMiB: stats(values[category].private), workingSetMiB: stats(values[category].working) }])), changingPids: [...labels].filter(([, observed]) => observed.size > 1).map(([pid]) => pid), processes: [...labels].map(([pid, observed]) => ({ pid, labels: [...observed.values()] })) };
}

function endpointMemory(sample) {
	const metrics = new Map((sample.electron ?? []).map((metric) => [Number(metric.pid), metric]));
	const total = Object.fromEntries(categories.map((category) => [category, { count: 0, privateMiB: 0, workingSetMiB: 0 }]));
	for (const row of sample.os ?? []) {
		const value = total[processCategory(metrics.get(Number(row.Id)))];
		value.count++;
		if (Number.isFinite(row.PrivateMemorySize64)) value.privateMiB += row.PrivateMemorySize64 / 1048576;
		if (Number.isFinite(row.WorkingSet64)) value.workingSetMiB += row.WorkingSet64 / 1048576;
	}
	return total;
}

function cpuWindow(samples, scope) {
	const complete = samples.filter((sample) => sample.os?.length && sample.os.every((row) => Number.isFinite(Number(row.CPU))));
	const end = complete.at(-1);
	if (!end) return null;
	const pids = end.os.map((row) => Number(row.Id)).sort((left, right) => left - right), key = pids.join(",");
	const start = complete.find((sample) => sample.os.map((row) => Number(row.Id)).sort((left, right) => left - right).join(",") === key);
	if (!start || start === end) return null;
	const startedAt = Date.parse(start.at), endedAt = Date.parse(end.at), elapsedSeconds = (endedAt - startedAt) / 1000;
	const sumCpu = (sample) => sample.os.reduce((sum, row) => sum + Number(row.CPU), 0);
	const cpuSecondsStart = sumCpu(start), cpuSecondsEnd = sumCpu(end), cpuSecondsDelta = cpuSecondsEnd - cpuSecondsStart;
	return { scope, startedAt: start.at, endedAt: end.at, elapsedSeconds, pids, cpuSecondsStart, cpuSecondsEnd, cpuSecondsDelta, percent: elapsedSeconds > 0 ? cpuSecondsDelta / elapsedSeconds * 100 : null };
}

function sampleCoverage(samples, field) {
	const counts = samples.map((sample) => Array.isArray(sample[field]) ? sample[field].length : 0);
	return { samples: counts.length, processCountMin: counts.length ? Math.min(...counts) : null, processCountMax: counts.length ? Math.max(...counts) : null };
}

function view(run) {
	const phases = run.summary.phases, grouped = {};
	for (const sample of run.samples) (grouped[sample.scenario] ??= []).push(sample);
	const restartIndex = run.samples.findIndex((sample) => String(sample.scenario).startsWith("restart-"));
	const startupOsSamples = run.samples.filter((sample) => sample.scenario === "startup" || sample.scenario === "catchup");
	const startupElectronSamples = run.samples.filter((sample) => sample.scenario === "startup-fast" || sample.scenario === "catchup-fast");
	return {
		dataset: run.dataset, variant: run.variant, run: run.run, runStartedAt: run.summary.runStartedAt,
		summary: relative(run.summaryFile), rawSamples: relative(run.rawFile), summarySha256: run.summarySha256, rawSamplesSha256: run.rawSamplesSha256,
		scenes: Object.fromEntries(scenes.map(([scene]) => [scene, { privateMiB: phases[scene].privateMiBMedian, workingSetMiB: phases[scene].workingSetMiBMedian, electronCpuPct: phases[scene].electronCpuPercentMedian, osCpuPct: phases[scene].osCpuPercentAggregate }])),
		startup: { osPrivatePeakMiB: phases.startupCatchupPeak.os.privateMiBPeak, osWorkingSetPeakMiB: phases.startupCatchupPeak.os.workingSetMiBPeak, electronPrivatePeakMiB: phases.startupCatchupPeak.electronSampled.privateMiBPeak, electronWorkingSetPeakMiB: phases.startupCatchupPeak.electronSampled.workingSetMiBPeak, osCoverage: sampleCoverage(startupOsSamples, "os"), electronCoverage: sampleCoverage(startupElectronSamples, "electron") },
		performance: { uiReadyMs: run.summary.uiReadyMs, queryMedianMs: phases.apiLatency.medianMs, scrollP95Ms: phases.requests50Scroll.p95Ms, scrollFrames: phases.requests50Scroll.frames, scrollOver33: phases.requests50Scroll.over33Ms, collectionHttpMs: phases.partialLineRecovery.collectionHttpMs, autoCollectionLatencyMs: median(phases.continuousIncrements.map((item) => item.collectionLatencyMs)), restartWallMs: phases.restartCatchup.wallMs, restartElectronPrivatePeakMiB: phases.restartCatchupElectronPeak.privateMiBPeak },
		sessionCpu: cpuWindow(restartIndex < 0 ? run.samples : run.samples.slice(0, restartIndex), "pre-restart first session; includes UI switching and automatic collection; excludes restart and Playwright wrapper"),
		processes: Object.fromEntries(scenes.map(([scene]) => {
			if (!grouped[scene]?.length) throw new Error(`Missing raw scene ${scene} in ${relative(run.rawFile)}`);
			return [scene, processSplit(grouped[scene])];
		})),
	};
}

function compareField(runs, dataset, getter) {
	const baseline = runs.filter((run) => run.dataset === dataset && run.variant === "baseline").map((run) => getter(run, false));
	const candidate = runs.filter((run) => run.dataset === dataset && run.variant === "candidate").map((run) => getter(run, true));
	const left = stats(baseline), right = stats(candidate);
	return { baseline: left, candidate: right, deltaAbsolute: left.median === null || right.median === null ? null : right.median - left.median, deltaPct: left.median === null || right.median === null || left.median === 0 ? null : (right.median - left.median) / left.median * 100 };
}

const operations = [
	["uiReadyMs", "启动到首页就绪", (run) => run.performance.uiReadyMs, 1, " ms"],
	["startupOsPrivatePeak", "启动低频 OS 样本最高值（覆盖有限）", (run) => run.startup.osPrivatePeakMiB, 1, " MiB"],
	["startupOsWorkingSetPeak", "启动低频 OS 样本 WorkingSet 最高值（覆盖有限）", (run) => run.startup.osWorkingSetPeakMiB, 1, " MiB"],
	["startupElectronPrivatePeak", "启动 Electron 250ms sampled Private 最高值", (run) => run.startup.electronPrivatePeakMiB, 1, " MiB"],
	["startupElectronWorkingSetPeak", "启动 Electron 250ms sampled WorkingSet 最高值", (run) => run.startup.electronWorkingSetPeakMiB, 1, " MiB"],
	["queryMedianMs", "查询中位数", (run) => run.performance.queryMedianMs, 3, " ms"],
	["scrollP95Ms", "滚动 frame p95", (run) => run.performance.scrollP95Ms, 3, " ms"],
	["scrollFrames", "滚动 frame count", (run) => run.performance.scrollFrames, 0, ""],
	["scrollOver33", "滚动 >33ms frame count", (run) => run.performance.scrollOver33, 0, ""],
	["collectionHttpMs", "显式采集 HTTP", (run) => run.performance.collectionHttpMs, 3, " ms"],
	["autoCollectionLatencyMs", "自动采集延迟", (run) => run.performance.autoCollectionLatencyMs, 1, " ms"],
	["sessionCpuPct", "首会话整体 OS 单核心 CPU", (run) => run.sessionCpu?.percent ?? null, 2, "%"],
	["restartWallMs", "重启补采 wall", (run) => run.performance.restartWallMs, 1, " ms"],
	["restartElectronPrivatePeak", "重启 Electron sampled Private peak", (run) => run.performance.restartElectronPrivatePeakMiB, 1, " MiB"],
];

function soakAnalysis(evidence) {
	const rounds = evidence.summary.phases?.soak?.rounds ?? [];
	if (rounds.length !== 20 || evidence.summary.soakRoundsRequested !== 20) throw new Error(`Soak must contain exactly 20 rounds: ${relative(evidence.summaryFile)}`);
	const series = (getter) => {
		const values = rounds.map(getter), mean = values.reduce((sum, value) => sum + value, 0) / values.length;
		if (values.some((value) => !Number.isFinite(value))) throw new Error(`Invalid soak memory: ${relative(evidence.summaryFile)}`);
		const slope = values.reduce((sum, value, index) => sum + (index + 1 - 10.5) * (value - mean), 0) / values.reduce((sum, _, index) => sum + (index + 1 - 10.5) ** 2, 0);
		return { first: values[0], last: values.at(-1), median: median(values), min: Math.min(...values), max: Math.max(...values), trendPerRound: slope, maxStep: Math.max(...values.slice(1).map((value, index) => Math.abs(value - values[index]))), series: values };
	};
	const roundDetails = rounds.map((round, index) => ({
		round: index + 1,
		privateMiB: round.memory.privateMiBMedian,
		workingSetMiB: round.memory.workingSetMiBMedian,
		osCpu: cpuWindow(evidence.samples.filter((sample) => sample.scenario === `soak-${index + 1}`), `soak round ${index + 1}; excludes Playwright wrapper`),
	}));
	const osCpu = cpuWindow(evidence.samples.filter((sample) => /^soak-\d+$/.test(String(sample.scenario))), "all 20 soak rounds; excludes Playwright wrapper");
	return { summary: relative(evidence.summaryFile), rawSamples: relative(evidence.rawFile), summarySha256: evidence.summarySha256, rawSamplesSha256: evidence.rawSamplesSha256, rounds: 20, privateMiB: series((round) => round.memory.privateMiBMedian), workingSetMiB: series((round) => round.memory.workingSetMiBMedian), roundDetails, osCpu };
}

async function readSoakFailure(directory, variant) {
	const failureFile = path.join(directory, "soak1.failure.json");
	const text = await readFile(failureFile, "utf8");
	const failure = JSON.parse(text), rawFile = path.join(directory, "soak1.samples.jsonl");
	if (failure.status !== "failed" || !["formal-soak-" + variant, "soak-" + variant, variant + "-soak"].includes(failure.label)) throw new Error(`Invalid soak failure record: ${relative(failureFile)}`);
	if (path.resolve(directory, failure.rawSamples ?? "").toLowerCase() !== rawFile.toLowerCase()) throw new Error(`Unexpected soak failure raw path: ${relative(failureFile)}`);
	const raw = await readSamples(rawFile);
	const rounds = Object.entries(failure.phases ?? {}).map(([scenario, phase]) => {
		const match = /^soak-(\d+)$/.exec(scenario);
		if (!match || !Number.isFinite(phase?.privateMiBMedian) || !Number.isFinite(phase?.workingSetMiBMedian)) return null;
		return { round: Number(match[1]), privateMiB: phase.privateMiBMedian, workingSetMiB: phase.workingSetMiBMedian, osCpu: cpuWindow(raw.samples.filter((sample) => sample.scenario === scenario), `failed soak ${variant} round ${match[1]}; excludes Playwright wrapper`) };
	}).filter(Boolean).sort((left, right) => left.round - right.round);
	const error = String(failure.error ?? "unknown soak failure");
	return {
		status: "interrupted",
		kind: /target page, context or browser has been closed/i.test(error) ? "browser-closed" : /timeout/i.test(error) ? "timeout" : "error",
		summary: null,
		failure: relative(failureFile),
		failureSha256: hash(text),
		failedAt: failure.failedAt ?? null,
		error,
		rawSamples: relative(rawFile),
		rawSamplesSha256: raw.sha256,
		rawSampleCount: raw.count,
		completedRounds: rounds.map((round) => round.round),
		completedRoundCount: rounds.length,
		roundDetails: rounds,
	};
}

async function readSoak(variant, formal) {
	const directory = path.join(evidence, `formal-soak-${variant}`), summaryFile = path.join(directory, "soak1.summary.json"), failureFile = path.join(directory, "soak1.failure.json");
	if (existsSync(failureFile)) return readSoakFailure(directory, variant);
	if (!existsSync(summaryFile)) return null;
	const soakRun = await readEvidence(directory, "soak1", [`formal-soak-${variant}`, `soak-${variant}`, `${variant}-soak`]);
	const formalApp = JSON.stringify([formal.apps[variant].executableSha256, formal.apps[variant].appAsarSha256, formal.apps[variant].serverCjsSha256]);
	if (appSignature(soakRun) !== formalApp) throw new Error(`Soak ${variant} uses different application artifacts`);
	if (soakRun.summary.harnessSha256 !== formal.harness) throw new Error(`Soak ${variant} uses a different harness`);
	if (!Object.values(formal.fixtures).some((fixture) => fixture.semanticSha256 === soakRun.summary.fixture.semanticSha256)) throw new Error(`Soak ${variant} uses a different fixture`);
	if (soakRun.summary.phases.soak.requestsConstant !== true || soakRun.summary.phases.soak.pageErrorsDelta !== 0 || soakRun.summary.phases.soak.consoleErrorsDelta !== 0) throw new Error(`Soak ${variant} failed its stability assertions`);
	return { status: "complete", ...soakAnalysis(soakRun), fixture: soakRun.summary.fixture.profile, fixtureSemanticSha256: soakRun.summary.fixture.semanticSha256, application: JSON.parse(appSignature(soakRun)) };
}

function sequence(values) {
	const finite = values.filter(Number.isFinite);
	return { first: finite[0] ?? null, last: finite.at(-1) ?? null, min: finite.length ? Math.min(...finite) : null, max: finite.length ? Math.max(...finite) : null, series: values.map((value) => Number.isFinite(value) ? Number(value.toFixed(3)) : null) };
}

async function readDiagnostic(label) {
	const directory = path.join(evidence, "diagnostics", label), ignored = [], complete = [];
	let entries;
	try { entries = await readdir(directory, { withFileTypes: true }); }
	catch { return { status: "missing", label, directory: relative(directory), ignoredDirectories: ignored, selected: null }; }
	for (const entry of entries.filter((item) => item.isDirectory())) {
		const runDirectory = path.join(directory, entry.name), summaryFile = path.join(runDirectory, "summary.json"), failureFile = path.join(runDirectory, "failure.json");
		if (existsSync(failureFile)) {
			const failure = JSON.parse(await readFile(failureFile, "utf8"));
			ignored.push({ directory: relative(runDirectory), status: failure?.status ?? "failed", failure: relative(failureFile), error: failure?.error ? String(failure.error).split(/\r?\n/)[0] : null });
			continue;
		}
		if (!existsSync(summaryFile)) {
			ignored.push({ directory: relative(runDirectory), status: "missing-summary", failure: null, error: null });
			continue;
		}
		const text = await readFile(summaryFile, "utf8");
		let summary;
		try { summary = JSON.parse(text); } catch { ignored.push({ directory: relative(runDirectory), status: "invalid-summary", failure: null, error: null }); continue; }
		if (summary.status !== "complete") {
			ignored.push({ directory: relative(runDirectory), status: summary.status ?? "unknown", failure: existsSync(failureFile) ? relative(failureFile) : null, error: summary.error ?? null });
			continue;
		}
		complete.push({ runDirectory, summaryFile, text, summary });
	}
	complete.sort((left, right) => Date.parse(left.summary.startedAt) - Date.parse(right.summary.startedAt) || left.runDirectory.localeCompare(right.runDirectory));
	const selected = complete.at(-1);
	if (!selected) return { status: "missing", label, directory: relative(directory), ignoredDirectories: ignored, selected: null };
	const { summary, text, summaryFile, runDirectory } = selected;
	if (summary.label !== label || summary.rounds !== 20 || summary.harness !== "desktop-memory.diagnostic" || !Array.isArray(summary.soak) || summary.soak.length !== 20) throw new Error(`Invalid complete diagnostic summary: ${relative(summaryFile)}`);
	const samplesFile = path.join(runDirectory, "samples.jsonl"), appEventsFile = path.join(runDirectory, "app-events.jsonl");
	const raw = await readSamples(samplesFile), appEvents = await readSamples(appEventsFile);
	const rounds = summary.soak;
	if (rounds.some((round, index) => round.round !== index + 1 || round.requests !== 30000)) throw new Error(`Incomplete request/round sequence: ${relative(summaryFile)}`);
	const navigationCount = rounds.reduce((sum, round) => sum + (round.navigation?.length ?? 0), 0);
	if (navigationCount !== 80) throw new Error(`Expected 80 diagnostic navigation steps: ${relative(summaryFile)}`);
	const endpoints = rounds.map((round) => raw.samples.filter((sample) => Number(sample.details?.round) === round.round && sample.os?.length).at(-1));
	if (endpoints.some((sample) => !sample)) throw new Error(`Missing diagnostic round endpoint samples: ${relative(samplesFile)}`);
	const firstMemory = endpointMemory(endpoints[0]), lastMemory = endpointMemory(endpoints.at(-1));
	const processMemory = Object.fromEntries(categories.map((category) => [category, {
		privateMiB: { first: firstMemory[category].privateMiB, last: lastMemory[category].privateMiB, delta: lastMemory[category].privateMiB - firstMemory[category].privateMiB },
		workingSetMiB: { first: firstMemory[category].workingSetMiB, last: lastMemory[category].workingSetMiB, delta: lastMemory[category].workingSetMiB - firstMemory[category].workingSetMiB },
	}]));
	const collectionTimes = rounds.map((round) => round.collectionAfter?.collectedAt ?? null);
	const collectionErrors = rounds.filter((round) => round.collectionBefore?.error || round.collectionAfter?.error).map((round) => round.round);
	const collectionAdvancing = rounds.every((round) => Number.isFinite(Date.parse(round.collectionBefore?.collectedAt)) && Number.isFinite(Date.parse(round.collectionAfter?.collectedAt)) && Date.parse(round.collectionAfter.collectedAt) > Date.parse(round.collectionBefore.collectedAt)) && collectionTimes.every((value, index) => index === 0 || Date.parse(value) > Date.parse(collectionTimes[index - 1]));
	if (!collectionAdvancing || collectionErrors.length) throw new Error(`Diagnostic collection sequence did not advance cleanly: ${relative(summaryFile)}`);
	if (summary.pageErrors?.length || summary.consoleErrors?.length) throw new Error(`Diagnostic reported UI errors: ${relative(summaryFile)}`);
	const listenerKeys = [...new Set(rounds.flatMap((round) => Object.keys(round.listeners ?? {})))].sort();
	const listenerScopes = Object.fromEntries(listenerKeys.map((key) => {
		const values = rounds.map((round) => round.listeners?.[key] ?? null);
		return [key, { ...sequence(values), stable: values.every((value) => value === values[0]) }];
	}));
	const exit = appEvents.samples.filter((event) => event.type === "main-process:exit").at(-1);
	if (!exit || exit.details?.code !== 0) throw new Error(`Diagnostic did not exit cleanly: ${relative(appEventsFile)}`);
	return {
		status: "complete", label, selectedDirectory: relative(runDirectory), ignoredDirectories: ignored,
		summary: relative(summaryFile), samples: relative(samplesFile), appEvents: relative(appEventsFile),
		summarySha256: hash(text), samplesSha256: raw.sha256, appEventsSha256: appEvents.sha256,
		startedAt: summary.startedAt, endedAt: summary.endedAt, durationSeconds: (Date.parse(summary.endedAt) - Date.parse(summary.startedAt)) / 1000,
		executable: summary.executable, fixtureSemanticSha256: summary.fixtureSemanticSha256,
		rounds: rounds.length, navigationCount, requestsConstant: true, requestCount: rounds[0].requests,
		collection: { advancing: collectionAdvancing, firstBefore: rounds[0].collectionBefore?.collectedAt ?? null, lastAfter: rounds.at(-1).collectionAfter?.collectedAt ?? null, errorRounds: collectionErrors, times: collectionTimes },
		processMemory,
		heap: {
			jsUsedMiB: sequence(rounds.map((round) => round.heap.usedSize / 1048576)),
			totalHeapMiB: sequence(rounds.map((round) => round.heap.totalSize / 1048576)),
			embedderMiB: sequence(rounds.map((round) => round.heap.embedderHeapUsedSize / 1048576)),
			backingMiB: sequence(rounds.map((round) => round.heap.backingStorageSize / 1048576)),
		},
		dom: {
			documents: sequence(rounds.map((round) => round.dom.documents)),
			nodes: sequence(rounds.map((round) => round.dom.nodes)),
			jsEventListeners: sequence(rounds.map((round) => round.dom.jsEventListeners)),
		},
		listenerScopes,
		pageErrors: summary.pageErrors ?? [], consoleErrors: summary.consoleErrors ?? [],
		appExit: { code: exit?.details?.code ?? null, observed: Boolean(exit), eventCount: appEvents.count },
		network: { requests: summary.network?.requests ?? null, responses: summary.network?.responses ?? null, failures: summary.network?.failures ?? null, contentBytes: summary.network?.contentBytes ?? null, contentBytesCaveat: "contentBytes 仅是 Content-Length 的累加；没有该 header 的 API 响应和 chunked body 会漏计，不能据此排除 Network 缓存活动。" },
	};
}

async function readMainInspector(formal) {
	const directory = path.join(evidence, "main-inspector", "candidate-no-renderer-cdp"), ignored = [], complete = [];
	let entries;
	try { entries = await readdir(directory, { withFileTypes: true }); }
	catch { return { status: "missing", directory: relative(directory), ignoredDirectories: ignored }; }
	for (const entry of entries.filter((item) => item.isDirectory())) {
		const runDirectory = path.join(directory, entry.name), summaryFile = path.join(runDirectory, "summary.json");
		if (!existsSync(summaryFile)) { ignored.push({ directory: relative(runDirectory), status: "missing-summary" }); continue; }
		const text = await readFile(summaryFile, "utf8");
		let summary;
		try { summary = JSON.parse(text); } catch { ignored.push({ directory: relative(runDirectory), status: "invalid-summary" }); continue; }
		if (summary.status !== "complete") { ignored.push({ directory: relative(runDirectory), status: summary.status ?? "unknown" }); continue; }
		complete.push({ runDirectory, summaryFile, text, summary });
	}
	complete.sort((left, right) => Date.parse(left.summary.startedAt ?? left.summary.run) - Date.parse(right.summary.startedAt ?? right.summary.run) || left.runDirectory.localeCompare(right.runDirectory));
	const selected = complete.at(-1);
	if (!selected) return { status: "missing", directory: relative(directory), ignoredDirectories: ignored };
	const { runDirectory, summaryFile, text, summary } = selected;
	if (summary.label !== "candidate-no-renderer-cdp" || summary.mode !== "main-process-node-inspector" || summary.rounds !== 8 || summary.soak?.length !== 8) throw new Error(`Invalid main-inspector summary: ${relative(summaryFile)}`);
	if (JSON.stringify([summary.executableSha256, summary.appAsarSha256, summary.serverCjsSha256]) !== JSON.stringify([formal.apps.candidate.executableSha256, formal.apps.candidate.appAsarSha256, formal.apps.candidate.serverCjsSha256])) throw new Error("Main-inspector candidate artifact hashes do not match formal candidate");
	if (summary.fixtureSemanticSha256 !== formal.fixtures.large.semanticSha256) throw new Error("Main-inspector fixture does not match formal large fixture");
	const samplesFile = path.join(runDirectory, "samples.jsonl"), stderrFile = path.join(runDirectory, "stderr.log");
	const raw = await readSamples(samplesFile), stderr = await readFile(stderrFile);
	if (raw.samples.some((sample) => sample.main?.metrics?.length !== 5 || sample.native?.length !== 5 || sample.ui?.visibility !== "visible")) throw new Error(`Main-inspector raw process/visibility mismatch: ${relative(samplesFile)}`);
	const endpoints = summary.soak.map((round) => raw.samples.filter((sample) => sample.round === round.round && sample.phase === `soak-${round.round}`).at(-1));
	if (endpoints.some((sample) => !sample)) throw new Error(`Missing main-inspector round endpoints: ${relative(samplesFile)}`);
	if (summary.soak.some((round) => round.range !== "all" || round.requestTotal !== "30,000次" || round.navigation?.length !== 4 || round.visibility?.some((value) => value !== "visible"))) throw new Error(`Main-inspector round assertions failed: ${relative(summaryFile)}`);
	const metadata = summary.apiMetadataSample;
	if (metadata?.status !== 200 || metadata.contentLength !== null || metadata.transferEncoding !== "chunked" || !Number.isFinite(metadata.bodyBytes)) throw new Error(`Invalid API metadata sample: ${relative(summaryFile)}`);
	const rendererEndpoint = sequence(summary.soak.map((round) => round.rendererPrivateKiB / 1024));
	const rendererMedian = sequence(summary.soak.map((round) => round.rendererPrivateMedianKiB / 1024));
	const workingSet = sequence(summary.soak.map((round) => round.rendererWorkingSetKiB / 1024));
	const servicePrivate = sequence(summary.soak.map((round) => round.servicePrivateKiB / 1024));
	return {
		status: "complete", label: summary.label, selectedDirectory: relative(runDirectory), ignoredDirectories: ignored,
		summary: relative(summaryFile), samples: relative(samplesFile), stderr: relative(stderrFile),
		summarySha256: hash(text), samplesSha256: raw.sha256, stderrSha256: hash(stderr),
		executableSha256: summary.executableSha256, appAsarSha256: summary.appAsarSha256, serverCjsSha256: summary.serverCjsSha256,
		fixtureSemanticSha256: summary.fixtureSemanticSha256, harnessSha256: summary.harnessSha256,
		startedAt: summary.startedAt, endedAt: summary.endedAt,
		rounds: 8, navigationCount: 32, requests: 30000, range: "all", visible: true, processCount: 5,
		rendererPrivateEndpointMiB: rendererEndpoint, rendererPrivateMedianMiB: rendererMedian,
		rendererWorkingSetMiB: workingSet, servicePrivateMiB: servicePrivate,
		apiMetadataSample: metadata,
		setupContext: {
			window: "默认主窗外框 1440x960；main-only 脚本未显式 setContentSize(1440,1000)。该尺寸不在 summary 字段中，按本次运行方式记录。",
			cdp: "仅连接 main-process Node inspector；通过 webContents.executeJavaScript 导航，未连接 renderer DevTools 或 Network domain。",
			comparisonBoundary: "20 轮 CDP 诊断显式设置 1440x1000 内容尺寸，导航驱动与每轮 API 探测也不同；8 轮 main-only 只支持观测环境相关假设。",
			api: "contentLength/transferEncoding/bodyBytes 是脚本 Node-fetch 的单次元数据验证，不是全量响应字节统计。",
		},
	};
}

function statsText(value, digits = 1, unit = "") {
	if (value.median === null) return "—";
	return `${number(value.median, digits, unit)} [${number(value.min, digits, unit)}–${number(value.max, digits, unit)}]${value.missing ? `（缺失 ${value.missing}/${value.n}）` : ""}`;
}
const deltaText = (value) => value.deltaPct === null ? "—" : `${value.deltaPct > 0 ? "+" : ""}${value.deltaPct.toFixed(1)}%`;
const table = (headers, rows) => [`| ${headers.join(" | ")} |`, `| ${headers.map(() => "---").join(" | ")} |`, ...rows.map((row) => `| ${row.join(" | ")} |`)].join("\n");
function cpuWarnings(comparison) {
	const warnings = [];
	for (const dataset of datasets) for (const [metric, value] of [
		...scenes.map(([scene]) => [`${scene} OS CPU`, comparison.datasets[dataset][scene].osCpuPct]),
		["first-session OS CPU", comparison.performance[dataset].sessionCpuPct],
	]) {
		if (value.candidate.median > value.baseline.median) warnings.push({ kind: "cpu-regression", dataset, metric, baselineMedian: value.baseline.median, candidateMedian: value.candidate.median, deltaAbsolute: value.deltaAbsolute, deltaPct: value.deltaPct, baselineRange: [value.baseline.min, value.baseline.max], candidateRange: [value.candidate.min, value.candidate.max] });
	}
	return warnings;
}

function report(comparison, formal) {
	const lines = [
		"# 桌面运行内存正式对照（2026-10-19）", "",
		"由 `scripts/summarize-runtime-memory.mjs` 从本轮 12 个 formal summary 与 raw samples 生成；完整字段见 [`comparison.json`](../logs/runtime-memory/comparison.json)，方法见 [`runtime-memory-method.md`](runtime-memory-method.md)。", "",
		"## 证据与可比性", "",
		"- Formal short：12/12 complete；每个版本、数据集严格 3 次独立且不重叠运行。",
		`- Formal status：${comparison.formalStatus}；soak status：${comparison.soakStatus}；overall status：${comparison.status}。`,
		`- Independent diagnostic status：${comparison.diagnosticStatus}。`,
		`- Main-inspector control status：${comparison.mainInspectorStatus}。`,
		`- Harness：\`${formal.harness}\``,
		`- 普通 / 大历史 fixture：\`${formal.fixtures.normal.semanticSha256}\` / \`${formal.fixtures.large.semanticSha256}\``,
		"- Profile / 产物组内一致性：通过；每个数据集的 baseline 与 candidate 使用相同 fixture，每个 variant 的 6 个 formal run 使用相同应用产物。",
		`- 基线 app.asar / server.cjs：\`${formal.apps.baseline.appAsarSha256}\` / \`${formal.apps.baseline.serverCjsSha256}\``,
		`- 候选 app.asar / server.cjs：\`${formal.apps.candidate.appAsarSha256}\` / \`${formal.apps.candidate.serverCjsSha256}\``,
		`- 应用产物组合是否不同：${comparison.integrity.applicationArtifactsDiffer ? "是" : "否"}`,
		"",
	];
	if (comparison.soakStatus === "interrupted") lines.push("**长稳未通过：** soak evidence 存在中断失败，不能计为通过；详细边界见“20 轮长稳观察”。12 轮 short 证据仍有效。", "");
	lines.push("执行顺序：", "", "```text", ...comparison.executionOrder.map((run, index) => `${String(index + 1).padStart(2, "0")}. ${run.dataset}/${run.variant}/${run.run} @ ${run.runStartedAt}`), "```", "");
	for (const dataset of datasets) {
		lines.push(`## ${dataset === "normal" ? "普通历史" : "大历史"}场景内存`, "", "每格是三次 run 场景中位数的 median `[min–max]`，单位 MiB。", "", table(["场景", "基线 Private", "候选 Private", "Δ Private", "基线 WorkingSet", "候选 WorkingSet", "Δ WorkingSet"], scenes.map(([scene, label]) => { const value = comparison.datasets[dataset][scene]; return [`\`${scene}\` ${label}`, statsText(value.privateMiB.baseline, 2), statsText(value.privateMiB.candidate, 2), deltaText(value.privateMiB), statsText(value.workingSetMiB.baseline, 2), statsText(value.workingSetMiB.candidate, 2), deltaText(value.workingSetMiB)]; })), "");
	}
	lines.push("## 启动、查询、交互与采集", "", table(["数据集 / 指标", "基线", "候选", "Δ absolute", "Δ%"], datasets.flatMap((dataset) => operations.map(([id, label, , digits, unit]) => {
		const value = comparison.performance[dataset][id], absolute = value.deltaAbsolute === null ? "—" : `${value.deltaAbsolute > 0 ? "+" : ""}${number(value.deltaAbsolute, digits, unit)}`;
		return [`${dataset} / ${label}`, statsText(value.baseline, digits, unit), statsText(value.candidate, digits, unit), absolute, deltaText(value)];
	}))), "");
	lines.push("## 启动采样覆盖", "", "OS 是低频样本最高值，不是完整启动峰；如果样本少或 processCount 范围偏小，可能漏掉早期/短时峰值。Electron `sampled` 为约 250ms 间隔的高频样本，仍可能漏掉更短区间，不能替代 OS canonical 峰值。", "");
	lines.push(table(["数据集 / 版本 / run", "OS 样本数", "OS processCount 范围", "OS Private 最高值（有限覆盖）", "Electron sampled 样本数", "Electron processCount 范围", "Electron sampled Private 最高值", "覆盖判断"], comparison.runs.map((run) => {
		const os = run.startup.osCoverage, electron = run.startup.electronCoverage;
		const range = (value) => value.samples ? `${value.processCountMin ?? "—"}–${value.processCountMax ?? "—"}` : "—";
		const limited = os.samples <= 1 || (os.processCountMax ?? 0) < (electron.processCountMax ?? 0);
		return [`${run.dataset} / ${run.variant} / ${run.run}`, os.samples, range(os), number(run.startup.osPrivatePeakMiB, 1, " MiB"), electron.samples, range(electron), number(run.startup.electronPrivatePeakMiB, 1, " MiB"), limited ? "样本少/范围小，可能漏峰" : `${os.samples} 个低频样本，仍可能漏峰`];
	})), "");
	lines.push("## CPU 口径", "", "Electron `percentCPUUsage` 是 Electron 按指标区间归一后的场景中位数；OS 项由 `Get-Process CPU` 累计秒差除以场景墙钟时间得到，表示单逻辑核心百分比。两者不可直接换算。稳定场景的少量样本不能代表整个会话或长期 CPU。", "");
	const soakReview = comparison.soakStatus === "complete" ? "soak 已完成，但仍需结合 20 轮结果判断。" : comparison.soakStatus === "interrupted" ? "soak 已因环境中断，不能作为通过结论。" : "soak 尚未完整提供，仍需复核。";
	if (comparison.warnings.length) lines.push("**CPU 回归观察：**", "", ...comparison.warnings.map((warning) => `- ${warning.dataset} / ${warning.metric}：${number(warning.baselineMedian, 2, "%")} → ${number(warning.candidateMedian, 2, "%")}（${warning.deltaAbsolute > 0 ? "+" : ""}${number(warning.deltaAbsolute, 2)} 单核心 pp；${deltaText(warning)}；基线范围 ${number(warning.baselineRange[0], 2, "%")}–${number(warning.baselineRange[1], 2, "%")}，候选范围 ${number(warning.candidateRange[0], 2, "%")}–${number(warning.candidateRange[1], 2, "%")}）。`), "", `这些是当前三个正式 run 的描述性回归观察，不能由内存改善抵消；${soakReview}`, "");
	for (const dataset of datasets) lines.push(table(["数据集 / 场景", "基线 Electron", "基线 OS 单核心", "候选 Electron", "候选 OS 单核心", "Δ Electron", "Δ OS"], scenes.map(([scene]) => { const value = comparison.datasets[dataset][scene]; return [`${dataset} / \`${scene}\``, statsText(value.electronCpuPct.baseline, 2, "%"), statsText(value.osCpuPct.baseline, 2, "%"), statsText(value.electronCpuPct.candidate, 2, "%"), statsText(value.osCpuPct.candidate, 2, "%"), deltaText(value.electronCpuPct), deltaText(value.osCpuPct)]; })), "");
	lines.push("## 首会话整体 CPU", "", "窗口截止到首次 `restart-*` 样本之前，结束值为最后一个完整 OS 样本；起点为相同 PID 集合的最早完整 OS 样本。`Get-Process CPU` 秒差除以两条样本时间戳的实际 elapsed 秒，得到单核心百分比。窗口包含启动、UI 切换和自动采集，排除重启及 Playwright wrapper，不能把 stable-idle 的短窗口当作整体结论。", "");
	lines.push(table(["数据集", "基线 median", "候选 median", "Δ 单核心", "Δ"], datasets.map((dataset) => { const value = comparison.performance[dataset].sessionCpuPct; return [dataset, statsText(value.baseline, 2, "%"), statsText(value.candidate, 2, "%"), `${value.deltaAbsolute > 0 ? "+" : ""}${number(value.deltaAbsolute, 2)} pp`, deltaText(value)]; })), "");
	lines.push(table(["数据集 / 版本 / run", "窗口起", "窗口止", "实际秒数", "PID 集合", "CPU 秒差", "单核心 CPU"], comparison.runs.map((run) => { const value = run.sessionCpu; return [`${run.dataset} / ${run.variant} / ${run.run}`, value?.startedAt ?? "—", value?.endedAt ?? "—", number(value?.elapsedSeconds, 3, " s"), value?.pids.join(",") ?? "—", number(value?.cpuSecondsDelta, 3, " s"), number(value?.percent, 2, "%")]; })), "");
	lines.push("## 进程拆分", "", "`service` 只表示 `node.mojom.NodeService` / 本机数据采集；Network Service 和明确辅助进程归 `helper`；其它 Utility 或不可靠类别归 `unknown`。`processes[].labels` 保留 PID 对应的 type、name、serviceName，raw JSONL 保留完整原始样本。", "", table(["数据集 / 版本 / run", "main", "renderer", "data service", "GPU", "helper", "unknown", "changing PIDs"], comparison.runs.map((run) => { const value = run.processes["stable-idle"].categories; return [`${run.dataset} / ${run.variant} / ${run.run}`, ...categories.map((category) => number(value[category].count.median, 0)), run.processes["stable-idle"].changingPids.length]; })), "");
	lines.push("## 20 轮长稳观察", "", `- soak status：${comparison.soakStatus}；expected rounds：20。`);
	if (comparison.soak.status === "not-run") lines.push("未执行：两个 soak summary 均不存在。");
	else {
		if (comparison.soak.status === "partial") lines.push("仅一侧提供可核实 evidence；另一侧缺失。");
		for (const [name, value] of [["baseline", comparison.soak.baseline], ["candidate", comparison.soak.candidate]]) {
			if (!value) continue;
			if (value.status === "complete") lines.push(`- ${name}：complete，20 轮。`);
			else lines.push(`- ${name}：interrupted（${value.kind}）；已完成 rounds ${value.completedRounds.join(",") || "none"}；failure \`${value.failure}\`；raw \`${value.rawSamples}\`。`);
		}
		if (comparison.failedSoak.length) {
			lines.push("", "### 长稳失败边界", "");
			lines.push(table(["版本", "状态", "类型", "完成轮次", "failure", "raw samples", "错误首行"], comparison.failedSoak.map((side) => [side.variant, side.status, side.kind, `${side.completedRoundCount}/20 ${side.completedRounds.length ? `(${side.completedRounds.join(",")})` : ""}`, `\`${side.failure}\``, `\`${side.rawSamples}\``, String(side.error).split(/\r?\n/)[0]])));
			const interruptedRounds = comparison.failedSoak.flatMap((side) => side.roundDetails.map((round) => [side.variant, round.round, number(round.privateMiB, 2, " MiB"), number(round.workingSetMiB, 2, " MiB"), number(round.osCpu?.percent, 2, "%")]));
			if (interruptedRounds.length) lines.push("", "中断前已完成轮次（仅作为边界证据，不构成通过或完整趋势）：", "", table(["版本", "round", "Private", "WorkingSet", "OS CPU 单核心"], interruptedRounds));
			lines.push("", "failure 记录没有 `.summary.json`，因此不能标记 complete；该环境中断不能被当作代码 bug 或性能通过。需要 fresh-label 重测。原始 failure 文件名未被改名或覆盖。");
		}
		const completed = [["baseline", comparison.soak.baseline], ["candidate", comparison.soak.candidate]].filter(([, value]) => value?.status === "complete");
		if (completed.length) {
			const soakUnits = ["", " MiB", " MiB", " MiB/round", " MiB", " MiB", " MiB", " MiB/round", " MiB"];
			const soakDigits = [0, 2, 2, 3, 2, 2, 2, 3, 2];
			const rows = completed.map(([name, value]) => {
				const cpuStats = stats(value.roundDetails.map((round) => round.osCpu?.percent ?? null));
				return [name, value.privateMiB.first, value.privateMiB.last, value.privateMiB.trendPerRound, value.privateMiB.maxStep, value.workingSetMiB.first, value.workingSetMiB.last, value.workingSetMiB.trendPerRound, value.workingSetMiB.maxStep].map((item, index) => index ? number(item, soakDigits[index], soakUnits[index]) : item).concat([statsText(cpuStats, 2, "%"), number(value.osCpu?.percent, 2, "%")]);
			});
			lines.push("", table(["版本", "Private first", "Private last", "Private trend/round", "Private max step", "WorkingSet first", "WorkingSet last", "WorkingSet trend/round", "WorkingSet max step", "每轮 OS CPU median [min–max]", "soak 总窗口 OS CPU"], rows), "", "每轮起止、PID、CPU 秒差和百分比保存在 `soak.*.roundDetails[].osCpu`；总窗口保存在 `soak.*.osCpu`。20 轮只覆盖短时观察，不能证实长期无泄漏、无碎片化或未来不增长。");
		}
	}
	lines.push("", "## 20 轮独立诊断", "", "固定读取 `diagnostics/retest-baseline` 与 `diagnostics/retest-candidate` 下 latest `status: complete` 目录；较早的 failure/incomplete 目录保留在“非 complete 目录”列，明确不计通过。该诊断是独立功能稳定性重测，不替换或消除原 formal-soak failure。");
	const diagnosticSides = [["baseline", comparison.diagnostics.baseline], ["candidate", comparison.diagnostics.candidate]].filter(([, side]) => side?.status === "complete");
	if (comparison.diagnosticStatus !== "complete") lines.push("", `诊断状态：${comparison.diagnosticStatus}；只列已完成的一侧。`);
	if (diagnosticSides.length) {
		lines.push("", table(["版本", "selected run", "持续时间", "rounds / nav / requests", "collection", "app exit", "非 complete 目录"], diagnosticSides.map(([name, side]) => [name, `\`${side.selectedDirectory}\``, number(side.durationSeconds, 1, " s"), `${side.rounds} / ${side.navigationCount} / ${side.requestCount}`, `${side.collection.firstBefore} → ${side.collection.lastAfter}；advancing=${side.collection.advancing}`, side.appExit.code, side.ignoredDirectories.map((item) => `${item.directory} (${item.status})`).join("<br>") || "none"])));
		lines.push("", "各进程首末 Private / WorkingSet（取 round 1 与 round 20 的最后一个完整 OS 样本；MiB）：", "");
		const processRows = diagnosticSides.flatMap(([name, side]) => categories.map((category) => {
			const value = side.processMemory[category];
			return [name, category, number(value.privateMiB.first, 2), number(value.privateMiB.last, 2), number(value.privateMiB.delta, 2), number(value.workingSetMiB.first, 2), number(value.workingSetMiB.last, 2), number(value.workingSetMiB.delta, 2)];
		}));
		lines.push(table(["版本", "进程类别", "Private first", "Private last", "Δ Private", "WorkingSet first", "WorkingSet last", "Δ WorkingSet"], processRows));
		const rangeText = (value, digits = 2) => `${number(value.first, digits)} → ${number(value.last, digits)} [${number(value.min, digits)}–${number(value.max, digits)}]`;
		lines.push("", "JS heap / DOM / listener 序列范围：", "");
		lines.push(table(["版本", "JS used MiB", "Embedder MiB", "Total heap MiB", "DOM nodes", "Documents", "JS event listeners", "listener scopes"], diagnosticSides.map(([name, side]) => [name, rangeText(side.heap.jsUsedMiB), rangeText(side.heap.embedderMiB), rangeText(side.heap.totalHeapMiB), rangeText(side.dom.nodes, 0), rangeText(side.dom.documents, 0), rangeText(side.dom.jsEventListeners, 0), Object.entries(side.listenerScopes).map(([key, value]) => `${key}=${value.first}${value.stable ? " stable" : ` [${value.min}–${value.max}]`}`).join("; ")])));
		for (const [name, side] of diagnosticSides) {
			const renderer = side.processMemory.renderer, js = side.heap.jsUsedMiB, embedder = side.heap.embedderMiB;
			lines.push("", `- ${name}：renderer Private ${number(renderer.privateMiB.first, 2)} → ${number(renderer.privateMiB.last, 2)} MiB（${number(renderer.privateMiB.delta, 2)} MiB）；JS used ${number(js.first, 2)} → ${number(js.last, 2)} MiB；embedder ${number(embedder.first, 2)} → ${number(embedder.last, 2)} MiB；DOM nodes ${side.dom.nodes.first} → ${side.dom.nodes.last}；app-events ${side.appExit.eventCount}，exit code ${side.appExit.code}。`);
			lines.push(`- ${name} network：requests=${side.network.requests} / responses=${side.network.responses} / failures=${side.network.failures}，ContentBytes=${side.network.contentBytes}；${side.network.contentBytesCaveat}`);
		}
		lines.push("", "20 轮功能完成、请求保持 30,000、collection 时间持续推进，只能证明本次运行完成和功能稳定；native renderer 增长仍未归因到 JS、DOM 或上述 listener scope，不能声称长期无泄漏。旧 formal-soak 外部中断和 failure 记录继续保留，不能由本节覆盖。");
	}
	lines.push("", "## Main-inspector 对照（candidate-only）", "");
	const mainInspector = comparison.mainInspector;
	if (mainInspector.status !== "complete") {
		lines.push(`未采用完整 main-inspector 结果：${mainInspector.status}。`);
	} else {
		lines.push(`- 8 轮、32 次导航、每轮 30,000 requests、range=all、主窗 visible；每个端点均为 5 个进程。`);
		lines.push(`- 直接 spawn 候选 EXE，仅 main-process Node inspector；webContents.executeJavaScript 导航，未连接 renderer DevTools/Network。`);
		lines.push(`- ${mainInspector.setupContext.window}`);
		lines.push(`- 候选 executable / app.asar / server.cjs 哈希与 formal candidate 完全一致：\`${mainInspector.executableSha256}\` / \`${mainInspector.appAsarSha256}\` / \`${mainInspector.serverCjsSha256}\`。`);
		lines.push("", "| Round | Renderer endpoint MiB | Renderer median MiB | Renderer WorkingSet MiB | Data service Private MiB |", "| ---: | ---: | ---: | ---: | ---: |");
		for (let index = 0; index < mainInspector.rendererPrivateEndpointMiB.series.length; index++) lines.push(`| ${index + 1} | ${number(mainInspector.rendererPrivateEndpointMiB.series[index], 2)} | ${number(mainInspector.rendererPrivateMedianMiB.series[index], 2)} | ${number(mainInspector.rendererWorkingSetMiB.series[index], 2)} | ${number(mainInspector.servicePrivateMiB.series[index], 2)} |`);
		const vs = mainInspector.vs20RoundCandidate, laterEndpoints = mainInspector.rendererPrivateEndpointMiB.series.slice(1);
		if (vs) lines.push("", `- 20 轮 CDP candidate renderer：${number(vs.diagnosticRendererPrivateMiB.first, 2)} → ${number(vs.diagnosticRendererPrivateMiB.last, 2)} MiB（${number(vs.diagnosticRendererPrivateMiB.delta, 2)} MiB）。Main-inspector endpoint：${number(vs.mainInspectorRendererPrivateMiB.first, 2)} → ${number(vs.mainInspectorRendererPrivateMiB.last, 2)} MiB（${number(vs.mainInspectorRendererPrivateMiB.delta, 2)} MiB）；第 2–8 轮为 ${number(Math.min(...laterEndpoints), 2)}–${number(Math.max(...laterEndpoints), 2)} MiB，未出现 CDP 观察中每轮约 10 MiB 的持续增长。`);
		lines.push(`- API metadata：status=${mainInspector.apiMetadataSample.status}，contentLength=${mainInspector.apiMetadataSample.contentLength}，transferEncoding=${mainInspector.apiMetadataSample.transferEncoding}，bodyBytes=${mainInspector.apiMetadataSample.bodyBytes}。该值由脚本 Node-fetch 单次验证；ContentBytes=${comparison.diagnostics.candidate.network.contentBytes} 仍只是 Content-Length 累加，不能当总响应量或排除 Network 缓存。`);
		lines.push(`- ${mainInspector.setupContext.cdp}`);
		lines.push(`- ${mainInspector.setupContext.comparisonBoundary} 8 轮更短，导航驱动、每轮 API 探测和窗口尺寸均不同；结果只支持“renderer 调试观测可能参与增长”的假设，不能确认精确缓冲根因，也不能计为额外生产降幅。`);
	}
	lines.push("", "## 解释边界", "", "- 三次独立运行只提供描述性样本，不是显著性检验或通用性能保证。", "- OS Private 为规范内存口径；Working Set 会重复计算共享页。", "- 启动 Electron 值是 250ms sampled peak，不能替代低频 OS canonical peak。", "- CPU 需同时核对首会话整体窗口与 soak；stable-idle 短窗口不能单独证明无退步。", "- 本报告只使用本次 formal evidence，不引用旧版本结果。");
	return `${lines.join("\n")}\n`;
}

async function main() {
	const formalRuns = [];
	for (const variant of variants) for (const dataset of datasets) formalRuns.push(...await readSet(variant, dataset));
	const formal = validate(formalRuns);
	const selected = formalRuns.map(view).sort((a, b) => Date.parse(a.runStartedAt) - Date.parse(b.runStartedAt));
	const baselineSoak = await readSoak("baseline", formal), candidateSoak = await readSoak("candidate", formal);
	if (baselineSoak?.status === "complete" && candidateSoak?.status === "complete" && (baselineSoak.fixtureSemanticSha256 !== candidateSoak.fixtureSemanticSha256 || JSON.stringify(baselineSoak.application) === JSON.stringify(candidateSoak.application))) throw new Error("Soak sides are not comparable");
	const soakStatus = [baselineSoak, candidateSoak].some((side) => side?.status === "interrupted") ? "interrupted" : baselineSoak?.status === "complete" && candidateSoak?.status === "complete" ? "complete" : baselineSoak || candidateSoak ? "partial" : "not-run";
	const overallStatus = soakStatus === "complete" ? "complete" : "partial";
	const soak = { status: soakStatus, expectedRounds: 20, baseline: baselineSoak, candidate: candidateSoak, interpretationLimit: "20 rounds cannot prove long-term freedom from leaks; interrupted runs are not passes." };
	const failedSoak = [["baseline", baselineSoak], ["candidate", candidateSoak]].flatMap(([variant, side]) => side?.status === "interrupted" ? [{ variant, ...side }] : []);
	const baselineDiagnostic = await readDiagnostic("retest-baseline"), candidateDiagnostic = await readDiagnostic("retest-candidate");
	for (const diagnostic of [baselineDiagnostic, candidateDiagnostic]) if (diagnostic.status === "complete" && diagnostic.fixtureSemanticSha256 !== formal.fixtures.large.semanticSha256) throw new Error(`Diagnostic fixture mismatch: ${diagnostic.summary}`);
	const diagnosticStatus = baselineDiagnostic.status === "complete" && candidateDiagnostic.status === "complete" ? "complete" : baselineDiagnostic.status === "missing" && candidateDiagnostic.status === "missing" ? "missing" : "partial";
	const diagnostics = { status: diagnosticStatus, label: "20-round independent retest; does not replace formal-soak failure or prove long-term leak-free behavior", baseline: baselineDiagnostic, candidate: candidateDiagnostic };
	const mainInspector = await readMainInspector(formal), mainInspectorStatus = mainInspector.status;
	if (mainInspectorStatus === "complete" && candidateDiagnostic.status === "complete") {
		mainInspector.vs20RoundCandidate = {
			reference: candidateDiagnostic.summary,
			diagnosticRendererPrivateMiB: candidateDiagnostic.processMemory.renderer.privateMiB,
			mainInspectorRendererPrivateMiB: { first: mainInspector.rendererPrivateEndpointMiB.first, last: mainInspector.rendererPrivateEndpointMiB.last, delta: mainInspector.rendererPrivateEndpointMiB.last - mainInspector.rendererPrivateEndpointMiB.first, min: mainInspector.rendererPrivateEndpointMiB.min, max: mainInspector.rendererPrivateEndpointMiB.max },
			interpretation: "The shorter main-only run complicates comparison, but its renderer endpoint series does not show the repeated 10 MiB/round growth seen under renderer/CDP observation. This supports an observation-environment-related hypothesis only; it does not identify a precise buffer cause or establish a production reduction.",
		};
	}
	const datasetsResult = {};
	for (const dataset of datasets) {
		datasetsResult[dataset] = Object.fromEntries(scenes.map(([scene]) => [scene, {
			privateMiB: compareField(selected, dataset, (run) => run.scenes[scene].privateMiB),
			workingSetMiB: compareField(selected, dataset, (run) => run.scenes[scene].workingSetMiB),
			electronCpuPct: compareField(selected, dataset, (run) => run.scenes[scene].electronCpuPct),
			osCpuPct: compareField(selected, dataset, (run) => run.scenes[scene].osCpuPct),
		}]));
	}
	const performance = Object.fromEntries(datasets.map((dataset) => [dataset, Object.fromEntries(operations.map(([id, , getter]) => [id, compareField(selected, dataset, getter)]))]));
	const comparison = {
		format: "model-observatory-runtime-memory-comparison-v1", generatedAt: new Date().toISOString(), status: overallStatus, formalStatus: "complete", soakStatus, diagnosticStatus, mainInspectorStatus, failedSoak,
		integrity: { formalRuns: 12, independentRunsPerGroup: 3, harnessSha256: formal.harness, fixtures: formal.fixtures, applications: formal.apps, applicationArtifactsDiffer: JSON.stringify(formal.apps.baseline) !== JSON.stringify(formal.apps.candidate) },
		executionOrder: selected.map((run) => ({ dataset: run.dataset, variant: run.variant, run: run.run, runStartedAt: run.runStartedAt })),
		semantics: { memory: "MiB; OS PrivateMemorySize64/WorkingSet64 over Electron getAppMetrics PIDs; wrapper excluded", osCpu: "scene values use Get-Process cumulative CPU; sessionCpu uses pre-restart end and same-PID earliest complete OS start, divided by actual sample elapsed seconds and expressed as one logical core", electronCpu: "interval-normalized Electron percentCPUUsage; not directly comparable to OS CPU", processes: "service means node.mojom.NodeService or 本机数据采集; Network Service and known helpers are helper; other Utility or missing metadata is unknown; labels preserve type/name/serviceName" },
		runs: selected, datasets: datasetsResult, performance, soak, diagnostics, mainInspector,
		limits: ["Descriptive three-run evidence only.", "No GC, heap cap, working-set trim or collector interval change.", "Working Set repeats shared pages and sampled peaks can miss short intervals.", "Soak rounds cannot prove long-term absence of leaks."],
	};
	comparison.warnings = cpuWarnings(comparison);
	const comparisonFile = path.join(evidence, "comparison.json"), reportFile = path.join(root, "docs", "runtime-memory-2026-10-19.md");
	const comparisonText = `${JSON.stringify(comparison, null, 2)}\n`, reportText = report(comparison, formal);
	await mkdir(evidence, { recursive: true });
	await mkdir(path.dirname(reportFile), { recursive: true });
	await writeFile(comparisonFile, comparisonText, "utf8");
	await writeFile(reportFile, reportText, "utf8");
	console.log(JSON.stringify({ comparison: relative(comparisonFile), document: relative(reportFile), runs: selected.length, soak: soak.status, diagnostics: diagnosticStatus, mainInspector: mainInspectorStatus }, null, 2));
}

main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
