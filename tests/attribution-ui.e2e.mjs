import assert from "node:assert/strict";
import { _electron } from "playwright";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const executablePath = process.env.DESKTOP_EXECUTABLE || path.join(root, "dist", "desktop", "win-unpacked", "ModelObservatory.exe");
assert.ok(existsSync(executablePath), "Build the desktop executable first");

const scratch = await mkdtemp(path.join(os.tmpdir(), "ModelObservatoryAttribution-"));
const home = path.join(scratch, "home");
const store = path.join(scratch, "ledger");
const userData = path.join(scratch, "profile");
await mkdir(home, { recursive: true });
await mkdir(store, { recursive: true });

const now = Date.now();
const shanghai = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(now));
const part = (type) => Number(shanghai.find((item) => item.type === type)?.value);
const todayAt = (secondsAgo) => new Date(now - secondsAgo * 1000).toISOString();
const yesterdayNoon = new Date(Date.UTC(part("year"), part("month") - 1, part("day") - 1, 4, 0, 0)).toISOString();
const todayDate = `${part("year")}-${String(part("month")).padStart(2, "0")}-${String(part("day")).padStart(2, "0")}`;
const yesterdayDate = new Date(Date.UTC(part("year"), part("month") - 1, part("day") - 1)).toISOString().slice(0, 10);

const projectKeys = {
	a: "opaque-project-a:fixture.alpha.9c1d",
	b: "opaque-project-b:fixture.beta.4a7e",
	only: "opaque-project-only:fixture.c",
};
const conflictProject = {
	status: "conflict",
	key: null,
	label: "项目归属冲突",
	source: "fixture-session-only",
	reason: "conflicting-values",
	candidates: [
		{ source: "fixture-session-only", client: "Fixture Session Only", id: "project-alpha-id", label: "project-alpha-id", key: "opaque-conflict-project-alpha" },
		{ source: "fixture-session-only", client: "Fixture Session Only", id: "project-beta-id", label: "project-beta-id", key: "opaque-conflict-project-beta", path: "E:\\Fixture\\Conflict Beta" },
	],
};
const sessionKeys = {
	cross: "opaque-session-cross:fixture.01",
	b: "opaque-session-b:fixture.02",
	only: "opaque-session-only:fixture.03",
	sourceOne: "opaque-session-source-one:shared.04",
	sourceTwo: "opaque-session-source-two:shared.04",
};
const sameSessionId = "session-shared-identifier-9f3d8a71-long-enough-to-remain-distinguishable";

function knownProject(key, label, projectPath, source = "Fixture", client = "Fixture") {
	return {
		status: "known",
		key,
		label,
		source,
		...(client ? { client } : {}),
		path: projectPath,
		candidates: [{ source, ...(client ? { client } : {}), label, key, path: projectPath }],
	};
}

function knownSession(key, id, source, client) {
	return {
		status: "known",
		key,
		label: id,
		source,
		client,
		id,
		candidates: [{ source, client, label: id, key, id }],
	};
}

const missingProject = { status: "missing", key: null, label: "未知", source: null, reason: "not-provided", candidates: [] };
const missingSession = { status: "missing", key: null, label: "未知", source: null, reason: "not-provided", candidates: [] };
const projectA = knownProject(projectKeys.a, "same-name", "C:\\Fixture\\Alpha\\same-name");
const projectB = knownProject(projectKeys.b, "same-name", "C:\\Fixture\\Beta\\same-name");
const projectOnly = knownProject(projectKeys.only, "project-without-session", "D:\\Fixture\\Lone Project");

let sequence = 0;
function event({ id, at, model, client, source, kind = "session", project, session, parentSession, legacy = false, input, output, cache = null }) {
	const row = {
		id,
		at,
		model,
		rawModel: model,
		client,
		upstream: "fixture",
		input,
		output,
		cache,
		status: "ok",
		identity: "reported",
		duration: null,
		requestId: id,
		evidence: [{ id, source, kind }],
	};
	if (!legacy) row.attribution = { project, session, ...(parentSession ? { parentSession } : {}) };
	return row;
}

