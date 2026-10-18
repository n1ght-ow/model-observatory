import assert from "node:assert/strict";
import { _electron } from "playwright";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { DatabaseSync, backup } from "node:sqlite";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const executablePath = process.env.DESKTOP_EXECUTABLE || path.join(root, "dist", "desktop", "win-unpacked", "ModelObservatory.exe");
assert.ok(existsSync(executablePath), "Build the desktop executable first");
const scratch = await mkdtemp(path.join(os.tmpdir(), "ModelObservatoryUI-"));
const store = path.join(scratch, "ledger");
await mkdir(store);
// Copy the ledger consistently, including committed WAL data, without changing it.
const history = path.join(os.homedir(), ".model-observatory");
const database = new DatabaseSync(path.join(history, "history.sqlite"), { readOnly: true });
try { await backup(database, path.join(store, "history.sqlite")); } finally { database.close(); }
if (existsSync(path.join(history, "aliases.json"))) await copyFile(path.join(history, "aliases.json"), path.join(store, "aliases.json"));
const results = [];
const errors = [];
const resourceErrors = [];
const pendingRequests = new Map();
const record = (name) => { results.push(name); console.log(`PASS ${name}`); };
const env = { ...process.env, OBSERVATORY_DESKTOP_USER_DATA: path.join(scratch, "profile"), OBSERVATORY_DATA_DIR: store };
delete env.ELECTRON_RUN_AS_NODE;
const app = await _electron.launch({ executablePath, cwd: scratch, env, timeout: 60000 });
const page = await app.firstWindow();
await page.waitForURL(/^http:\/\/127\.0\.0\.1:\d+\//, { timeout: 60000 });
const BASE = new URL(page.url()).origin;
await page.emulateMedia({ reducedMotion: "reduce" });
async function resize({ width, height }) {
	await app.evaluate(({ BrowserWindow }, size) => {
		const window = BrowserWindow.getAllWindows()[0];
		window.setMinimumSize(300, 300);
		window.setContentSize(size.width, size.height);
	}, { width, height });
	await page.waitForFunction((target) => Math.abs(innerWidth - target) <= 1, width);
}
await resize({ width: 1440, height: 1000 });
page.setDefaultTimeout(30000);
page.on("pageerror", (e) => errors.push(e.message));
page.on("request", (request) => pendingRequests.set(request, request.url()));
page.on("requestfinished", (request) => pendingRequests.delete(request));
page.on("requestfailed", (request) => pendingRequests.delete(request));
page.on("response", (response) => { if (response.status() >= 400 && !new URL(response.url()).pathname.startsWith("/api/")) resourceErrors.push(`${response.status()} ${response.url()}`); });
// The app keeps polling. Assert hydrated data and controls rather than waiting
// for unrelated prefetch/collector traffic to become completely idle.
const waitData = async () => {
	await page.locator(".obs-ledger-heading").waitFor({ timeout: 120000 });
	await page.locator('main[aria-busy="false"]').waitFor({ timeout: 120000 });
};
async function verifyMonochrome() {
	const colored = await page.locator(".observatory, .observatory *").evaluateAll((elements) => {
		const fields = ["color", "backgroundColor", "borderTopColor", "outlineColor", "fill", "stroke", "caretColor"];
		return elements.flatMap((el) => {
			const style = getComputedStyle(el);
			return fields.flatMap((field) => {
				const value = style[field];
				const rgb = /^rgba?\((\d+)[, ]+(\d+)[, ]+(\d+)/.exec(value);
				return rgb && (rgb[1] !== rgb[2] || rgb[2] !== rgb[3]) ? [`${el.className.baseVal ?? el.className}: ${field}=${value}`] : [];
			});
		});
	});
	assert.deepEqual(colored, [], "all rendered surfaces, text, charts and status colors must be grayscale");
}
async function range(label) {
	const ids = { "今天": "today", "这周": "week", "这月": "month", "全部": "all" };
	const response = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/observatory" && new URL(r.url()).searchParams.get("range") === ids[label] && r.status() === 200);
	await page.getByRole("button", { name: label, exact: true }).click();
	const data = await (await response).json();
	await page.locator('main[aria-busy="false"]').waitFor();
	assert.equal(await page.getByRole("button", { name: label, exact: true }).getAttribute("aria-pressed"), "true");
	assert.equal(data.range, ids[label]);
	assert.equal(new URL(page.url()).searchParams.get("range"), ids[label]);
	if (await page.getByTestId("request-total").count()) assert.equal(await page.getByTestId("request-total").innerText(), `${new Intl.NumberFormat("zh-CN").format(data.totals.requests)}次`);
	return data;
}

try {
	const response = await fetch(`${BASE}/api/observatory?range=all`);
	assert.equal(response.status, 200);
	const all = await response.json();
	assert.equal(all.models.reduce((n, m) => n + m.requests, 0), all.totals.requests);
	assert.equal(all.models.reduce((n, m) => n + m.turnRequests, 0), all.totals.turnRequests);
	assert.ok(all.coverage.some((s) => s.id === "cursor"));
	assert.equal(all.models.reduce((n, m) => n + m.input + m.output, 0), all.totals.input + all.totals.output);
	assert.ok(all.coverage.some((s) => s.id === "chatgpt" && s.state === "unsupported"));
	assert.ok(!all.coverage.some((s) => s.id.includes("cc-switch")));
	assert.ok(all.requests.every((r) => r.evidence.every((e) => !e.source.includes("cc-switch"))));
	assert.ok(all.models.some((m) => m.clients.length > 1));
	assert.equal((await fetch(`${BASE}/api/observatory?range=invalid`)).status, 400);
	for (const path of ["metrics", "sources", "command-code"]) assert.equal((await fetch(`${BASE}/api/${path}`)).status, 404);
	assert.equal((await fetch(`${BASE}/api/observatory/events`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: "invalid" }) })).status, 400);
	assert.equal((await fetch(`${BASE}/api/observatory/events`, { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://untrusted.example" }, body: "{}" })).status, 403);
	record("真实数据守恒、跨工具合计、覆盖边界与事件校验");

	await page.goto(BASE, { waitUntil: "domcontentloaded" });
	await waitData();
	assert.equal(await page.locator("h1").innerText(), "模型总览");
	assert.ok(await page.locator("html").evaluate((el) => el.classList.contains("dark")), "A fresh desktop profile must open in dark mode");
	await page.getByRole("button", { name: "切换浅色", exact: true }).click();
	await page.reload({ waitUntil: "domcontentloaded" });
	await waitData();
	assert.equal(await page.locator("html").evaluate((el) => el.classList.contains("dark")), false, "An explicit light preference must survive reload");
	await page.getByRole("button", { name: "切换深色", exact: true }).click();
	await page.reload({ waitUntil: "domcontentloaded" });
	await waitData();
	assert.ok(await page.locator("html").evaluate((el) => el.classList.contains("dark")), "An explicit dark preference must survive reload");
	await page.getByRole("button", { name: "切换浅色", exact: true }).click();
	assert.equal(await page.locator("[data-tray-control]").count(), 0);
	assert.equal(await page.locator(".obs-stat-strip").count(), 1);
	assert.equal(await page.locator(".obs-request-table").count(), 0);
	assert.equal(await page.getByRole("link", { name: /导出/ }).count(), 0);
	assert.equal(await page.getByRole("heading", { name: "最近请求" }).count(), 0);
	const modelBounds = await page.locator(".obs-model-table").boundingBox();
	const chartBounds = await page.locator(".obs-activity-section").boundingBox();
	assert.ok(modelBounds.y < chartBounds.y, "The model ledger must precede the activity chart");
	for (const label of ["这周", "这月", "今天"]) {
		const data = await range(label);
		assert.ok(data.since && data.requests.every((row) => row.timeKnown !== false && row.at >= data.since));
	}
	await range("全部");
	assert.deepEqual(await page.locator(".obs-range-group button").allTextContents(), ["今天", "这周", "这月", "全部", "任意时间"]);
	const beforeDates = await page.locator(".obs-stat-strip").boundingBox();
	await page.getByRole("button", { name: "任意时间", exact: true }).click();
	const afterDates = await page.locator(".obs-stat-strip").boundingBox();
	assert.ok(Math.abs(beforeDates.y - afterDates.y) < 1, "Opening the date popover must not shift the page");
	assert.equal(await page.locator('.obs-date-editor input[type="date"]').count(), 0, "Use the themed range calendar, without the native date popup");
	await page.getByLabel("开始日期", { exact: true }).fill("2026-10-14");
	await page.getByLabel("结束日期", { exact: true }).fill("2026-10-12");
	assert.equal(await page.getByRole("button", { name: "应用", exact: true }).isDisabled(), true);
	await page.getByRole("alert").filter({ hasText: "开始日期不能晚于结束日期" }).waitFor();
	await page.getByRole("button", { name: "取消", exact: true }).click();
	assert.equal(new URL(page.url()).searchParams.get("range"), "all");
	await page.getByRole("button", { name: "任意时间", exact: true }).click();
	await page.getByRole("button", { name: "任意时间", exact: true }).click();
	assert.equal(await page.locator(".obs-date-editor").count(), 0);
	await page.getByRole("button", { name: "任意时间", exact: true }).click();
	await page.getByRole("heading", { name: "模型总览", exact: true }).click();
	assert.equal(await page.locator(".obs-date-editor").count(), 0, "Clicking outside dismisses without applying");
	await page.getByRole("button", { name: "任意时间", exact: true }).click();
	await page.getByLabel("年份", { exact: true }).fill("2026");
	await page.getByLabel("月份", { exact: true }).selectOption("9");
	await page.getByRole("button", { name: "2026年9月30日", exact: true }).click();
	await page.getByRole("button", { name: "下个月", exact: true }).click();
	await page.getByRole("button", { name: "2026年10月2日", exact: true }).click();
	assert.equal(await page.getByLabel("开始日期", { exact: true }).inputValue(), "2026-09-30");
	assert.equal(await page.getByLabel("结束日期", { exact: true }).inputValue(), "2026-10-02");
	await page.getByRole("button", { name: "2026年10月12日", exact: true }).click();
	await page.getByRole("button", { name: "2026年10月14日", exact: true }).click();
	assert.equal(await page.locator(".obs-calendar-days .is-in-range").count(), 3);
	await page.getByRole("button", { name: "2026年10月14日", exact: true }).press("ArrowRight");
	await page.waitForFunction(() => document.activeElement?.getAttribute("data-date") === "2026-10-15");
	assert.equal(await page.locator(":focus").getAttribute("data-date"), "2026-10-15");
	await page.getByLabel("开始日期", { exact: true }).fill("2026-10-12");
	await page.getByLabel("结束日期", { exact: true }).fill("2026-10-14");
	const customResponse = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/observatory" && new URL(r.url()).searchParams.get("range") === "custom" && r.status() === 200);
	await page.getByRole("button", { name: "应用", exact: true }).click();
	const custom = await (await customResponse).json();
	await waitData();
	assert.equal(custom.since, "2026-10-11T16:00:00.000Z");
	assert.equal(custom.until, "2026-10-14T16:00:00.000Z");
	assert.equal(new URL(page.url()).searchParams.get("to"), "2026-10-14");
	await page.reload({ waitUntil: "domcontentloaded" }); await waitData();
	assert.equal(await page.getByRole("button", { name: "任意时间", exact: true }).getAttribute("aria-pressed"), "true");
	await page.locator(".obs-model-name").first().click();
	const drill = new URL(await page.getByRole("link", { name: /查看这个模型的请求/ }).getAttribute("href"), BASE);
	assert.equal(drill.searchParams.get("from"), "2026-10-12");
	await page.getByRole("link", { name: "请求流水", exact: true }).click(); await waitData();
	const exportUrl = new URL(await page.getByRole("link", { name: "导出筛选结果" }).getAttribute("href"), BASE);
	assert.equal(exportUrl.searchParams.get("range"), "custom");
	assert.equal(exportUrl.searchParams.get("to"), "2026-10-14");
	exportUrl.searchParams.delete("format");
	const customRows = await (await fetch(`${BASE}/api/observatory?${exportUrl.searchParams}`)).json();
	assert.equal(customRows.requestCount, custom.requestCount);
	assert.ok(customRows.requests.every((r) => r.at >= custom.since && r.at < custom.until && r.timeKnown !== false));
	await page.getByRole("link", { name: "接入与口径", exact: true }).click();
	await page.getByRole("heading", { name: "采集覆盖" }).waitFor();
	await page.getByRole("link", { name: "模型总览", exact: true }).click(); await waitData();
	assert.equal(new URL(page.url()).searchParams.get("from"), "2026-10-12");
	for (const query of ["range=custom", "range=custom&from=2026-02-30&to=2026-03-01", "range=custom&from=2026-10-15&to=2026-10-14"]) assert.equal((await fetch(`${BASE}/api/observatory?${query}`)).status, 400);
	record("任意日期校验、应用与取消、刷新、跨页、模型钻取和导出条件保留");
	await range("全部");
	await page.reload({ waitUntil: "domcontentloaded" });
	await waitData();
	assert.equal(await page.getByRole("button", { name: "全部", exact: true }).getAttribute("aria-pressed"), "true");
	record("总览独占汇总、账本前移、五种时间范围和刷新后保留");
	if (all.totals.turnRequests > 0) await page.getByText(/轮会话请求，非底层调用总数/).waitFor();
	await page.getByRole("button", { name: "暂停实时刷新" }).click();
	await page.waitForFunction(() => !document.querySelector(".obs-refresh-controls")?.textContent?.includes("更新中"));
	const unknownUsage = all.models.find((m) => m.inputRequests === 0 && m.outputRequests === 0);
	assert.ok(unknownUsage, "real history must contain a missing-usage model for this regression check");
	await page.getByRole("textbox", { name: "搜索模型或工具" }).fill(unknownUsage.model);
	assert.match(await page.locator(".obs-model-table tbody").innerText(), /未记录.*用量尚未报告/s);
	await mkdir("logs/desktop-ui-acceptance", { recursive: true });
	await page.screenshot({ path: "logs/desktop-ui-acceptance/unknown-usage.png" });
	const partialUsage = all.models.find((m) => m.tokenRequests > 0 && m.tokenRequests < m.requests);
	assert.ok(partialUsage, "real history must contain a partially covered model");
	await page.getByRole("textbox", { name: "搜索模型或工具" }).fill(partialUsage.model);
	assert.ok((await page.locator(".obs-model-table tbody").innerText()).includes(`${new Intl.NumberFormat("zh-CN").format(partialUsage.tokenRequests)}/${new Intl.NumberFormat("zh-CN").format(partialUsage.requests)} 条完整用量`));
	record("未知用量显示未记录、部分覆盖显示已记录用量与覆盖数");
	const cross = all.models.find((m) => m.clients.length > 1);
	await page.getByRole("textbox", { name: "搜索模型或工具" }).fill(cross.model);
	assert.ok(await page.locator(".obs-model-table tbody tr").count() >= 1);
	await page.getByRole("button", { name: `展开 ${cross.model}`, exact: true }).click();
	assert.ok(await page.getByRole("heading", { name: "这个模型从哪里来" }).isVisible());
	assert.equal(await page.locator(".obs-client-splits > div").count(), cross.clients.length);
	await page.getByRole("link", { name: "查看这个模型的请求" }).click();
	await waitData();
	assert.equal(await page.getByRole("combobox", { name: "按模型筛选" }).inputValue(), cross.model);
	assert.equal(await page.getByRole("button", { name: "全部", exact: true }).getAttribute("aria-pressed"), "true");
	assert.ok((await page.locator(".obs-request-model").allTextContents()).every((m) => m === cross.model));
	assert.equal(await page.locator(".obs-stat-strip").count(), 0);
	assert.equal(await page.getByTestId("request-total").count(), 0);
	assert.equal(await page.locator(".obs-activity-section").count(), 0);
	assert.equal(await page.getByRole("button", { name: "恢复实时刷新" }).count(), 1, "Refresh preference must survive navigation");
	await range("这周");
	await range("全部");
	record("流水不重复汇总、模型钻取保留范围、暂停状态与流水时间筛选");

	const clearedResponse = page.waitForResponse((r) => r.url().includes("/api/observatory?") && !new URL(r.url()).searchParams.get("model") && r.status() === 200);
	await page.getByRole("button", { name: "清除筛选", exact: true }).click();
	await clearedResponse;
	await page.waitForFunction(() => !document.querySelector(".obs-refresh-controls")?.textContent?.includes("更新中"));
	const firstId = await page.locator(".obs-request-table tbody tr").first().getByRole("button").getAttribute("aria-label");
	await page.getByRole("button", { name: "下一页" }).click();
	await page.waitForFunction((first) => document.querySelector(".obs-request-table tbody tr button")?.getAttribute("aria-label") !== first, firstId);
	await page.locator(".obs-request-table tbody tr").first().getByRole("button").click();
	assert.ok(await page.locator(".obs-request-evidence").isVisible());
	const href = await page.getByRole("link", { name: "导出筛选结果" }).getAttribute("href");
	const csv = await fetch(BASE + href);
	assert.match(csv.headers.get("content-type"), /text\/csv/);
	assert.ok((await csv.text()).includes("原始模型"));
	record("分页、逐请求证据与完整 CSV 导出");

	await page.getByRole("link", { name: /接入与口径/ }).first().click();
	await page.getByRole("heading", { name: "采集覆盖" }).waitFor();
	assert.equal(await page.locator(".obs-range-group").count(), 0);
	assert.equal(await page.getByRole("link", { name: /导出/ }).count(), 0);
	assert.equal(await page.locator(".obs-stat-strip").count(), 0);
	await page.getByText("当前接入状态 · 历史累计记录", { exact: true }).waitFor();
	assert.match(await page.locator(".obs-coverage-list article").first().innerText(), /读取异常|待接入|暂无记录/);
	await page.getByRole("button", { name: "立即刷新" }).click();
	await page.locator('main[aria-busy="false"]').waitFor();
	const cursorSource = page.locator(".obs-coverage-list article").filter({ has: page.getByRole("heading", { name: /^Cursor/ }) });
	assert.equal(await cursorSource.count(), 1);
	assert.match(await cursorSource.innerText(), /按 requestId 去重/);
	const cursorData = await (await fetch(`${BASE}/api/observatory?range=all&client=Cursor`)).json();
	if (cursorData.requestCount > 0) {
		assert.ok(cursorData.requests.every((r) => r.scope === "turn" && r.identity === "configured" && r.input === null && r.output === null && r.cache === null));
		assert.equal(new Set(cursorData.requests.map((r) => r.requestId)).size, cursorData.requests.length);
		const csv = await (await fetch(`${BASE}/api/observatory?range=all&client=Cursor&format=csv`)).text();
		assert.ok(csv.includes("计数单位") && csv.includes("会话请求轮次"));
		await page.goto(`${BASE}/requests?range=all&client=Cursor`, { waitUntil: "domcontentloaded" });
		await page.getByRole("button", { name: /查看请求 .* 的证据/ }).first().click();
		await page.getByText("一次会话请求，非逐步模型调用", { exact: false }).waitFor();
		await page.getByText("Token 未报告", { exact: false }).waitFor();
		await page.screenshot({ path: "logs/desktop-ui-acceptance/cursor-requests.png" });
		await page.goto(`${BASE}/tools`, { waitUntil: "domcontentloaded" });
		await page.getByRole("heading", { name: "采集覆盖" }).waitFor();
	}
	record("Cursor 来源、轮次口径、未知 Token、证据展开与 CSV 单位");
	assert.ok(await page.getByRole("heading", { name: /ChatGPT 桌面端 \/ 网页/ }).isVisible());
	assert.ok(await page.getByRole("heading", { name: "模型命名规则" }).isVisible());
	// UI mutation is mocked: acceptance tests never add aliases to real history.
	await page.route("**/api/observatory/aliases", (route) => route.fulfill({ status: 200, contentType: "application/json", body: '{"saved":true}' }));
	await page.getByLabel("日志中的名称").fill("fixture-alias");
	await page.getByLabel("统一模型名").fill("fixture-model");
	await page.getByRole("button", { name: "保存规则" }).click();
	await page.getByRole("status").filter({ hasText: "规则已保存" }).waitFor();
	await page.unroute("**/api/observatory/aliases");
	record("采集覆盖、ChatGPT 未覆盖提示、命名规则交互");

	await page.getByRole("link", { name: "模型总览", exact: true }).click();
	await waitData();
	assert.equal(await page.getByRole("button", { name: "全部", exact: true }).getAttribute("aria-pressed"), "true");
	await page.getByRole("button", { name: "恢复实时刷新" }).waitFor();
	record("接入页无无效时间或导出、历史口径明确、跨页范围保持");
	await page.waitForFunction(() => !document.querySelector(".obs-refresh-controls")?.textContent?.includes("更新中"));
	const pausedAt = await page.locator(".obs-refresh-controls > span").innerText();
	await page.waitForTimeout(5500);
	assert.equal(await page.locator(".obs-refresh-controls > span").innerText(), pausedAt);
	await page.getByRole("button", { name: "恢复实时刷新" }).click();
	await page.waitForFunction((at) => document.querySelector(".obs-refresh-controls > span")?.textContent !== at, pausedAt);
	record("暂停与恢复真实刷新");

	await page.route("**/api/observatory?*", (route) => route.fulfill({ status: 503, contentType: "application/json", body: "{}" }));
	await page.getByRole("button", { name: "立即刷新" }).click();
	await page.locator(".obs-error-banner").waitFor();
	assert.ok(await page.getByTestId("request-total").isVisible());
	await page.unroute("**/api/observatory?*");
	await page.getByRole("button", { name: "重试", exact: true }).click();
	await page.locator(".obs-error-banner").waitFor({ state: "hidden" });
	record("刷新失败保留读数，重试恢复");

	const priorCollection = await (await fetch(`${BASE}/api/observatory/collection`)).json();
	assert.equal((await fetch(`${BASE}/api/observatory/collection`, { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://example.com" }, body: JSON.stringify({ paused: true }) })).status, 403);
	try {
		assert.equal((await fetch(`${BASE}/api/observatory/collection`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ paused: true }) })).status, 200);
		await page.getByRole("button", { name: "立即刷新" }).click();
		await page.getByRole("button", { name: "恢复采集", exact: true }).waitFor();
		assert.equal(await page.locator(".obs-live-status").innerText(), "采集已暂停");
		await page.evaluate(() => scrollTo(0, 0));
		await page.screenshot({ path: "logs/desktop-ui-acceptance/collection-paused.png" });
		await resize({ width: 320, height: 844 });
		await page.screenshot({ path: "logs/desktop-ui-acceptance/collection-paused-narrow.png" });
		assert.ok(await page.getByRole("button", { name: "恢复采集", exact: true }).isVisible());
		assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
		await page.route("**/api/observatory/collection", (route) => route.fulfill({ status: 503, contentType: "application/json", body: "{}" }));
		await page.getByRole("button", { name: "恢复采集", exact: true }).click();
		await page.getByRole("alert").filter({ hasText: "恢复采集失败" }).waitFor();
		assert.ok(await page.getByTestId("request-total").isVisible());
		await page.unroute("**/api/observatory/collection");
		const resumed = page.waitForResponse((response) => response.url().endsWith("/api/observatory/collection") && response.request().method() === "POST" && response.status() === 200);
		await page.getByRole("button", { name: "恢复采集", exact: true }).click();
		const resumedResponse = await resumed;
		assert.equal((await resumedResponse.json()).paused, false);
		await page.getByRole("status").filter({ hasText: "采集已暂停，历史已保留" }).waitFor({ state: "hidden" });
		assert.equal((await (await fetch(`${BASE}/api/observatory/collection`)).json()).paused, false);
	} finally {
		await page.unroute("**/api/observatory/collection");
		await fetch(`${BASE}/api/observatory/collection`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ paused: priorCollection.paused }) });
		await resize({ width: 1440, height: 1000 });
	}
	record("全局采集暂停提示、320px 恢复入口、恢复失败保留历史与重试");

	await mkdir("logs/desktop-ui-acceptance", { recursive: true });
	await range("这周");
	await verifyMonochrome();
	await page.evaluate(() => scrollTo(0, 0));
	await page.screenshot({ path: "logs/desktop-ui-acceptance/desktop.png" });
	await page.getByRole("button", { name: "任意时间", exact: true }).click();
	await page.screenshot({ path: "logs/desktop-ui-acceptance/date-range.png" });
	await page.getByRole("button", { name: "切换深色" }).click();
	assert.ok(await page.locator("html").evaluate((el) => el.classList.contains("dark")));
	await page.getByRole("button", { name: "任意时间", exact: true }).click();
	await verifyMonochrome();
	await page.screenshot({ path: "logs/desktop-ui-acceptance/dark.png" });
	await page.getByRole("button", { name: "切换浅色" }).click();
	await page.getByRole("button", { name: "任意时间", exact: true }).click();
	for (const width of [390, 320]) {
		await resize({ width, height: 844 });
		await page.screenshot({ path: `logs/desktop-ui-acceptance/${width === 390 ? "mobile" : "narrow"}.png` });
		const size = await page.evaluate(() => ({ document: document.documentElement.scrollWidth, viewport: innerWidth }));
		assert.ok(size.document <= size.viewport + 1, `${width}px viewport overflows to ${size.document}px`);
		assert.ok(await page.getByRole("navigation", { name: "主导航" }).isVisible());
		assert.ok(await page.getByLabel("开始日期", { exact: true }).isVisible());
		const formSize = await page.locator(".obs-date-editor").evaluate((el) => ({ scroll: el.scrollWidth, width: el.clientWidth }));
		assert.ok(formSize.scroll <= formSize.width + 1, `${width}px date editor overflows`);
		const editor = await page.locator(".obs-date-editor").boundingBox();
		assert.ok(editor.x >= 11 && editor.x + editor.width <= width - 11, `${width}px date popover exceeds viewport`);
	}
	await resize({ width: 1440, height: 1000 });
	await page.getByLabel("开始日期", { exact: true }).press("Escape");
	assert.equal(await page.locator(".obs-date-editor").count(), 0);
	await page.getByRole("link", { name: "请求流水", exact: true }).click();
	await waitData();
	await page.screenshot({ path: "logs/desktop-ui-acceptance/requests.png" });
	await page.getByRole("button", { name: "切换深色" }).click();
	await page.screenshot({ path: "logs/desktop-ui-acceptance/requests-dark.png" });
	await verifyMonochrome();
	await page.getByRole("button", { name: "切换浅色" }).click();
	await resize({ width: 900, height: 760 });
	await page.screenshot({ path: "logs/desktop-ui-acceptance/compact.png" });
	assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
	await resize({ width: 1440, height: 1000 });
	await page.getByRole("link", { name: "接入与口径", exact: true }).click();
	await page.getByRole("heading", { name: "采集覆盖" }).waitFor();
	await page.getByText("统计单位", { exact: true }).click();
	await page.getByText("独立重试分别计数", { exact: false }).waitFor();
	await verifyMonochrome();
	await page.evaluate(() => scrollTo(0, 0));
	await page.screenshot({ path: "logs/desktop-ui-acceptance/coverage.png" });
	for (const width of [390, 320]) {
		await resize({ width, height: 844 });
		assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
		await page.screenshot({ path: `logs/desktop-ui-acceptance/coverage-${width}.png` });
		await page.getByRole("link", { name: "请求流水", exact: true }).click();
		await waitData();
		assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
		await page.screenshot({ path: `logs/desktop-ui-acceptance/requests-${width}.png` });
		await page.getByRole("link", { name: "接入与口径", exact: true }).click();
		await page.getByRole("heading", { name: "采集覆盖" }).waitFor();
	}
	assert.deepEqual(errors, []);
	assert.deepEqual(resourceErrors, [], "Exported navigation and assets must not fail");
	record("黑白配色、桌面 / 深色 / 390px / 320px / reduced motion 与界面错误检查");
	await writeFile("logs/desktop-ui-acceptance/e2e.json", JSON.stringify({ passed: results, errors, resourceErrors, generatedAt: new Date().toISOString() }, null, 2));
} catch (error) {
	await writeFile("logs/desktop-ui-acceptance/failure.json", JSON.stringify({ error: error.message, pendingRequests: [...pendingRequests.values()], errors, resourceErrors }, null, 2));
	await page.screenshot({ path: "logs/desktop-ui-acceptance/failure.png" }).catch(() => {});
	throw error;
} finally {
	await app.close();
	assert.equal(path.dirname(path.resolve(scratch)), path.resolve(os.tmpdir()));
	assert.ok(path.basename(scratch).startsWith("ModelObservatoryUI-"));
	await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}
