import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import * as health from "./health";
import * as observatory from "./observatory";
import * as aliases from "./aliases";
import * as events from "./events";
import * as collection from "./collection";
export { closeCollection } from "../lib/observatory/store";

type Handler = (request: Request) => Promise<Response>;
const routes: Record<string, { handlers: Record<string, Handler>; limit?: number }> = {
	"/api/health": { handlers: { GET: health.GET } },
	"/api/observatory": { handlers: { GET: observatory.GET } },
	"/api/observatory/events": { handlers: { POST: events.POST }, limit: 8192 },
	"/api/observatory/aliases": { handlers: { POST: aliases.POST }, limit: 2048 },
	"/api/observatory/collection": { handlers: { GET: collection.GET, POST: collection.POST }, limit: 256 },
};
const mime: Record<string, string> = {
	".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
	".txt": "text/plain; charset=utf-8", ".json": "application/json; charset=utf-8", ".ico": "image/x-icon",
	".woff2": "font/woff2", ".woff": "font/woff", ".svg": "image/svg+xml", ".png": "image/png",
};
function respond(response: ServerResponse, status: number, text: string) {
	response.writeHead(status, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
	response.end(text);
}

/** Serve only the exported interface and existing data APIs, with no SSR runtime. */
export function createDesktopServer(assets: string, token: string) {
	const root = path.resolve(assets);
	async function handle(request: IncomingMessage, response: ServerResponse) {
		const port = (request.socket.address() as { port: number }).port;
		if (!["127.0.0.1:" + port, "localhost:" + port].includes(request.headers.host ?? "")) {
			request.resume(); return respond(response, 400, "Invalid local host");
		}
		const origin = "http://" + request.headers.host;
		const url = new URL(request.url ?? "/", origin);
		if (url.origin !== origin) { request.resume(); return respond(response, 400, "Invalid request target"); }
		if (url.pathname.startsWith("/api/")) {
			const route = routes[url.pathname], method = request.method ?? "GET";
			if (!route) { request.resume(); return respond(response, 404, "Not found"); }
			const handler = route.handlers[method] ?? (method === "HEAD" ? route.handlers.GET : undefined);
			if (!handler) {
				request.resume(); response.setHeader("Allow", Object.keys(route.handlers).join(", "));
				return respond(response, 405, "Method not allowed");
			}
			const chunks: Buffer[] = [];
			let size = 0;
			if (method !== "GET" && method !== "HEAD") {
				// Stop buffering as soon as the endpoint's limit is crossed, even if
				// the caller omits Content-Length or streams a chunked request.
				for await (const chunk of request.iterator({ destroyOnReturn: false })) {
					size += chunk.length;
					if (size > (route.limit ?? 0)) { request.resume(); return respond(response, 413, "Request too large"); }
					chunks.push(chunk);
				}
			} else request.resume();
			const headers = new Headers();
			for (const [key, value] of Object.entries(request.headers)) if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(", ") : value);
			const result = await handler(new Request(url, { method, headers, ...(chunks.length ? { body: Buffer.concat(chunks) } : {}) }));
			response.writeHead(result.status, Object.fromEntries(result.headers));
			if (method === "HEAD") { await result.body?.cancel(); response.end(); }
			else if (result.body) await pipeline(Readable.fromWeb(result.body as import("node:stream/web").ReadableStream), response);
			else response.end();
			return;
		}
		request.resume();
		if (!token || request.headers["x-observatory-desktop"] !== token) return respond(response, 403, "请从 Model Observatory 桌面应用打开。");
		if (!["GET", "HEAD"].includes(request.method ?? "")) return respond(response, 405, "Method not allowed");
		if (url.pathname === "/models") { response.writeHead(302, { Location: "/", "Cache-Control": "no-store" }); response.end(); return; }
		let name: string;
		try { name = decodeURIComponent(url.pathname); } catch { return respond(response, 400, "Invalid path"); }
		if (name.includes("\\") || name.includes("\0")) return respond(response, 404, "Not found");
		if (name === "/") name = "/index.html";
		else if (["/requests", "/tools"].includes(name)) name += ".html";
		const filename = path.resolve(root, "." + name);
		if (!filename.startsWith(root + path.sep)) return respond(response, 404, "Not found");
		const file = await stat(filename).catch(() => undefined);
		if (!file?.isFile()) return respond(response, 404, "Not found");
		response.writeHead(200, {
			"Content-Type": mime[path.extname(filename)] ?? "application/octet-stream", "Content-Length": file.size,
			"Cache-Control": name.startsWith("/_next/static/") ? "public, max-age=31536000, immutable" : "no-store",
			"X-Content-Type-Options": "nosniff",
		});
		if (request.method === "HEAD") response.end();
		else await pipeline(createReadStream(filename), response);
	}
	return createServer({ maxHeaderSize: 16 * 1024, requestTimeout: 30000 }, (request, response) => {
		void handle(request, response).catch((error: NodeJS.ErrnoException) => {
			if (response.destroyed || error.code === "ERR_STREAM_PREMATURE_CLOSE" || error.code === "ECONNRESET") return;
			console.error("Local request:", error.message);
			if (response.headersSent) response.destroy(); else respond(response, 500, "Local request failed");
		});
	});
}
