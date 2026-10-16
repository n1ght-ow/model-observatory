import { cp, mkdir, readdir, readFile, rename, rmdir, rm } from "node:fs/promises";
import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
// Recent Electron npm packages download their runtime lazily on first use.
createRequire(import.meta.url)("electron");
await readFile(path.join(root, "out", "index.html"));
const stage = path.join(root, "dist", "desktop-server");
if (path.dirname(stage) !== path.join(root, "dist") || path.basename(stage) !== "desktop-server") throw new Error("Invalid staging path");
await rm(stage, { recursive: true, force: true });
await mkdir(stage, { recursive: true });
await cp(path.join(root, "out"), path.join(stage, "ui"), { recursive: true });
const ui = path.join(stage, "ui");
async function normalizeSegments(dir) {
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		const filename = path.join(dir, entry.name);
		if (entry.isDirectory()) { await normalizeSegments(filename); continue; }
		const parts = path.relative(ui, filename).split(path.sep);
		const index = parts.findIndex((part) => part.startsWith("__next."));
		if (index >= 0 && index < parts.length - 1) {
			// Next's client flattens segment paths with dots. Windows exports can
			// retain backslashes as directories instead; correct the artifact once.
			await rename(filename, path.join(ui, ...parts.slice(0, index), parts.slice(index).join(".")));
		}
	}
	if (path.basename(dir).startsWith("__next.") && !(await readdir(dir)).length) await rmdir(dir);
}
await normalizeSegments(ui);
// Only this bundle and exported assets run on users' computers. No Next server,
// package tree or build-time dependency is copied into the desktop resources.
await build({ absWorkingDir: root, entryPoints: ["src/server/http.ts"], outfile: path.join(stage, "server.cjs"), bundle: true, platform: "node", target: "node24", format: "cjs", packages: "bundle", tsconfig: path.join(root, "tsconfig.json") });
await cp(path.join(root, "public", "app.ico"), path.join(root, "desktop", "icon.ico"));
async function inspect(dir) {
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		const filename = path.join(dir, entry.name);
		if (entry.name.startsWith(".env") || /^(history\.sqlite(?:-wal|-shm)?|aliases\.json|events\.jsonl|auth\.json)$/i.test(entry.name)) throw new Error(`Private runtime data cannot be packaged: ${filename}`);
		if (entry.isDirectory()) await inspect(filename);
	}
}
await inspect(stage);
console.log("Static interface and lean data service staged; no Next runtime, node_modules or private user data included.");