const fixtureEvents = [
	event({ id: "a-yesterday", at: yesterdayNoon, model: "fixture-model-a", client: "Fixture Alpha", source: "fixture-alpha", project: projectA, session: knownSession(sessionKeys.cross, "session-cross-day-001", "fixture-alpha", "Fixture Alpha"), input: 100, output: 20 }),
	event({ id: "a-today", at: todayAt(8), model: "fixture-model-b", client: "Fixture Alpha", source: "fixture-alpha", project: projectA, session: knownSession(sessionKeys.cross, "session-cross-day-001", "fixture-alpha", "Fixture Alpha"), input: 30, output: 10 }),
	event({ id: "b-today", at: todayAt(7), model: "fixture-model-b", client: "Fixture Beta", source: "fixture-beta", project: projectB, session: knownSession(sessionKeys.b, "session-beta-002", "fixture-beta", "Fixture Beta"), input: 25, output: 5 }),
	event({ id: "session-only", at: todayAt(6), model: "fixture-model-c", client: "Fixture Session Only", source: "fixture-session-only", project: conflictProject, session: knownSession(sessionKeys.only, "session-with-missing-project-003", "fixture-session-only", "Fixture Session Only"), parentSession: missingSession, input: null, output: null }),
	event({ id: "project-only", at: todayAt(5), model: "fixture-model-d", client: "Fixture Project Only", source: "fixture-project-only", project: projectOnly, session: missingSession, input: 40, output: 8 }),
	event({ id: "unknown-both", at: todayAt(4), model: "fixture-model-e", client: "Fixture Unknown", source: "fixture-unknown", legacy: true, input: null, output: null }),
	event({ id: "same-session-one", at: todayAt(3), model: "fixture-model-g", client: "Fixture One", source: "fixture-source-one", project: missingProject, session: knownSession(sessionKeys.sourceOne, sameSessionId, "fixture-source-one", "Fixture One"), input: 10, output: 5 }),
	event({ id: "same-session-two", at: todayAt(2), model: "fixture-model-g", client: "Fixture Two", source: "fixture-source-two", project: missingProject, session: knownSession(sessionKeys.sourceTwo, sameSessionId, "fixture-source-two", "Fixture Two"), input: 11, output: 6 }),
	event({ id: "duplicate-native", at: todayAt(2), model: "fixture-model-h", client: "Fixture Beta", source: "fixture-native", project: projectB, session: knownSession(sessionKeys.b, "session-beta-002", "fixture-beta", "Fixture Beta"), input: 40, output: 8 }),
	event({ id: "duplicate-router", at: todayAt(2), model: "fixture-model-h", client: "Fixture Router", source: "fixture-router", kind: "router", project: projectB, session: knownSession(sessionKeys.b, "session-beta-002", "fixture-beta", "Fixture Beta"), input: 40, output: 8 }),
];

const database = new DatabaseSync(path.join(store, "history.sqlite"));
database.exec("PRAGMA journal_mode=WAL; CREATE TABLE observations (id TEXT PRIMARY KEY, event TEXT NOT NULL); CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);");
const insert = database.prepare("INSERT INTO observations VALUES (?, ?)");
for (const row of fixtureEvents) {
	insert.run(row.id, JSON.stringify(row));
	sequence++;
}
database.close();

const env = {
	...process.env,
	USERPROFILE: home,
	HOME: home,
	APPDATA: path.join(home, "AppData", "Roaming"),
	LOCALAPPDATA: path.join(home, "AppData", "Local"),
	OBSERVATORY_DESKTOP_USER_DATA: userData,
	OBSERVATORY_DATA_DIR: store,
};
delete env.ELECTRON_RUN_AS_NODE;

const app = await _electron.launch({ executablePath, cwd: scratch, env, timeout: 60000 });
const page = await app.firstWindow();
const errors = [];
const resourceErrors = [];
const evidence = [];
const record = (message) => { evidence.push(message); console.log(`PASS ${message}`); };
let BASE;

async function resize(width, height = 900) {
	await app.evaluate(({ BrowserWindow }, size) => {
		const window = BrowserWindow.getAllWindows()[0];
		window.setMinimumSize(300, 300);
		window.setContentSize(size.width, size.height);
	}, { width, height });
	await page.waitForFunction((target) => Math.abs(innerWidth - target) <= 1, width);
}

