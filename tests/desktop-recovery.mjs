import assert from "node:assert/strict";
import { spawn } from "node:child_process";

// Chromium can emit late replies for a crashed target. Keep the fault test on
// Node's inspector, independent of Playwright's renderer protocol connection.
export async function verifyRendererRecovery({ executable, env, home, waitUntil }) {
	const child = spawn(executable, ["--inspect=0"], { cwd: home, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
	let output = "", websocket, sequence = 0;
	const callbacks = new Map();
	child.stdout.on("data", () => {});
	child.stderr.on("data", (data) => { output = (output + data).slice(-20000); });
	const exited = new Promise((resolve) => child.once("exit", resolve));
	let failure;
	child.once("error", (error) => { failure = error; });
	try {
		let endpoint;
		await waitUntil(() => {
			if (failure) throw failure;
			if (child.exitCode !== null) throw new Error(`Recovery fixture exited: ${child.exitCode}`);
			endpoint = /Debugger listening on (ws:\/\/127\.0\.0\.1:[^\s]+)/.exec(output)?.[1];
			return Boolean(endpoint);
		});
		websocket = new WebSocket(endpoint);
		await new Promise((resolve, reject) => { websocket.addEventListener("open", resolve, { once: true }); websocket.addEventListener("error", reject, { once: true }); });
		websocket.addEventListener("message", ({ data }) => {
			const message = JSON.parse(data);
			const callback = callbacks.get(message.id);
			if (!callback) return;
			callbacks.delete(message.id);
			if (message.error) callback.reject(new Error(message.error.message));
			else callback.resolve(message.result);
		});
		async function evaluate(expression) {
			const id = ++sequence;
			const result = await new Promise((resolve, reject) => {
				const timer = setTimeout(() => { callbacks.delete(id); reject(new Error("Inspector evaluation timed out")); }, 10000);
				callbacks.set(id, { resolve: (value) => { clearTimeout(timer); resolve(value); }, reject: (error) => { clearTimeout(timer); reject(error); } });
				websocket.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } }));
			});
			if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
			return result.result.value;
		}
		const electron = "process.mainModule.require('electron')";
		const window = `${electron}.BrowserWindow.getAllWindows()[0]`;
		await waitUntil(async () => evaluate(`Boolean(${window} && ${window}.webContents.getURL().startsWith('http://127.0.0.1:'))`));
		const oldService = await evaluate(`${electron}.app.getAppMetrics().find(p => p.name === '本机数据采集')?.pid`);
		assert.ok(oldService);
		await evaluate(`${window}.webContents.forcefullyCrashRenderer()`);
		await waitUntil(async () => {
			try { return await evaluate(`${window}.webContents.executeJavaScript("Boolean(document.getElementById('retry') && !document.getElementById('actions').hidden)")`); }
			catch { return false; }
		});
		await waitUntil(() => { try { process.kill(oldService, 0); return false; } catch { return true; } });
		await evaluate(`${window}.webContents.executeJavaScript("document.getElementById('retry').click()")`);
		await waitUntil(async () => evaluate(`${window}.webContents.getURL().startsWith('http://127.0.0.1:')`));
		const origin = await evaluate(`${window}.webContents.getURL()`);
		const snapshot = await fetch(new URL("/api/observatory?range=all", origin)).then((r) => r.json());
		assert.equal(snapshot.totals.requests, 2);
		assert.equal(await evaluate(`${electron}.app.getAppMetrics().filter(p => p.name === '本机数据采集').length`), 1);
		assert.equal(await evaluate(`${electron}.BrowserWindow.getAllWindows().length`), 1);
		const finalService = await evaluate(`${electron}.app.getAppMetrics().find(p => p.name === '本机数据采集')?.pid`);
		await evaluate(`${electron}.app.quit()`);
		websocket.close();
		await waitUntil(() => child.exitCode !== null);
		await waitUntil(() => { try { process.kill(finalService, 0); return false; } catch { return true; } });
		assert.equal(child.exitCode, 0);
	} finally {
		websocket?.close();
		if (child.exitCode === null) child.kill();
		await exited;
	}
}
