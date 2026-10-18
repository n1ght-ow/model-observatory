import type { Readable } from "node:stream";

// The local server already owns parsed headers and a size-limited body. Do not
// load a second HTTP client stack just to wrap them in Fetch API objects.
export type ApiRequest = { url: string; headers: Pick<Headers, "get">; text(): Promise<string> };
export type ApiResponse = { status: number; headers: Record<string, string>; body: string | Readable };

export function jsonResponse(value: unknown, options: { status?: number; headers?: Record<string, string> } = {}): ApiResponse {
	return { status: options.status ?? 200, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...options.headers }, body: JSON.stringify(value) };
}
