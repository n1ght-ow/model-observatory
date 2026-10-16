import { collectNow, collectionState, setCollectionPaused } from "../lib/observatory/store";
import { isLocalMutation } from "../lib/observatory/request-origin";


export async function GET() {
	return Response.json(collectionState(), { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
	if (!isLocalMutation(request)) return Response.json({ error: "仅接受本地同源操作" }, { status: 403 });
	if (!request.headers.get("content-type")?.includes("application/json")) return Response.json({ error: "需要 application/json" }, { status: 415 });
	try {
		const body = await request.text();
		if (Buffer.byteLength(body) > 256) return Response.json({ error: "请求过大" }, { status: 413 });
		const data = JSON.parse(body);
		if (!data || typeof data !== "object" || (data.action !== "collect" && typeof data.paused !== "boolean")) return Response.json({ error: "需要 paused 布尔值或 collect 操作" }, { status: 400 });
		const state = data.action === "collect" ? await collectNow() : await setCollectionPaused(data.paused);
		return Response.json(state, { headers: { "Cache-Control": "no-store" } });
	} catch {
		return Response.json({ error: "采集状态更新失败，请重试" }, { status: 503 });
	}
}
