const fs = require("node:fs");
const path = require("node:path");

// Use Electron's bundled Node runtime, including its built-in SQLite module.
require("node:sqlite");
let server, closing = false;
process.parentPort.on("message", ({ data }) => {
	if (data !== "shutdown" || closing) return;
	closing = true;
	// Finish accepted HTTP writes and any scan they started before closing SQLite.
	void (async () => {
		if (server) await new Promise((resolve) => server.close(resolve));
		await closeCollection();
		process.exit(0);
	})().catch((error) => { console.error(error.stack); process.exit(1); });
});
process.on("uncaughtException", (error) => {
	console.error(error.stack);
	process.parentPort.postMessage({ type: "failure", message: error.message });
	process.exit(1);
});
const root = process.env.OBSERVATORY_SERVER_ROOT;
if (!root || !fs.existsSync(path.join(root, "server.cjs"))) throw new Error("Missing bundled collection service");
const { createDesktopServer, closeCollection } = require(path.join(root, "server.cjs"));
server = createDesktopServer(path.join(root, "ui"), process.env.OBSERVATORY_DESKTOP_TOKEN);
server.once("error", (error) => { throw error; });
server.listen(Number(process.env.PORT), "127.0.0.1", () => process.parentPort.postMessage({ type: "listening", port: server.address().port }));
