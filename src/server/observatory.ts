import { jsonResponse, type ApiRequest } from "./message";
import { Readable } from "node:stream";
import { getSnapshot } from "../lib/observatory/store";
import { validCustomDates } from "../lib/observatory/time-range";


export async function GET(request: ApiRequest) {
	const url = new URL(request.url);
	const range = url.searchParams.get("range") ?? "today";
	if (!["today", "week", "month", "custom", "24h", "7d", "30d", "all"].includes(range)) return jsonResponse({ error: "无效时间范围" }, { status: 400 });
	const dates = range === "custom" ? { from: url.searchParams.get("from") ?? "", to: url.searchParams.get("to") ?? "" } : undefined;
	if (dates && !validCustomDates(dates)) return jsonResponse({ error: "请选择有效的起止日期，开始日期不能晚于结束日期" }, { status: 400 });
	try {
		const snapshot = await getSnapshot(range, dates);
		const query = (url.searchParams.get("query") ?? "").toLowerCase().slice(0, 200);
		const model = url.searchParams.get("model");
		const client = url.searchParams.get("client");
		const rows = model || client || query ? snapshot.requests.filter((r) => (!model || r.model === model) && (!client || r.client === client) && (!query || `${r.model} ${r.rawModel} ${r.client} ${r.upstream}`.toLowerCase().includes(query))) : snapshot.requests;
		if (url.searchParams.get("format") === "csv") {
			const cell = (value: unknown) => `"${String(value ?? "").replace(/^[=+@-]/, "'$&").replaceAll('"', '""')}"`;
			// Pull one bounded batch at a time. The HTTP stream applies backpressure
			// and cancellation instead of holding several full CSV copies in memory.
			function* csv() {
				yield "\uFEFF" + ["时间", "模型", "原始模型", "工具", "路由", "输入Token含缓存", "输出Token", "缓存Token", "状态", "证据来源", "计数单位"].map(cell).join(",");
				for (let offset = 0; offset < rows.length;) {
					const batch: string[] = [];
					const end = Math.min(offset + 128, rows.length);
					while (offset < end) {
						const r = rows[offset++];
						batch.push([r.at, r.model, r.rawModel, r.client, r.upstream, r.input, r.output, r.cache, r.status, r.evidence.map((e) => e.source).join(" + "), r.scope === "turn" ? "会话请求轮次" : "模型调用 / 响应"].map(cell).join(","));
					}
					yield "\r\n" + batch.join("\r\n");
				}
			}
			return { status: 200, body: Readable.from(csv(), { objectMode: false, highWaterMark: 16 * 1024 }), headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="model-requests.csv"', "Cache-Control": "no-store" } };
		}
		const requested = Number(url.searchParams.get("limit"));
		const pageSize = url.searchParams.has("limit") && Number.isFinite(requested) ? Math.max(0, Math.min(50, Math.floor(requested))) : 50;
		const page = Math.max(0, Math.floor(Number(url.searchParams.get("page")) || 0));
		return jsonResponse({ ...snapshot, requests: rows.slice(page * pageSize, page * pageSize + pageSize), requestCount: rows.length, pending: snapshot.pending.slice(0, 50) }, { headers: { "Cache-Control": "no-store" } });
	} catch {
		return jsonResponse({ error: "统计暂时不可用，请重试" }, { status: 503 });
	}
}
