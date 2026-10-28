import { jsonResponse, type ApiRequest } from "./message";
import { Readable } from "node:stream";
import { getSnapshot } from "../lib/observatory/store";
import { validCustomDates } from "../lib/observatory/time-range";
import { eventAttribution, makeAttributionSelection, matchesAttribution } from "../lib/observatory/attribution";
import { eventCost } from "../lib/observatory/pricing";
import type { AttributionFilter, AttributionOverview, UnknownAttributionFilter, ModelEvent, ObservatorySnapshot } from "../lib/observatory/types";

type AttributionView = "summary" | "projects" | "sessions" | "project" | "session" | "unknown" | "full";

function attributionView(snapshot: ObservatorySnapshot["attribution"], view: AttributionView, selection?: ReturnType<typeof makeAttributionSelection>): AttributionOverview {
	if (view === "full") return snapshot;
	if (view === "project" || view === "session" || view === "unknown") {
		return {
			projects: view === "project" ? selection?.projects ?? [] : [],
			sessions: view === "session" ? selection?.sessions ?? [] : view === "project" ? selection?.sessions ?? [] : [],
			unknownProjects: selection?.unknownProjects ?? snapshot.unknownProjects,
			unknownSessions: selection?.unknownSessions ?? snapshot.unknownSessions,
			coverage: snapshot.coverage,
		};
	}
	return {
		projects: view === "projects" ? snapshot.projects : [],
		sessions: view === "sessions" ? snapshot.sessions : [],
		unknownProjects: view === "projects" || view === "summary" ? snapshot.unknownProjects : [],
		unknownSessions: view === "sessions" || view === "summary" ? snapshot.unknownSessions : [],
		coverage: snapshot.coverage,
	};
}

function exposedRows(rows: ModelEvent[]) {
	return rows.map((row) => ({ ...row, cost: eventCost(row), ...(row.attribution ? {} : { attribution: eventAttribution(row) }) }));
}

export async function GET(request: ApiRequest) {
	const url = new URL(request.url);
	const range = url.searchParams.get("range") ?? "today";
	if (!["today", "week", "month", "custom", "24h", "7d", "30d", "all"].includes(range)) return jsonResponse({ error: "无效时间范围" }, { status: 400 });
	const dates = range === "custom" ? { from: url.searchParams.get("from") ?? "", to: url.searchParams.get("to") ?? "" } : undefined;
	if (dates && !validCustomDates(dates)) return jsonResponse({ error: "请选择有效的起止日期，开始日期不能晚于结束日期" }, { status: 400 });
	const requestedView = url.searchParams.get("view");
	const project = url.searchParams.get("project") ?? undefined;
	const session = url.searchParams.get("session") ?? undefined;
	const unknown = url.searchParams.get("unknown") ?? undefined;
	const isCsv = url.searchParams.get("format") === "csv";
	if (requestedView && !["summary", "projects", "sessions", "project", "session", "unknown", "full"].includes(requestedView)) return jsonResponse({ error: "无效归属视图" }, { status: 400 });
	if (unknown && !["project", "session", "both"].includes(unknown)) return jsonResponse({ error: "无效未知归属筛选" }, { status: 400 });
	try {
		const snapshot = await getSnapshot(range, dates);
		const query = (url.searchParams.get("query") ?? "").toLowerCase().slice(0, 200);
		const model = url.searchParams.get("model");
		const client = url.searchParams.get("client");
		const attributionFilter: AttributionFilter = {
			...(project ? { project } : {}),
			...(session ? { session } : {}),
			...(unknown ? { unknown: unknown as UnknownAttributionFilter } : {}),
		};
		const rows = model || client || query || project || session || unknown ? snapshot.requests.filter((r) => {
			if ((model && r.model !== model) || (client && r.client !== client) || !matchesAttribution(r, attributionFilter)) return false;
			if (!query) return true;
			const attribution = eventAttribution(r), projectValue = attribution.project, sessionValue = attribution.session;
			return `${r.model} ${r.rawModel} ${r.client} ${r.upstream} ${projectValue.label ?? ""} ${projectValue.id ?? ""} ${projectValue.path ?? ""} ${sessionValue.label ?? ""} ${sessionValue.id ?? ""}`.toLowerCase().includes(query);
		}) : snapshot.requests;
		const view = (requestedView ?? (project ? "project" : session ? "session" : unknown ? "unknown" : "summary")) as AttributionView;
		const needsSelection = !isCsv && Boolean(project || session || unknown || view === "project" || view === "session" || view === "unknown");
		const selection = needsSelection ? makeAttributionSelection(rows, attributionFilter) : undefined;
		if (isCsv) {
			const cell = (value: unknown) => `"${String(value ?? "").replace(/^[=+@-]/, "'$&").replaceAll('"', '""')}"`;
			// Pull one bounded batch at a time. The HTTP stream applies backpressure
			// and cancellation instead of holding several full CSV copies in memory.
			function* csv() {
				yield "\uFEFF" + ["时间", "模型", "原始模型", "工具", "路由", "输入Token含缓存", "输出Token", "缓存Token", "估算花费USD", "计价状态", "状态", "证据来源", "计数单位", "项目归属状态", "项目归属", "项目稳定标识", "项目原始ID", "项目工作目录", "会话归属状态", "会话归属", "会话稳定标识", "会话原始ID", "父会话稳定标识"].map(cell).join(",");
				for (let offset = 0; offset < rows.length;) {
					const batch: string[] = [];
					const end = Math.min(offset + 128, rows.length);
					while (offset < end) {
						const r = rows[offset++];
						const attribution = eventAttribution(r), projectValue = attribution.project, sessionValue = attribution.session, cost = eventCost(r);
						batch.push([r.at, r.model, r.rawModel, r.client, r.upstream, r.input, r.output, r.cache, cost === null ? "" : cost.toFixed(6), cost === null ? "未计价" : "已计价", r.status, r.evidence.map((e) => e.source).join(" + "), r.scope === "turn" ? "会话请求轮次" : "模型调用 / 响应",
							projectValue.status, projectValue.label, projectValue.key, projectValue.id, projectValue.path,
							sessionValue.status, sessionValue.label, sessionValue.key, sessionValue.id, attribution.parentSession?.key].map(cell).join(","));
					}
					yield "\r\n" + batch.join("\r\n");
				}
			}
			return { status: 200, body: Readable.from(csv(), { objectMode: false, highWaterMark: 16 * 1024 }), headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="model-requests.csv"', "Cache-Control": "no-store" } };
		}
		const requested = Number(url.searchParams.get("limit"));
		const pageSize = url.searchParams.has("limit") && Number.isFinite(requested) ? Math.max(0, Math.min(50, Math.floor(requested))) : 50;
		const page = Math.max(0, Math.floor(Number(url.searchParams.get("page")) || 0));
		return jsonResponse({
			...snapshot,
			attribution: attributionView(snapshot.attribution, view, selection),
			...(selection ? { selection } : {}),
			requests: exposedRows(rows.slice(page * pageSize, page * pageSize + pageSize)),
			requestCount: rows.length,
			pending: snapshot.pending.slice(0, 50),
		}, { headers: { "Cache-Control": "no-store" } });
	} catch {
		return jsonResponse({ error: "统计暂时不可用，请重试" }, { status: 503 });
	}
}
