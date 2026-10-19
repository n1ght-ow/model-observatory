import assert from "node:assert/strict";
import { _electron } from "playwright";
import { appendFile, cp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { spawn } from "node:child_process";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { verifyRendererRecovery } from "./desktop-recovery.mjs";
import { verifyDesktopLifecycle } from "./desktop-lifecycle.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const shipped = process.env.DESKTOP_EXECUTABLE || path.join(root, "dist", "desktop", "win-unpacked", "ModelObservatory.exe");
assert.ok(existsSync(shipped), "Build the desktop executable first");
const scratch = path.join(os.tmpdir(), `ModelObservatoryAcceptance-${Date.now()}`);
const relocated = path.join(scratch, "独立应用 with spaces");
const home = path.join(scratch, "home");
const userData = path.join(scratch, "app-data");
const store = path.join(scratch, "ledger");
const evidence = path.join(root, "logs", "desktop-acceptance");
await mkdir(evidence, { recursive: true });
await mkdir(home, { recursive: true });
await cp(path.dirname(shipped), relocated, { recursive: true });
const executable = path.join(relocated, path.basename(shipped));
const env = { ...process.env, USERPROFILE: home, HOME: home, APPDATA: path.join(home, "AppData", "Roaming"), LOCALAPPDATA: path.join(home, "AppData", "Local"), OBSERVATORY_DESKTOP_USER_DATA: userData, OBSERVATORY_DATA_DIR: store, PATH: path.join(process.env.SystemRoot || "C:\\Windows", "System32") };
delete env.ELECTRON_RUN_AS_NODE;
const sessionFile = path.join(home, ".codex", "sessions", "desktop-test.jsonl");
await mkdir(path.dirname(sessionFile), { recursive: true });
const at = new Date().toISOString();
const event = (counter) => ({ timestamp: at, type: "event_msg", payload: { type: "token_count", info: { last_token_usage: { input_tokens: 120, output_tokens: 40, cached_input_tokens: 20 }, total_token_usage: { input_tokens: counter * 120, output_tokens: counter * 40 } } } });
await writeFile(sessionFile, [
	{ type: "session_meta", payload: { id: "desktop-packaging-fixture", originator: "Codex CLI" } },
	{ type: "turn_context", payload: { model: "desktop-fixture-model" } }, event(1),
].map((row) => JSON.stringify(row)).join("\n") + "\n");
let electronApp;
const passed = [], errors = [], requests = [];
const record = (name) => { passed.push(name); console.log(`PASS ${name}`); };
const waitUntil = async (fn, timeout = 30000) => {
	const end = Date.now() + timeout;
	while (Date.now() < end) { if (await fn()) return; await new Promise((resolve) => setTimeout(resolve, 200)); }
	throw new Error("Desktop condition timed out");
};
async function launch() {
	const app = await _electron.launch({ executablePath: executable, cwd: home, env, timeout: 60000 });
	electronApp = app;
	const page = await app.firstWindow();
	page.setDefaultTimeout(30000);
	page.on("pageerror", (e) => errors.push(e.message));
	page.on("request", (r) => requests.push(r.url()));
	await page.waitForURL(/^http:\/\/127\.0\.0\.1:\d+\//, { timeout: 60000 });
	const launchWindow = await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; return { visible: w.isVisible(), minimized: w.isMinimized(), contents: w.webContents.id }; });
	console.log("Launch window", JSON.stringify({ ...launchWindow, nativeVisible: await page.evaluate(() => window.desktopWindow?.isVisible()) }));
	assert.ok(launchWindow.visible && !launchWindow.minimized, "Manual launch must show a usable window");
	try { await page.getByTestId("request-total").waitFor({ timeout: 90000 }); }
	catch (error) {
		await page.screenshot({ path: path.join(evidence, "launch-failure.png") }).catch(() => {});
		console.error("Launch state", JSON.stringify(await page.evaluate(async () => ({ url: location.href, hidden: document.hidden, nativeVisible: await window.desktopWindow?.isVisible(), text: document.body.innerText.slice(-1000) })).catch(() => ({}))));
		throw error;
	}
	return { app, page };
}
try {
	const start = Date.now();
	let page;
	({ app: electronApp, page } = await launch());
	const startupMs = Date.now() - start;
	const initial = await page.evaluate(() => fetch("/api/observatory?range=all").then((r) => r.json()));
	assert.equal(initial.totals.requests, 1);
	assert.equal(initial.models[0].model, "desktop-fixture-model");
	assert.equal(initial.totals.input, 120);
	assert.equal(await page.locator("h1").innerText(), "模型总览");
	assert.equal(await electronApp.evaluate(({ app }) => app.isPackaged), true);
	assert.equal(await electronApp.evaluate(({ app }) => app.isHardwareAccelerationEnabled()), false);
	record(`独立目录、中文空格路径、隔离用户数据、无系统 Node PATH 启动（${startupMs} ms）`);
	assert.equal(await page.evaluate(() => typeof window.require), "undefined");
	assert.equal(await page.evaluate(() => typeof window.process), "undefined");
	const origin = new URL(page.url()).origin;
	for (const route of ["/", "/models", "/projects", "/sessions", "/requests", "/tools", "/favicon.ico", "/app.ico"]) {
		const response = await fetch(origin + route);
		assert.equal(response.status, 403, `Ordinary browser access must be closed: ${route}`);
		assert.match(await response.text(), /桌面应用/);
	}
	assert.equal((await fetch(origin, { headers: { "X-Observatory-Desktop": "wrong", "User-Agent": "Electron" } })).status, 403);
	const script = await page.evaluate(() => performance.getEntriesByType("resource").find((r) => /\/_next\/static\/.*\.js/.test(r.name))?.name);
	assert.ok(script);
	assert.equal((await fetch(script)).status, 403);
	record("普通浏览器无法打开界面和静态资源；伪造客户端名称无效");
	assert.ok(requests.every((url) => !/^https?:/.test(url) || new URL(url).origin === origin), requests.join("\n"));
	assert.ok((await page.evaluate(() => performance.getEntriesByType("resource").filter((r) => r.initiatorType === "css" || r.name.endsWith("woff2")).map((r) => r.name))).every((url) => new URL(url).origin === origin));
	record("原界面与字体均为本地资源；渲染进程无 Node 权限");
	await page.getByRole("button", { name: "展开 desktop-fixture-model", exact: true }).click();
	await page.getByRole("link", { name: "查看这个模型的请求" }).click();
	await page.getByRole("combobox", { name: "按模型筛选" }).waitFor();
	assert.equal(await page.getByRole("combobox", { name: "按模型筛选" }).inputValue(), "desktop-fixture-model");
	await page.locator(".obs-request-table tbody tr").first().getByRole("button").click();
	await page.locator(".obs-request-evidence").waitFor();
	record("原界面的模型展开、请求钻取、逐请求证据");
	const csvPath = path.join(evidence, "desktop-export.csv");
	await electronApp.evaluate(({ session }, target) => { session.defaultSession.once("will-download", (_event, item) => item.setSavePath(target)); }, csvPath);
	await page.getByRole("link", { name: "导出筛选结果" }).click();
	await waitUntil(() => existsSync(csvPath));
	assert.match(await readFile(csvPath, "utf8"), /desktop-fixture-model/);
	record("打包版 CSV 下载与保存");
	await page.getByRole("link", { name: /接入与口径/ }).first().click();
	await page.getByRole("heading", { name: "采集覆盖", exact: true }).waitFor();
	await page.locator(".obs-coverage-list article").filter({ hasText: "Cursor" }).first().waitFor();
	assert.equal(await page.locator("html").evaluate((el) => el.classList.contains("dark")), true, "Fresh desktop installs default to dark mode");
	await page.getByRole("button", { name: "切换浅色", exact: true }).click();
	assert.equal(await page.locator("html").evaluate((el) => el.classList.contains("dark")), false);
	await page.getByRole("button", { name: "切换深色", exact: true }).click();
	assert.equal(await page.locator("html").evaluate((el) => el.classList.contains("dark")), true);
	await page.screenshot({ path: path.join(evidence, "desktop-dark.png") });
	await page.getByRole("button", { name: "切换浅色", exact: true }).click();
	await page.getByRole("link", { name: "模型总览", exact: true }).click();
	await page.getByTestId("request-total").waitFor();
	record("接入覆盖与原界面深浅主题");
	await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 720));
	const resized = await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getSize());
	// At fractional Windows DPI, frame conversion rounds by one logical pixel.
	assert.ok(resized.every((value, i) => Math.abs(value - [900, 720][i]) <= 1), JSON.stringify(resized));
	assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
	await page.screenshot({ path: path.join(evidence, "desktop-narrow.png") });
	await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].maximize());
	await waitUntil(() => electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMaximized()));
	await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].unmaximize());
	await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].minimize());
	await waitUntil(() => electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMinimized()));
	await electronApp.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.restore(); w.show(); });
	record("标准窗口自由缩放、最大化、最小化和恢复");
	for (const [route, heading] of [["/projects", "项目账本"], ["/sessions", "会话账本"]]) {
		await page.evaluate((target) => location.assign(target), `${origin}${route}?range=all`);
		await page.waitForURL((url) => url.pathname === route);
		await page.getByRole("heading", { level: 1, name: heading, exact: true }).waitFor();
		await page.reload();
		await page.getByRole("heading", { level: 1, name: heading, exact: true }).waitFor();
		assert.equal(new URL(page.url()).searchParams.get("range"), "all");
	}
	const dashboardUrl = page.url();
	await page.evaluate((target) => location.assign(target), `${origin}/api/health`);
	await page.waitForTimeout(250);
	assert.equal(page.url(), dashboardUrl, "API responses must not replace the dashboard");
	record("项目与会话支持完整页面导航和刷新，API 不能作为界面导航目标");
	const currentUrl = page.url();
	await page.evaluate(() => { const a = document.createElement("a"); a.href = "https://example.com/desktop-navigation-test"; a.textContent = "external-test"; document.body.append(a); a.click(); a.remove(); });
	await page.waitForTimeout(250);
	assert.equal(page.url(), currentUrl);
	assert.equal(await page.evaluate(() => fetch("https://example.com/desktop-fetch-test").then(() => false, () => true)), true);
	let uiPolls = 0;
	const observePoll = (request) => { if (new URL(request.url()).pathname === "/api/observatory") uiPolls++; };
	page.on("request", observePoll);
	await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
	assert.equal(await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), false);
	await waitUntil(() => page.evaluate(() => window.desktopWindow.isVisible().then((value) => !value)));
	const hiddenPolls = uiPolls;
	await appendFile(sessionFile, JSON.stringify(event(2)) + "\n");
	await waitUntil(() => {
		if (!existsSync(path.join(store, "history.sqlite"))) return false;
		const db = new DatabaseSync(path.join(store, "history.sqlite"), { readOnly: true });
		try { return db.prepare("SELECT COUNT(*) AS n FROM observations").get().n === 2; } finally { db.close(); }
	}, 35000);
	assert.equal(uiPolls, hiddenPolls, "Hidden windows must not keep polling the ledger");
	page.off("request", observePoll);
	record("阻断外部导航与网络资源；隐藏后停止界面轮询，后台继续采集");
	await new Promise((resolve, reject) => {
		const second = spawn(executable, [], { cwd: home, env, windowsHide: true });
		second.once("error", reject); second.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`Second launch exited ${code}`)));
	});
	assert.equal(await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1);
	assert.equal(await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), true);
	record("再次打开唤回同一个窗口，不重复启动服务");
	const servicePid = await electronApp.evaluate(({ app }) => app.getAppMetrics().find((p) => p.name === "本机数据采集")?.pid);
	assert.ok(servicePid);
	await electronApp.evaluate((_electron, pid) => process.kill(pid), servicePid);
	await page.getByRole("button", { name: "重新打开", exact: true }).waitFor();
	await page.getByRole("button", { name: "重新打开", exact: true }).click();
	await page.getByTestId("request-total").waitFor({ timeout: 90000 });
	record("采集服务意外退出后原窗口可重试恢复");
	await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ x: 80, y: 80, width: 1120, height: 820 }));
	await page.waitForTimeout(250);
	await page.screenshot({ path: path.join(evidence, "desktop-light.png") });
	await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].maximize());
	await waitUntil(() => electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMaximized()));
	const finalService = await electronApp.evaluate(({ app }) => app.getAppMetrics().find((p) => p.name === "本机数据采集")?.pid);
	await electronApp.close(); electronApp = undefined;
	await waitUntil(() => { try { process.kill(finalService, 0); return false; } catch { return true; } });
	await rm(sessionFile);
	// Occupy the saved service port to verify automatic collision handling on restart.
	const saved = JSON.parse(await readFile(path.join(userData, "window.json"), "utf8"));
	await writeFile(path.join(evidence, "saved-window.json"), JSON.stringify(saved, null, 2));
	const occupied = net.createServer();
	await new Promise((resolve) => occupied.listen(saved.port, "127.0.0.1", resolve));
	try {
		({ app: electronApp, page } = await launch());
		assert.notEqual(new URL(page.url()).port, String(saved.port));
		const restored = await page.evaluate(() => fetch("/api/observatory?range=all").then((r) => r.json()));
		assert.equal(restored.totals.requests, 2);
		assert.equal(await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMaximized()), true);
		await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].unmaximize());
		console.log("Restored window", JSON.stringify({ saved, actual: await electronApp.evaluate(({ BrowserWindow, screen }) => ({ bounds: BrowserWindow.getAllWindows()[0].getBounds(), normal: BrowserWindow.getAllWindows()[0].getNormalBounds(), displays: screen.getAllDisplays().map((d) => ({ bounds: d.bounds, scale: d.scaleFactor })) })) }));
		await waitUntil(async () => {
			const size = await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getSize());
			return size.every((value, i) => Math.abs(value - [saved.width, saved.height][i]) <= 1);
		}, 3000);
		const restoredSize = await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getSize());
		assert.ok(restoredSize.every((value, i) => Math.abs(value - [saved.width, saved.height][i]) <= 1), JSON.stringify(restoredSize));
	} finally { await new Promise((resolve) => occupied.close(resolve)); }
	record("退出清理自有服务；重启保留历史和尺寸；端口冲突自动避让");
	await electronApp.close(); electronApp = undefined;
	await writeFile(path.join(userData, "window.json"), "null");
	({ app: electronApp, page } = await launch());
	assert.equal((await page.evaluate(() => fetch("/api/observatory?range=all").then((r) => r.json()))).totals.requests, 2);
	const quittingService = await electronApp.evaluate(({ app }) => app.getAppMetrics().find((p) => p.name === "本机数据采集")?.pid);
	await new Promise((resolve, reject) => {
		const quit = spawn(executable, ["--quit"], { cwd: home, env, windowsHide: true });
		quit.once("error", reject); quit.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`Quit command exited ${code}`)));
	});
	await waitUntil(() => { try { process.kill(quittingService, 0); return false; } catch { return true; } });
	await electronApp.close(); electronApp = undefined;
	record("损坏的窗口设置不影响历史读取；--quit 正常退出并清理采集服务");
	await verifyRendererRecovery({ executable, env, home, waitUntil });
	record("真实渲染进程崩溃重试清理原服务，恢复后只有一个采集进程");
	await verifyDesktopLifecycle({ executable, env, home, waitUntil });
	record("静默自启、系统禁用后重新开启、退出排空写入、离线补采、半行恢复及菜单和命令行重启去重");
	assert.deepEqual(errors, []);
	await writeFile(path.join(evidence, "report.json"), JSON.stringify({ passed, errors, startupMs, packagedExecutable: shipped, relocatedPath: relocated, testedAt: new Date().toISOString() }, null, 2));
	console.log(`RESULT: pass ${passed.length} desktop checks`);
} finally {
	if (electronApp) await electronApp.close().catch(() => {});
	if (path.dirname(scratch) !== os.tmpdir() || !path.basename(scratch).startsWith("ModelObservatoryAcceptance-")) throw new Error("Unexpected acceptance scratch path");
	await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }).catch((error) => console.warn(`Acceptance scratch cleanup: ${error.code}`));
}
