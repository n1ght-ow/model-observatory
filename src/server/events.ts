import { jsonResponse, type ApiRequest } from "./message";
import { appendEvent, parseIngest } from "../lib/observatory/store";


export async function POST(request: ApiRequest) {
	const origin = request.headers.get("origin");
	if (origin && origin !== new URL(request.url).origin) return jsonResponse({ error: "仅接受本地同源事件" }, { status: 403 });
	if (!request.headers.get("content-type")?.includes("application/json")) return jsonResponse({ error: "需要 application/json" }, { status: 415 });
	try {
		const body = await request.text();
		if (Buffer.byteLength(body) > 8192) return jsonResponse({ error: "事件过大" }, { status: 413 });
		const event = parseIngest(JSON.parse(body));
		await appendEvent(event);
		return jsonResponse({ accepted: true, id: event.id }, { status: 202 });
	} catch (error) {
		return jsonResponse({ error: error instanceof Error ? error.message : "无效事件" }, { status: 400 });
	}
}
