import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";

export async function verifyDesktopLifecycle({ executable, env, home, waitUntil }) {
	const probe = net.createServer();
	await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
	const port = probe.address().port;
	await new Promise((resolve) => probe.close(resolve));
	const isolated = { ...env, OBSERVATORY_DESKTOP_USER_DATA: env.OBSERVATORY_DESKTOP_USER_DATA + "-lifecycle", OBSERVATORY_DATA_DIR: env.OBSERVATORY_DATA_DIR + "-lifecycle" };
	const source = path.join(home, ".codex", "sessions", "lifecycle.jsonl");
	const at = new Date().toISOString();
	const event = (n) => JSON.stringify({ timestamp: at, type: "event_msg", payload: { type: "token_count", info: { last_token_usage: { input_tokens: 120, output_tokens: 40 }, total_token_usage: { input_tokens: n * 120, output_tokens: n * 40 } } } });
	const prefix = [
		{ type: "session_meta", payload: { id: "lifecycle-fixture", originator: "Codex CLI" } },
		{ type: "turn_context", payload: { model: "lifecycle-model" } },
	].map(JSON.stringify).join("\n") + "\n";
	await mkdir(path.dirname(source), { recursive: true });
	await writeFile(source, prefix + event(1) + "\n");
	const child = spawn(executable, [`--inspect=${port}`, "--autostart"], { cwd: home, env: isolated, windowsHide: true, stdio: "ignore" });
	let failure, connection, lastPid;
	child.once("error", (error) => { failure = error; });
	const electron = "process.mainModule.require('electron')";
	const window = `${electron}.BrowserWindow.getAllWindows()[0]`;
	async function connect() {
		let endpoint;
		await waitUntil(async () => {
			if (failure) throw failure;
			try { endpoint = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json())[0]?.webSocketDebuggerUrl; return Boolean(endpoint); }
			catch { return false; }
		});
		const socket = new WebSocket(endpoint), pending = new Map();
		let sequence = 0;
		await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
		socket.addEventListener("message", ({ data }) => {
			const message = JSON.parse(data), callback = pending.get(message.id);
			if (callback) { pending.delete(message.id); callback(message); }
		});
		return {
			close: () => socket.close(),
			async evaluate(expression) {
				const id = ++sequence;
				const result = await new Promise((resolve, reject) => {
					const timer = setTimeout(() => { pending.delete(id); reject(new Error("Lifecycle inspector timed out")); }, 10000);
					pending.set(id, (message) => { clearTimeout(timer); if (message.error) reject(new Error(message.error.message)); else resolve(message.result); });
					socket.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } }));
				});
				if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
				return result.result.value;
			},
		};
	}
	const stopped = (pid) => { try { process.kill(pid, 0); return false; } catch { return true; } };
	async function ready() {
		await waitUntil(() => connection.evaluate(`Boolean(${window} && ${window}.webContents.getURL().startsWith('http://127.0.0.1:'))`));
		lastPid = await connection.evaluate("process.pid");
		return connection.evaluate(`${window}.webContents.getURL()`);
	}
	const command = (args) => new Promise((resolve, reject) => {
		const process = spawn(executable, args, { cwd: home, env: isolated, windowsHide: true, stdio: "ignore" });
		process.once("error", reject); process.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`Lifecycle command exited ${code}`)));
	});
	async function total(expected) {
		const origin = await ready();
		await waitUntil(async () => (await (await fetch(new URL("/api/observatory?range=all", origin))).json()).totals.requests === expected);
	}
	try {
		connection = await connect();
		await total(1);
		assert.equal(await connection.evaluate(`${window}.isVisible()`), false, "Autostart must stay in the tray");
		await command(["--autostart"]);
		assert.equal(await connection.evaluate(`${window}.isVisible()`), false, "Duplicate autostart must not show the window");
		await command([]);
		await waitUntil(() => connection.evaluate(`${window}.isVisible()`));
		console.log("PASS lifecycle: silent autostart, duplicate autostart and manual activation");

		// Give the real Windows startup API a unique entry; never touch the user's entry.
		const loginId = `local.model-observatory.acceptance.${Date.now()}`;
		await connection.evaluate(`${electron}.app.setAppUserModelId(${JSON.stringify(loginId)})`);
		try {
			await connection.evaluate(`${electron}.app.setLoginItemSettings({openAtLogin:true,enabled:false,path:process.execPath,args:['--autostart']})`);
			assert.equal(await connection.evaluate(`${electron}.app.getLoginItemSettings({path:process.execPath,args:['--autostart']}).openAtLogin`), true);
			assert.equal(await connection.evaluate(`(()=>{const menu=${electron}.Menu.getApplicationMenu().items[0].submenu;menu.emit('menu-will-show');return menu.getMenuItemById('autostart').checked})()`), false);
			// Exercise the menu's checkbox click, including Windows StartupApproved repair.
			await connection.evaluate(`(()=>{const item=${electron}.Menu.getApplicationMenu().getMenuItemById('autostart');item.checked=false;item.click()})()`);
			assert.equal(await connection.evaluate(`${electron}.app.getLoginItemSettings({path:'"'+process.execPath+'"',args:['--autostart']}).executableWillLaunchAtLogin`), true);
			await connection.evaluate(`${electron}.Menu.getApplicationMenu().items[0].submenu.emit('menu-will-show')`);
			assert.equal(await connection.evaluate(`${electron}.Menu.getApplicationMenu().getMenuItemById('autostart').checked`), true);
		} finally {
			await connection.evaluate(`${electron}.app.setLoginItemSettings({openAtLogin:false,enabled:false,path:process.execPath,args:['--autostart']});${electron}.app.setAppUserModelId('local.model-observatory.desktop')`);
		}
		console.log("PASS lifecycle: actual Windows startup approval and menu toggle");

		const oldPid = lastPid;
		const oldService = await connection.evaluate(`${electron}.app.getAppMetrics().find(p=>p.name==='本机数据采集').pid`);
		// Start an accepted but unfinished HTTP event. Quit must drain it before exit.
		const origin = await ready();
		const body = JSON.stringify({ id: "accepted-at-exit", at, model: "lifecycle-model", client: "fixture" });
		const socket = net.createConnection(Number(new URL(origin).port), "127.0.0.1");
		await new Promise((resolve, reject) => { socket.once("connect", resolve); socket.once("error", reject); });
		socket.write(`POST /api/observatory/events HTTP/1.1\r\nHost: ${new URL(origin).host}\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body.slice(0, 10)}`);
		let response = "";
		socket.on("data", (data) => { response += data; });
		const finished = new Promise((resolve, reject) => { socket.once("end", resolve); socket.once("error", reject); });
		await connection.evaluate(`setTimeout(()=>${electron}.Menu.getApplicationMenu().items[0].submenu.items.find(i=>i.label==='退出').click(),100);true`);
		connection.close(); connection = undefined;
		await new Promise((resolve) => setTimeout(resolve, 400));
		assert.equal(stopped(oldService), false, "Accepted request must drain before service exits");
		socket.write(body.slice(10));
		await finished;
		assert.match(response, /202 Accepted/);
		await waitUntil(() => stopped(oldPid) && stopped(oldService));
		console.log("PASS lifecycle: quit drains an accepted unfinished event");
		await appendFile(source, event(2) + "\n" + event(3).slice(0, 40));
		// Launch the stopped app through the restart entrypoint, which acts as manual open.
		const reopened = spawn(executable, [`--inspect=${port}`, "--restart"], { cwd: home, env: isolated, windowsHide: true, stdio: "ignore" });
		reopened.once("error", (error) => { failure = error; });
		connection = await connect();
		await total(3);
		assert.equal(await connection.evaluate(`${window}.isVisible()`), true);
		await appendFile(source, event(3).slice(40) + "\n");
		await total(4);
		console.log("PASS lifecycle: offline catch-up and completed partial line");

		const beforeRestart = lastPid;
		const beforeService = await connection.evaluate(`${electron}.app.getAppMetrics().find(p=>p.name==='本机数据采集').pid`);
		await connection.evaluate(`setTimeout(()=>${electron}.Menu.getApplicationMenu().items[0].submenu.items.find(i=>i.label==='重新启动').click(),100);true`);
		connection.close(); connection = undefined;
		await waitUntil(() => stopped(beforeRestart) && stopped(beforeService));
		connection = await connect();
		await total(4);
		assert.notEqual(lastPid, beforeRestart);
		assert.equal(await connection.evaluate(`${window}.isVisible()`), true);
		assert.equal(await connection.evaluate(`${electron}.app.getAppMetrics().filter(p=>p.name==='本机数据采集').length`), 1);
		console.log("PASS lifecycle: menu relaunch cleans the old service and retains exact totals");
		// Replaying all complete lines on a second restart still counts each ID once.
		const menuRestartPid = lastPid;
		connection.close(); connection = undefined;
		await command(["--restart"]);
		await waitUntil(() => stopped(menuRestartPid));
		connection = await connect();
		await total(4);
		const finalPid = lastPid, finalService = await connection.evaluate(`${electron}.app.getAppMetrics().find(p=>p.name==='本机数据采集').pid`);
		connection.close(); connection = undefined;
		await command(["--quit"]);
		await waitUntil(() => stopped(finalPid) && stopped(finalService));
		console.log("PASS lifecycle: command-line restart and quit");
	} finally {
		connection?.close();
		await command(["--quit"]).catch(() => {});
		if (child.exitCode === null) child.kill();
		if (lastPid && !stopped(lastPid)) process.kill(lastPid);
	}
}
