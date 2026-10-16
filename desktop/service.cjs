const fs = require("node:fs");
const path = require("node:path");

// Use Electron's bundled Node runtime, including its built-in SQLite module.
require("node:sqlite");
let server;
process.parentPort.on("message", ({ data }) => {
	if (data !== "shutdown") return;
	if (server) server.close(() => process.exit(0));
	else process.exit(0);
	setTimeout(() => process.exit(0), 1500).unref();
});
process.on("uncaughtException", (error) => {
	console.error(error.stack);
	process.parentPort.postMessage({ type: "failure", message: error.message });
	process.exit(1);
});
const root = process.env.OBSERVATORY_SERVER_ROOT;
if (!root || !fs.existsSync(path.join(root, "server.cjs"))) throw new Error("Missing bundled collection service");
const { createDesktopServer } = require(path.join(root, "server.cjs"));
server = createDesktopServer(path.join(root, "ui"), process.env.OBSERVATORY_DESKTOP_TOKEN);
server.once("error", (error) => { throw error; });
server.listen(Number(process.env.PORT), "127.0.0.1", () => process.parentPort.postMessage({ type: "listening", port: server.address().port }));