async function api(query) {
	return page.evaluate(async (target) => {
		const response = await fetch(target, { cache: "no-store" });
		if (!response.ok) throw new Error(`${response.status} ${response.url}`);
		return response.json();
	}, query);
}

async function waitForList(view) {
	const testId = view === "projects" ? "project-ledger" : "session-ledger";
	await page.getByTestId(testId).waitFor({ timeout: 120000 });
	await page.locator('main[aria-busy="false"]').waitFor({ timeout: 120000 });
}

async function navigationLink(name) {
	return page.getByRole("link", { name, exact: true }).first();
}

try {
	await page.waitForURL(/^http:\/\/127\.0\.0\.1:\d+\//, { timeout: 60000 });
	BASE = new URL(page.url()).origin;
	page.setDefaultTimeout(30000);
	page.on("pageerror", (error) => errors.push(error.message));
	page.on("response", (response) => {
		if (response.status() >= 400 && !new URL(response.url()).pathname.startsWith("/api/")) resourceErrors.push(`${response.status()} ${response.url()}`);
	});
	await page.emulateMedia({ reducedMotion: "reduce" });
	await resize(1440, 1000);

	// Independent oracle: 10 observations, one reconciled duplicate => 9 requests.
	// Known project totals: A=2, B=2, project-only=1, all known=5, unknown=4.
	// Known session totals: A=2, B=2, session-only=1, same-id sources=1+1 => 7; unknown sessions=2.
	// Complete usage: 7 of 9 (the two null-usage rows are intentionally incomplete).
	// Recorded input+output total after reconciliation: 120+40+30+48+15+17+48 = 318.
	const allProjects = await api("/api/observatory?range=all&view=projects&limit=0");
	assert.equal(allProjects.attribution.coverage.projects.knownRequests, 5);
	assert.equal(allProjects.attribution.coverage.projects.unknownRequests, 4);
	assert.equal(allProjects.attribution.coverage.projects.knownTokenRequests + allProjects.attribution.coverage.projects.unknownTokenRequests, 7);
	assert.equal(allProjects.attribution.projects.reduce((sum, project) => sum + project.totals.requests, 0), 5);
	assert.equal(allProjects.attribution.unknownProjects.reduce((sum, item) => sum + item.totals.requests, 0), 4);
	assert.equal(allProjects.attribution.projects.find((project) => project.key === projectKeys.a)?.totals.requests, 2);
	assert.equal(allProjects.attribution.projects.find((project) => project.key === projectKeys.b)?.totals.requests, 2);
	assert.equal(allProjects.reconciliation.merged, 1);
	assert.equal(allProjects.totals.requests, 9);
	assert.equal(allProjects.totals.input + allProjects.totals.output, 318);
	const todayProjects = await api("/api/observatory?range=today&view=projects&limit=0");
	assert.equal(todayProjects.attribution.coverage.projects.knownRequests, 4);
	assert.equal(todayProjects.attribution.coverage.projects.unknownRequests, 4);
	assert.equal(todayProjects.attribution.projects.find((project) => project.key === projectKeys.a)?.totals.requests, 1);
	assert.equal(todayProjects.attribution.projects.find((project) => project.key === projectKeys.b)?.totals.requests, 2);

	const allSessions = await api("/api/observatory?range=all&view=sessions&limit=0");
	assert.equal(allSessions.attribution.coverage.sessions.knownRequests, 7);
	assert.equal(allSessions.attribution.coverage.sessions.unknownRequests, 2);
	assert.equal(allSessions.attribution.sessions.length, 5);
	assert.equal(allSessions.attribution.unknownSessions.reduce((sum, item) => sum + item.totals.requests, 0), 2);
	assert.equal(allSessions.attribution.sessions.filter((session) => session.id === sameSessionId).length, 2);
	const todaySessions = await api("/api/observatory?range=today&view=sessions&limit=0");
	assert.equal(todaySessions.attribution.coverage.sessions.knownRequests, 6);
	assert.equal(todaySessions.attribution.coverage.sessions.unknownRequests, 2);

	const projectADetail = await api(`/api/observatory?range=all&view=project&project=${encodeURIComponent(projectKeys.a)}&limit=0`);
	assert.equal(projectADetail.selection.totals.requests, 2);
	assert.equal(projectADetail.selection.totals.input + projectADetail.selection.totals.output, 160);
	assert.deepEqual(projectADetail.selection.projects[0].models.map((model) => model.model).sort(), ["fixture-model-a", "fixture-model-b"]);
	const crossDetail = await api(`/api/observatory?range=all&view=session&session=${encodeURIComponent(sessionKeys.cross)}&limit=0`);
	assert.equal(crossDetail.selection.totals.requests, 2);
	assert.equal(crossDetail.selection.totals.input + crossDetail.selection.totals.output, 160);
	assert.deepEqual(crossDetail.selection.sessions[0].models.map((model) => model.model).sort(), ["fixture-model-a", "fixture-model-b"]);
	const crossToday = await api(`/api/observatory?range=today&view=session&session=${encodeURIComponent(sessionKeys.cross)}&limit=0`);
	assert.equal(crossToday.selection.totals.requests, 1);
	assert.equal(crossToday.selection.totals.input + crossToday.selection.totals.output, 40);
	assert.deepEqual(crossToday.selection.sessions[0].models.map((model) => model.model), ["fixture-model-b"]);
	assert.equal((await api("/api/observatory?range=today&view=unknown&unknown=project&limit=50")).requestCount, 4);
	assert.equal((await api("/api/observatory?range=today&view=unknown&unknown=session&limit=50")).requestCount, 2);
	record("API 归属计数、重复合并、跨日范围与未知筛选符合独立 oracle");

	await (await navigationLink("项目")).click();
	await page.getByRole("heading", { level: 1, name: "项目账本", exact: true }).waitFor();
	await waitForList("projects");
	const allRangeResponse = page.waitForResponse((response) => {
		const url = new URL(response.url());
		return url.pathname === "/api/observatory" && url.searchParams.get("range") === "all";
	});
	await page.getByRole("button", { name: "全部", exact: true }).click();
	const allRangeData = await (await allRangeResponse).json();
	await page.locator('main[aria-busy="false"]').waitFor();
	assert.equal(new URL(page.url()).searchParams.get("range"), "all");
	assert.equal(allRangeData.range, "all");
	assert.equal(allRangeData.attribution.projects.find((project) => project.key === projectKeys.a)?.totals.requests, 2);
	assert.equal(allRangeData.attribution.projects.find((project) => project.key === projectKeys.a)?.totals.input + allRangeData.attribution.projects.find((project) => project.key === projectKeys.a)?.totals.output, 160);
	const projectARow = page.getByTestId("project-ledger").locator("tbody tr").filter({ hasText: /C:\\Fixture\\Alpha\\same-name/ });
	assert.match(await projectARow.innerText(), /2[\s\S]*160/);
	await page.getByRole("button", { name: "任意时间", exact: true }).click();
	await page.getByLabel("开始日期", { exact: true }).fill(yesterdayDate);
	await page.getByLabel("结束日期", { exact: true }).fill(todayDate);
	const customRangeResponse = page.waitForResponse((response) => {
		const url = new URL(response.url());
		return url.pathname === "/api/observatory" && url.searchParams.get("range") === "custom" && url.searchParams.get("from") === yesterdayDate && url.searchParams.get("to") === todayDate;
	});
	await page.getByRole("button", { name: "应用", exact: true }).click();
	const customRangeData = await (await customRangeResponse).json();
	await page.locator('main[aria-busy="false"]').waitFor();
	assert.equal(customRangeData.range, "custom");
	assert.equal(customRangeData.attribution.projects.find((project) => project.key === projectKeys.a)?.totals.requests, 2);
	assert.equal(new URL(page.url()).searchParams.get("from"), yesterdayDate);
	const secondAllResponse = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/observatory" && new URL(response.url()).searchParams.get("range") === "all");
	await page.getByRole("button", { name: "全部", exact: true }).click();
	await secondAllResponse;
	await page.locator('main[aria-busy="false"]').waitFor();
	assert.equal(new URL(page.url()).searchParams.get("range"), "all");
	assert.equal(new URL(page.url()).searchParams.has("from"), false);
	assert.equal(await page.getByRole("button", { name: "打开项目 same-name", exact: true }).count(), 2);
	assert.match(await page.getByTestId("project-ledger").innerText(), /C:\\Fixture\\Alpha\\same-name/);
	assert.match(await page.getByTestId("project-ledger").innerText(), /C:\\Fixture\\Beta\\same-name/);
	assert.match(await page.getByTestId("project-ledger").innerText(), /涉及模型/);
	assert.equal(await page.locator(".obs-attribution-unknown-list a").count(), 0, "Unknown reason rows must not imply a per-reason filter");

	await page.getByTestId("project-ledger").getByRole("button", { name: /已记录 Token/ }).click();
	await page.waitForFunction(() => new URL(location.href).searchParams.get("sort") === "tokens");
	await page.locator('main[aria-busy="false"]').waitFor();
	assert.equal(await page.getByTestId("project-ledger").locator("tbody tr").first().getByRole("button", { name: /打开项目/ }).getAttribute("aria-label"), "打开项目 same-name");
	await page.reload({ waitUntil: "domcontentloaded" });
	await waitForList("projects");
	assert.equal(new URL(page.url()).searchParams.get("sort"), "tokens");

	const firstProject = page.getByTestId("project-ledger").locator("tbody tr").first().getByRole("button", { name: /打开项目/ });
	await firstProject.click();
	await page.getByTestId("attribution-detail-requests").waitFor();
	assert.equal(await page.getByTestId("attribution-detail-requests").innerText(), "2次");
	assert.equal(await page.getByTestId("attribution-detail-tokens").innerText(), "160");
	assert.equal(new URL(page.url()).searchParams.get("project"), projectKeys.a);
	assert.match(await page.locator(".obs-attribution-section").first().innerText(), /fixture-model-a/);
	assert.match(await page.locator(".obs-attribution-section").first().innerText(), /fixture-model-b/);
	assert.match(await page.locator(".obs-attribution-model-note").innerText(), /未经响应模型验证/);
	assert.match(await page.locator(".obs-attribution-scope").innerText(), /当前时间范围 \+ 当前项目/);
	const projectRequestHref = new URL(await page.getByRole("link", { name: /查看此项目请求/ }).getAttribute("href"), BASE);
	assert.equal(projectRequestHref.searchParams.get("project"), projectKeys.a);
	const modelRequestHref = new URL(await page.getByRole("link", { name: /查看 fixture-model-a 在当前归属中的请求/ }).getAttribute("href"), BASE);
	assert.equal(modelRequestHref.searchParams.get("project"), projectKeys.a);
	assert.equal(modelRequestHref.searchParams.get("model"), "fixture-model-a");
	const scopedSessionHref = new URL(await page.locator(".obs-attribution-links a").first().getAttribute("href"), BASE);
	assert.equal(scopedSessionHref.searchParams.get("project"), projectKeys.a);
	assert.equal(scopedSessionHref.searchParams.get("session"), sessionKeys.cross);
	await page.goBack();
	await waitForList("projects");
	assert.equal(new URL(page.url()).searchParams.has("project"), false, "Browser back must close the pushed detail state");
	await page.evaluate(() => {
		const url = new URL(location.href);
		url.searchParams.set("project", "opaque-project-that-does-not-exist");
		history.pushState(null, "", url);
		dispatchEvent(new PopStateEvent("popstate"));
	});
	await page.getByRole("heading", { name: "当前范围无匹配请求", exact: true }).waitFor();
	assert.equal(await page.getByRole("button", { name: "返回项目列表", exact: true }).count(), 1);
	await page.getByRole("button", { name: "返回项目列表", exact: true }).click();
	await waitForList("projects");
	record("项目列表路径可区分、模型数、Token 排序、详情模型与组合请求链接");

	await (await navigationLink("会话")).click();
	await page.getByRole("heading", { level: 1, name: "会话账本", exact: true }).waitFor();
	await waitForList("sessions");
	assert.equal(await page.getByRole("button", { name: `打开会话 ${sameSessionId}`, exact: true }).count(), 2);
	assert.match(await page.getByTestId("session-ledger").innerText(), /Fixture One/);
	assert.match(await page.getByTestId("session-ledger").innerText(), /Fixture Two/);
	assert.match(await page.getByTestId("session-ledger").innerText(), /涉及模型/);
	assert.match(await page.getByTestId("session-ledger").innerText(), /C:\\Fixture\\Alpha\\same-name/);
	assert.match(await page.getByTestId("session-ledger").innerText(), /C:\\Fixture\\Beta\\same-name/);

	await page.getByRole("button", { name: "打开会话 session-cross-day-001", exact: true }).click();
	await page.getByTestId("attribution-detail-requests").waitFor();
	assert.equal(await page.getByTestId("attribution-detail-requests").innerText(), "2次");
	assert.match(await page.locator(".obs-attribution-scope").innerText(), /跨出范围/);
	assert.match(await page.getByText("session-cross-day-001", { exact: true }).last().innerText(), /session-cross-day-001/);
	const sessionRequestHref = new URL(await page.getByRole("link", { name: /查看此会话请求/ }).getAttribute("href"), BASE);
	assert.equal(sessionRequestHref.searchParams.get("session"), sessionKeys.cross);
	assert.equal(new URL(await page.getByRole("link", { name: /查看 fixture-model-a 在当前归属中的请求/ }).getAttribute("href"), BASE).searchParams.get("session"), sessionKeys.cross);
	const scopedProjectHref = new URL(await page.getByRole("link", { name: "查看项目（含当前会话）", exact: true }).getAttribute("href"), BASE);
	assert.equal(scopedProjectHref.searchParams.get("project"), projectKeys.a);
	assert.equal(scopedProjectHref.searchParams.get("session"), sessionKeys.cross);

	const todayResponse = page.waitForResponse((response) => {
		const url = new URL(response.url());
		return url.pathname === "/api/observatory" && url.searchParams.get("range") === "today" && url.searchParams.get("view") === "session" && url.searchParams.get("session") === sessionKeys.cross;
	});
	await page.getByRole("button", { name: "今天", exact: true }).click();
	await todayResponse;
	await page.waitForFunction(() => document.querySelector('[data-testid="attribution-detail-requests"]')?.textContent === "1次");
	assert.equal(new URL(page.url()).searchParams.get("range"), "today");
	const sessionModels = page.locator(".obs-attribution-model-table");
	await sessionModels.waitFor();
	assert.match(await sessionModels.innerText(), /fixture-model-b/);
	assert.doesNotMatch(await sessionModels.innerText(), /fixture-model-a/);
	await page.reload({ waitUntil: "domcontentloaded" });
	await page.getByTestId("attribution-detail-requests").waitFor();
	assert.equal(await page.getByTestId("attribution-detail-requests").innerText(), "1次");
	assert.equal(new URL(page.url()).searchParams.get("session"), sessionKeys.cross);
	record("会话标识完整、同 ID 不同来源不合并、跨日详情与刷新范围保留");

	await page.getByRole("button", { name: "返回会话列表" }).click();
	await waitForList("sessions");
	assert.equal(new URL(page.url()).searchParams.get("range"), "today");
	assert.equal(new URL(page.url()).searchParams.has("session"), false);
	const unknownSessions = page.getByRole("link", { name: "查看全部未知会话请求" });
	await unknownSessions.click();
	await page.locator('main[aria-busy="false"]').waitFor();
	await page.getByRole("group", { name: "归属筛选" }).waitFor();
	assert.match(await page.getByRole("group", { name: "归属筛选" }).innerText(), /未知会话/);
	await page.waitForFunction(() => document.querySelector(".obs-pagination")?.textContent?.includes("/ 2 条"));
	assert.equal(await page.locator(".obs-request-table tbody tr").count(), 2);
	await page.getByRole("button", { name: "查看请求 unknown-both 的证据", exact: true }).click();
	await page.getByText("会话归属", { exact: true }).waitFor();
	assert.match(await page.locator(".obs-request-evidence").innerText(), /历史记录未包含归属元数据/);
	assert.equal(await page.locator(".obs-request-parent").count(), 0, "Missing parent sessions must not be presented as a relationship");
	await page.goBack();
	await waitForList("sessions");
	assert.equal(new URL(page.url()).searchParams.get("range"), "today");

	await page.getByRole("button", { name: "打开会话 session-with-missing-project-003", exact: true }).click();
	await page.getByTestId("attribution-detail-requests").waitFor();
	assert.equal(await page.getByTestId("attribution-detail-tokens").innerText(), "未记录");
	assert.equal(await page.getByTestId("attribution-detail-coverage").innerText(), "0/1 条完整用量");
	assert.match(await page.locator(".obs-attribution-facts").innerText(), /session-with-missing-project-003/);
	assert.equal(await page.getByText("父会话", { exact: true }).count(), 0, "Missing parent sessions must stay hidden in session detail");
	record("未知会话入口进入请求流水、返回保留范围、缺失 usage 覆盖明确");

	await page.getByRole("button", { name: "返回会话列表" }).click();
	await waitForList("sessions");
	await (await navigationLink("项目")).click();
	await waitForList("projects");
	await page.getByRole("link", { name: "查看全部未知项目请求" }).click();
	await page.locator('main[aria-busy="false"]').waitFor();
	await page.waitForFunction(() => document.querySelector(".obs-pagination")?.textContent?.includes("/ 4 条"));
	assert.match(await page.getByRole("group", { name: "归属筛选" }).innerText(), /未知项目/);
	assert.equal(await page.locator(".obs-request-table tbody tr").count(), 4);
	await page.getByRole("button", { name: "查看请求 unknown-both 的证据", exact: true }).click();
	await page.getByText("项目归属", { exact: true }).waitFor();
	assert.match(await page.locator(".obs-request-evidence").innerText(), /历史记录未包含归属元数据/);
	assert.equal(await page.locator(".obs-request-parent").count(), 0);

	await page.goto(`${BASE}/requests?range=today&model=fixture-model-c`, { waitUntil: "domcontentloaded" });
	await page.locator(".obs-request-table tbody tr").waitFor({ timeout: 120000 });
	assert.equal(await page.locator(".obs-request-table tbody tr").count(), 1);
	await page.getByRole("button", { name: "查看请求 session-only 的证据", exact: true }).click();
	await page.getByText("项目归属", { exact: true }).waitFor();
	const conflictEvidence = await page.locator(".obs-request-evidence").innerText();
	assert.match(conflictEvidence, /存在冲突的归属证据/);
	assert.match(conflictEvidence, /project-alpha-id/);
	assert.match(conflictEvidence, /E:\\Fixture\\Conflict Beta/);

	for (const width of [390, 320]) {
		await resize(width, 844);
		for (const [name, testId] of [["项目", "project-ledger"], ["会话", "session-ledger"]]) {
			await (await navigationLink(name)).click();
			await waitForList(name === "项目" ? "projects" : "sessions");
			assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${name} page overflows at ${width}px`);
			assert.ok(await page.getByTestId(testId).isVisible());
		}
		const navBounds = await page.getByRole("navigation", { name: "主导航" }).boundingBox();
		assert.ok(navBounds && navBounds.x >= 0 && navBounds.x + navBounds.width <= width + 1, `Navigation overflows at ${width}px`);
	}
	assert.deepEqual(errors, []);
	assert.deepEqual(resourceErrors, []);
	record("390px / 320px 导航与页面无水平溢出");
	await mkdir(path.join(root, "logs"), { recursive: true });
	await writeFile(path.join(root, "logs", "attribution-ui.e2e.json"), JSON.stringify({ passed: evidence, errors, resourceErrors, expected: { observations: sequence, reconciledRequests: 9, knownProjects: 3, knownProjectRequests: 5, unknownProjectRequests: 4, knownSessions: 5, knownSessionRequests: 7, unknownSessionRequests: 2, recordedInputOutput: 318, completeUsage: 7 }, testedAt: new Date().toISOString() }, null, 2));
} catch (error) {
	await mkdir(path.join(root, "logs"), { recursive: true });
	await page.screenshot({ path: path.join(root, "logs", "attribution-ui-failure.png") }).catch(() => {});
	await writeFile(path.join(root, "logs", "attribution-ui-failure.json"), JSON.stringify({ error: error.stack ?? error.message, errors, resourceErrors, evidence, url: page.url() }, null, 2));
	throw error;
} finally {
	await app.close().catch(() => {});
	assert.equal(path.dirname(path.resolve(scratch)), path.resolve(os.tmpdir()));
	assert.ok(path.basename(scratch).startsWith("ModelObservatoryAttribution-"));
	await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}
