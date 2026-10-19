const { app, BrowserWindow, Menu, Tray, dialog, globalShortcut, ipcMain, screen, session, shell, utilityProcess } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");
const { randomBytes } = require("node:crypto");
const { pathToFileURL } = require("node:url");
const { localJson } = require("./request.cjs");

if (process.env.OBSERVATORY_DESKTOP_USER_DATA) app.setPath("userData", path.resolve(process.env.OBSERVATORY_DESKTOP_USER_DATA));
app.setName("Model Observatory");
app.setAppUserModelId("local.model-observatory.desktop");
// This table/SVG interface stays responsive in software; avoiding the hardware
// compositor's driver allocations saves substantial memory on Windows.
app.disableHardwareAcceleration();
// Chromium background features have no purpose in this local-only interface.
app.commandLine.appendSwitch("disable-background-networking");
app.commandLine.appendSwitch("disable-component-update");
app.commandLine.appendSwitch("disable-domain-reliability");
app.commandLine.appendSwitch("no-proxy-server");
// This is one local window. Skip the extra renderer, frozen page cache,
// audio process and other unused Chromium services.
app.commandLine.appendSwitch("disable-features", "SpareRendererForSitePerProcess,BackForwardCache,AudioServiceOutOfProcess,MediaRouter,Translate,OptimizationHints");
const startupUrl = pathToFileURL(path.join(__dirname, "startup.html")).href;
const desktopToken = randomBytes(32).toString("hex");
const settingsPath = path.join(app.getPath("userData"), "window.json");
let settings = {};
try {
	const value = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
	if (value && typeof value === "object" && !Array.isArray(value)) settings = value;
} catch { /* First launch or interrupted settings write. */ }
let window, tray, child, origin = "", starting, collectionTimer, quitting = false, shutdownComplete = false, restarting = false, stopping, collectionRequest, startupRequest, pendingGeometry, failure, saveTimer;
const startedAt = Date.now();
let logPath, logBytes = 0, savedSettings = "";
function log(message) {
	try {
		if (!logPath) {
			const dir = path.join(app.getPath("userData"), "logs");
			fs.mkdirSync(dir, { recursive: true }); logPath = path.join(dir, "desktop.log");
			if (fs.existsSync(logPath)) logBytes = fs.statSync(logPath).size;
		}
		if (logBytes >= 2 * 1024 * 1024) {
			fs.copyFileSync(logPath, logPath + ".old"); fs.truncateSync(logPath, 0); logBytes = 0;
		}
		const line = `${new Date().toISOString()} ${String(message).slice(0, 16384)}\n`;
		fs.appendFileSync(logPath, line); logBytes += Buffer.byteLength(line);
	} catch { /* Logging cannot prevent launch. */ }
}
function saveWindow() {
	clearTimeout(saveTimer);
	if (!window || window.isDestroyed()) return;
	const liveBounds = window.isMaximized() || window.isMinimized() ? window.getNormalBounds() : window.getBounds();
	const bounds = pendingGeometry ? { ...liveBounds, width: pendingGeometry.width, height: pendingGeometry.height } : liveBounds;
	settings = { ...settings, ...bounds, maximized: pendingGeometry ? pendingGeometry.maximized : window.isMaximized(), topMost: window.isAlwaysOnTop(), zoom: window.webContents.getZoomFactor() };
	try {
		const encoded = JSON.stringify(settings, null, 2);
		if (encoded === savedSettings) return;
		fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
		const temp = settingsPath + ".tmp";
		fs.writeFileSync(temp, encoded); fs.renameSync(temp, settingsPath); savedSettings = encoded;
	} catch (error) { log(`Window settings: ${error.message}`); }
}
function scheduleSave() { clearTimeout(saveTimer); saveTimer = setTimeout(saveWindow, 250); }
function windowVisible() { return Boolean(window && !window.isDestroyed() && window.isVisible() && !window.isMinimized()); }
function showWindow() {
	if (!window || window.isDestroyed()) return;
	window.show();
	// Windows can apply a hidden launcher's startup show state on the first
	// ShowWindow call. Restore after it so a manual launch is actually usable.
	if (!window.isVisible()) window.show();
	if (window.isMinimized()) window.restore();
	if (pendingGeometry) {
		const desired = pendingGeometry; pendingGeometry = undefined;
		let requestedWidth = desired.width, requestedHeight = desired.height;
		// The native frame's DPI rounding is final only after its first ShowWindow.
		for (let attempt = 0; attempt < 2; attempt++) {
			const [width, height] = window.getSize();
			if (width === desired.width && height === desired.height) break;
			requestedWidth -= width - desired.width; requestedHeight -= height - desired.height;
			window.setSize(requestedWidth, requestedHeight);
		}
		if (desired.maximized) window.maximize();
	}
	window.focus();
}
function localPage(url) {
	try { const parsed = new URL(url); return parsed.origin === origin && ["/", "/models", "/projects", "/sessions", "/requests", "/tools"].includes(parsed.pathname); }
	catch { return false; }
}
function restart() {
	if (quitting || restarting) return;
	restarting = true;
	app.quit();
}
function loginEnabled() {
	// Electron 44 parses this lookup as a command line, so quote spaced paths.
	const state = app.getLoginItemSettings({ path: `"${process.execPath}"`, args: ["--autostart"] });
	return state.openAtLogin && state.executableWillLaunchAtLogin;
}
function buildMenu() {
	const portable = Boolean(process.env.PORTABLE_EXECUTABLE_FILE);
	const common = [
		{ label: "打开模型账本", click: showWindow },
		{ label: "窗口置顶", type: "checkbox", checked: Boolean(window?.isAlwaysOnTop()), click: (item) => { window.setAlwaysOnTop(item.checked); saveWindow(); buildMenu(); } },
		{ id: "autostart", label: portable ? "开机启动（安装版可用）" : "开机启动", type: "checkbox", enabled: app.isPackaged && !portable, checked: app.isPackaged && !portable && loginEnabled(), click: (item) => {
			try { app.setLoginItemSettings({ openAtLogin: item.checked, enabled: item.checked, path: process.execPath, args: ["--autostart"] }); }
			catch (error) { log(`Autostart: ${error.message}`); dialog.showErrorBox("开机启动设置失败", "请重试，或在 Windows 设置中检查启动应用。"); }
			buildMenu();
		} },
		{ type: "separator" },
		{ label: "查看诊断日志", click: () => { log("Open diagnostics"); void shell.openPath(path.dirname(logPath)); } },
		{ label: "重新启动", accelerator: "CommandOrControl+Shift+R", click: restart },
		{ label: "退出", accelerator: "CommandOrControl+Q", click: () => app.quit() },
	];
	const appMenu = Menu.buildFromTemplate([
		{ label: "应用", submenu: common },
		{ label: "编辑", submenu: [{ role: "undo", label: "撤销" }, { role: "redo", label: "重做" }, { type: "separator" }, { role: "cut", label: "剪切" }, { role: "copy", label: "复制" }, { role: "paste", label: "粘贴" }, { role: "selectAll", label: "全选" }] },
		{ label: "视图", submenu: [{ role: "reload", label: "重新加载" }, { type: "separator" }, { role: "resetZoom", label: "实际大小" }, { role: "zoomIn", label: "放大" }, { role: "zoomOut", label: "缩小" }, { type: "separator" }, { role: "togglefullscreen", label: "全屏" }] },
	]);
	const trayMenu = Menu.buildFromTemplate(common);
	for (const menu of [appMenu.items[0].submenu, trayMenu]) menu.on("menu-will-show", () => {
		const item = menu.getMenuItemById("autostart");
		if (item.enabled) item.checked = loginEnabled();
	});
	Menu.setApplicationMenu(appMenu);
	tray.setContextMenu(trayMenu);
}
function freePort(preferred) {
	return new Promise((resolve, reject) => {
		const probe = net.createServer();
		probe.once("error", (error) => preferred && error.code === "EADDRINUSE" ? freePort(0).then(resolve, reject) : reject(error));
		probe.listen(preferred, "127.0.0.1", () => { const port = probe.address().port; probe.close(() => resolve(port)); });
	});
}
async function collect() {
	if (!origin || collectionRequest || quitting) return;
	const request = new AbortController(); collectionRequest = request;
	try {
		await localJson(origin + "/api/observatory/collection", { body: '{"action":"collect"}', signal: AbortSignal.any([request.signal, AbortSignal.timeout(90000)]) });
	} catch (error) { if (!quitting && !request.signal.aborted) log(`Collection: ${error.message}`); }
	finally { if (collectionRequest === request) collectionRequest = undefined; }
}
async function launchService() {
	const root = app.isPackaged ? path.join(process.resourcesPath, "server") : path.join(__dirname, "..", "dist", "desktop-server");
	if (!fs.existsSync(path.join(root, "server.cjs"))) throw new Error("Bundled service missing. Run npm run desktop:prepare first.");
	const port = await freePort(Number.isInteger(settings.port) && settings.port > 1024 && settings.port < 65536 ? settings.port : 43871);
	if (quitting) return;
	origin = `http://127.0.0.1:${port}`;
	const service = await new Promise((resolve, reject) => {
		const service = utilityProcess.fork(path.join(__dirname, "service.cjs"), [], {
			cwd: root, serviceName: "本机数据采集", stdio: "pipe",
			env: { ...process.env, NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1", HOSTNAME: "127.0.0.1", PORT: String(port), OBSERVATORY_SERVER_ROOT: root, OBSERVATORY_DESKTOP_TOKEN: desktopToken },
		});
		child = service;
		const timeout = setTimeout(() => { reject(new Error("Local service start timed out")); service.kill(); }, 45000);
		service.stdout.on("data", (data) => log(`service: ${data.toString().trim()}`));
		service.stderr.on("data", (data) => log(`service: ${data.toString().trim()}`));
		let ready = false;
		service.on("message", (message) => {
			if (message.type === "listening") { ready = true; clearTimeout(timeout); resolve(service); }
			if (message.type === "failure") { clearTimeout(timeout); reject(new Error(message.message)); }
		});
		service.once("exit", (code) => {
			clearTimeout(timeout);
			const current = child === service;
			if (current) child = undefined;
			if (!ready) reject(new Error(`Local service exited (${code})`));
			else if (current && !quitting && !stopping && !starting) { log(`Service exited (${code})`); void showFailure(); }
		});
	});
	if (quitting) return;
	const health = await localJson(origin + "/api/health", { signal: AbortSignal.any([startupRequest.signal, AbortSignal.timeout(45000)]) });
	if (quitting) return;
	if (child !== service) throw new Error("Local service exited during startup");
	if (health.app !== "router-monitor-dashboard" || !health.ok) throw new Error("Local service health check failed");
	settings.port = port;
	await window.loadURL(origin);
	if (quitting || window.isDestroyed()) return;
	if (child !== service) throw new Error("Local service exited while loading the interface");
	window.webContents.setZoomFactor(Math.min(1.5, Math.max(.75, Number(settings.zoom) || 1)));
	clearInterval(collectionTimer);
	collectionTimer = setInterval(() => void collect(), 15000);
	void collect();
	saveWindow();
	log(`Ready in ${Date.now() - startedAt}ms; service ${origin}; Electron ${process.versions.electron}; Node ${process.versions.node}`);
}
async function showFailure() {
	if (quitting || !window || window.isDestroyed()) return;
	if (failure) return failure;
	failure = (async () => {
		// A renderer crash leaves the utility process alive. Dispose it before
		// enabling retry, so recovery can never orphan a second collector.
		await stopService();
		if (quitting || window.isDestroyed()) return;
		await window.loadFile(path.join(__dirname, "startup.html"));
		if (!quitting && !window.isDestroyed()) window.webContents.send("desktop:failure");
	})().catch((error) => log(`Recovery: ${error.message}`)).finally(() => { failure = undefined; });
	return failure;
}
async function start() {
	if (quitting) return;
	if (starting) return starting;
	starting = (async () => {
		try { await stopService(); startupRequest = new AbortController(); if (!quitting) await launchService(); }
		catch (error) { log(error.stack); await stopService(); await showFailure(); }
	})().finally(() => { starting = undefined; startupRequest = undefined; });
	return starting;
}
async function stopService() {
	clearInterval(collectionTimer);
	collectionRequest?.abort(); collectionRequest = undefined;
	if (stopping) return stopping;
	const service = child;
	if (!service) return;
	stopping = new Promise((resolve) => {
		let timer;
		service.once("exit", () => { clearTimeout(timer); resolve(); });
		try { service.postMessage("shutdown"); } catch (error) { log(`Shutdown: ${error.message}`); }
		timer = setTimeout(() => { log("Service shutdown timed out; retained logs will be replayed on launch"); try { service.kill(); } catch {} }, 12000);
	}).finally(() => { stopping = undefined; });
	return stopping;
}

const launchAction = process.argv.includes("--quit") ? "quit" : process.argv.includes("--restart") ? "restart" : process.argv.includes("--autostart") ? "autostart" : "show";
const locked = app.requestSingleInstanceLock({ action: launchAction });
if (!locked || process.argv.includes("--quit")) app.quit();
else {
	app.on("second-instance", (_event, _argv, _cwd, data) => {
		// Chromium may append flags to argv; preserve the sender's actual intent.
		if (data?.action === "quit") app.quit();
		else if (data?.action === "restart") restart();
		else if (data?.action !== "autostart") showWindow();
	});
	app.on("activate", showWindow);
	app.on("window-all-closed", () => {});
	app.on("before-quit", (event) => {
		if (quitting) { if (!shutdownComplete) event.preventDefault(); return; }
		event.preventDefault(); quitting = true;
		startupRequest?.abort();
		saveWindow(); globalShortcut.unregisterAll();
		void stopService().finally(() => {
			if (restarting) {
				const args = process.argv.slice(1).filter((arg) => !["--autostart", "--quit", "--restart"].includes(arg));
				app.relaunch({ args, ...(process.env.PORTABLE_EXECUTABLE_FILE ? { execPath: process.env.PORTABLE_EXECUTABLE_FILE } : {}) });
			}
			shutdownComplete = true;
			app.quit();
		});
	});
	app.whenReady().then(async () => {
		log(`Launch ${app.getVersion()}; packaged=${app.isPackaged}`);
		const work = screen.getPrimaryDisplay().workArea;
		const restoreMaximized = Boolean(settings.maximized);
		const restoreZoom = Math.min(1.5, Math.max(.75, Number(settings.zoom) || 1));
		const width = Math.round(Math.max(Math.min(780, work.width), Math.min(Number.isFinite(settings.width) ? settings.width : 1440, work.width)));
		const height = Math.round(Math.max(Math.min(600, work.height), Math.min(Number.isFinite(settings.height) ? settings.height : 960, work.height)));
		pendingGeometry = { width, height, maximized: restoreMaximized };
		const visibleBounds = Number.isFinite(settings.x) && Number.isFinite(settings.y) && screen.getAllDisplays().some(({ workArea: a }) => settings.x < a.x + a.width - 80 && settings.x + width > a.x + 80 && settings.y >= a.y && settings.y < a.y + a.height - 50);
		const icon = app.isPackaged ? path.join(__dirname, "icon.ico") : path.join(__dirname, "..", "public", "app.ico");
		window = new BrowserWindow({
			title: "Model Observatory", width, height, minWidth: Math.min(780, work.width), minHeight: Math.min(600, work.height), ...(visibleBounds ? { x: Math.round(settings.x), y: Math.round(settings.y) } : {}),
			icon, show: false, backgroundColor: "#141414", autoHideMenuBar: true,
			webPreferences: { preload: path.join(__dirname, "preload.cjs"), nodeIntegration: false, contextIsolation: true, sandbox: true, spellcheck: false, backgroundThrottling: true },
		});
		window.setAlwaysOnTop(Boolean(settings.topMost));
		window.webContents.setZoomFactor(restoreZoom);
		window.on("close", (event) => { saveWindow(); if (!quitting) { event.preventDefault(); window.hide(); } });
		window.on("resized", scheduleSave); window.on("moved", scheduleSave);
		for (const event of ["show", "hide", "minimize", "restore"]) window.on(event, () => {
			if (!window.webContents.isDestroyed()) window.webContents.send("desktop:visibility", windowVisible());
		});
		window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
		for (const event of ["will-navigate", "will-redirect"]) window.webContents.on(event, (e, url) => { if (!localPage(url) && url !== startupUrl) e.preventDefault(); });
		window.webContents.on("render-process-gone", (_event, details) => { if (!quitting) { log(`Renderer exited: ${details.reason}`); void showFailure(); } });
		const ses = session.defaultSession;
		await ses.setProxy({ mode: "direct" });
		if (quitting) return;
		ses.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
		ses.setPermissionCheckHandler(() => false);
		ses.webRequest.onBeforeRequest((details, callback) => {
			const url = new URL(details.url);
			const allowed = url.origin === origin || ["file:", "data:", "blob:"].includes(url.protocol);
			if (!allowed) log(`Blocked external resource: ${url.origin}`);
			callback({ cancel: !allowed });
		});
		ses.webRequest.onBeforeSendHeaders((details, callback) => {
			const requestHeaders = { ...details.requestHeaders };
			if (new URL(details.url).origin === origin) requestHeaders["X-Observatory-Desktop"] = desktopToken;
			callback({ requestHeaders });
		});
		ses.on("will-download", (_event, item) => item.setSaveDialogOptions({ title: "导出请求", defaultPath: path.join(app.getPath("downloads"), item.getFilename()) }));
		tray = new Tray(icon); tray.setToolTip("Model Observatory"); tray.on("click", showWindow); tray.on("double-click", showWindow); buildMenu();
		if (!globalShortcut.register("Alt+A", showWindow)) log("Global hotkey Alt+A is already in use");
		ipcMain.handle("desktop:retry", (event) => { if (event.senderFrame?.url === startupUrl) return start(); });
		ipcMain.handle("desktop:logs", (event) => { if (event.senderFrame?.url === startupUrl) return shell.openPath(path.dirname(logPath)); });
		ipcMain.handle("desktop:visibility", (event) => event.sender.id === window.webContents.id && windowVisible());
		await window.loadFile(path.join(__dirname, "startup.html"));
		if (!process.argv.includes("--autostart")) showWindow();
		void start();
	}).catch((error) => { log(error.stack); if (!quitting) dialog.showErrorBox("Model Observatory 启动失败", "请重新打开应用，或查看应用数据目录中的 logs/desktop.log。"); app.quit(); });
}
