import { appendEvent, parseIngest } from "../lib/observatory/store";


export async function POST(request: Request) {
	const origin = request.headers.get("origin");
	if (origin && origin !== new URL(request.url).origin) return Response.json({ error: "仅接受本地同源事件" }, { status: 403 });
	if (!request.headers.get("content-type")?.includes("application/json")) return Response.json({ error: "需要 application/json" }, { status: 415 });
	try {
		const body = await request.text();
		if (Buffer.byteLength(body) > 8192) return Response.json({ error: "事件过大" }, { status: 413 });
		const event = parseIngest(JSON.parse(body));
		await appendEvent(event);
		return Response.json({ accepted: true, id: event.id }, { status: 202 });
	} catch (error) {
		return Response.json({ error: error instanceof Error ? error.message : "无效事件" }, { status: 400 });
	}
}
