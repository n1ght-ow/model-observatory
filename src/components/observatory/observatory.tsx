"use client";

import { Fragment, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import Image from "next/image";
import { Activity, ArrowDown, ArrowDownToLine, ArrowUpRight, Check, ChevronDown, ChevronLeft, ChevronRight, CircleHelp, Database, Layers3, LockKeyhole, Moon, Pause, Play, Radio, RefreshCw, Search, Sun, X, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTheme } from "@/components/theme-provider";
import { AliasEditor } from "./alias-editor";
import { modelVendor } from "@/lib/observatory/identity";
import type { ModelSummary, ObservatorySnapshot, ModelEvent } from "@/lib/observatory/types";

type View = "models" | "requests" | "coverage";
const ranges = [{ id: "today", label: "今天" }, { id: "24h", label: "24 小时" }, { id: "7d", label: "7 天" }, { id: "30d", label: "30 天" }, { id: "all", label: "全部" }];
const numberFormat = new Intl.NumberFormat("zh-CN"), compactFormat = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 2 });
const number = (n: number) => numberFormat.format(n);
const compact = (n: number) => compactFormat.format(n);
const tokens = (n: number | null) => n === null ? "—" : compact(n);
// Intl owns native ICU state. Reuse it across rows and five-second refreshes.
const timeOptions: Intl.DateTimeFormatOptions = { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false };
const timeFormat = new Intl.DateTimeFormat("zh-CN", timeOptions);
const dateTimeFormat = new Intl.DateTimeFormat("zh-CN", { ...timeOptions, month: "2-digit", day: "2-digit" });
const axisTimeFormat = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "numeric", day: "numeric", hour: "2-digit", hour12: false });
const clock = (at: string, date = false) => !at ? "时间未记录" : (date ? dateTimeFormat : timeFormat).format(new Date(at));

function Empty({ title, text }: { title: string; text: string }) {
	return <div className="obs-empty"><Radio size={28} strokeWidth={1.2} /><h3>{title}</h3><p>{text}</p></div>;
}

function ModelUsage({ model }: { model: ModelSummary }) {
	const hasUsage = model.inputRequests > 0 || model.outputRequests > 0;
	return <>
		<strong>{hasUsage ? compact(model.input + model.output) : "未记录"}</strong>
		<span className="obs-subtext">{hasUsage ? <>{tokens(model.inputRequests ? model.input : null)} 入 <span className="obs-slash">/</span> {tokens(model.outputRequests ? model.output : null)} 出</> : "用量尚未报告"}</span>
		{hasUsage && model.tokenRequests < model.requests && <span className="obs-subtext">已记录 · {number(model.tokenRequests)}/{number(model.requests)} 条完整用量</span>}
	</>;
}

function ActivityChart({ points, metric }: { points: ObservatorySnapshot["activity"]; metric: "requests" | "tokens" }) {
	const [hover, setHover] = useState<number | null>(null);
	const max = Math.max(1, ...points.map((p) => p[metric]));
	const count = Math.max(1, points.length), step = 850 / count;
	const visible = hover === null ? null : points[hover];
	return <div className="obs-activity">
		<div className="obs-chart-readout">{visible ? <><span>{clock(visible.at, true)}</span><strong>{number(visible[metric])} {metric === "requests" ? "次请求" : "已记录 Token"}</strong></> : <><span>每个刻度是一段真实活动</span><span>{metric === "requests" ? "空白时段表示没有已观测请求" : "仅汇总已记录用量，缺失用量不补零"}</span></>}</div>
		<svg viewBox="0 0 900 190" role="img" aria-label={`活动图，共 ${points.reduce((n, p) => n + p.requests, 0)} 次请求`} onMouseLeave={() => setHover(null)}>
			{[0, 0.5, 1].map((level) => <g key={level}><line x1="40" x2="890" y1={154 - level * 130} y2={154 - level * 130} className="obs-gridline" /><text x="0" y={158 - level * 130} className="obs-axis">{compact(Math.round(max * level))}</text></g>)}
			{points.map((p, i) => <g key={p.at} onMouseEnter={() => setHover(i)}><rect x={40 + i * step} y="15" width={step} height="140" fill="transparent" /><rect x={40 + i * step + Math.min(2, step / 5)} y={154 - p[metric] / max * 130} width={Math.max(1, step - Math.min(5, step / 3))} height={p[metric] / max * 130} rx={Math.min(2, step / 5)} className={cn("obs-chart-bar", hover === i && "is-hovered")} /><title>{clock(p.at, true)}：{number(p[metric])}</title></g>)}
			{points.filter((_, i) => i === 0 || i === Math.floor((count - 1) / 2) || i === count - 1).map((p, i) => <text key={p.at} x={i === 0 ? 40 : i === 1 ? 465 : 890} y="183" textAnchor={i === 0 ? "start" : i === 1 ? "middle" : "end"} className="obs-axis">{axisTimeFormat.format(new Date(p.at))}</text>)}
		</svg>
		{points.length > 0 && <div className="obs-mobile-chart-labels"><span>{clock(points[0].at, true)}</span><span>{clock(points[points.length - 1].at, true)}</span></div>}
	</div>;
}

function ModelDetail({ model, range }: { model: ModelSummary; range: string }) {
	return <div className="obs-model-detail">
		<div><h4>这个模型从哪里来</h4><div className="obs-client-splits">{[...model.clients].sort((a, b) => b.requests - a.requests).map((c) => <div key={c.name}><span>{c.name}</span><div className="obs-mini-track"><i style={{ width: `${c.requests / model.requests * 100}%` }} /></div><strong>{number(c.requests)}</strong></div>)}</div></div>
		<div><h4>归一前的名称</h4><div className="obs-aliases">{model.aliases.map((alias) => <code key={alias}>{alias}</code>)}</div><p>保留具体版本与变体，移除已识别的命名空间。</p>{model.configured > 0 && <p>{number(model.configured)} 条来自会话模型配置，未经响应模型验证。</p>}{model.turnRequests > 0 && <p>{number(model.turnRequests)} 条为会话请求轮次，内部多步调用未计数。</p>}</div>
		<div><h4>上游 / 路由</h4><div className="obs-aliases">{model.upstreams.map((upstream) => <span key={upstream}>{upstream}</span>)}</div><Link className="obs-text-button" href={`/requests?model=${encodeURIComponent(model.model)}&range=${range}`}>查看这个模型的请求 <ArrowUpRight size={14} /></Link></div>
	</div>;
}

function RequestRows({ rows }: { rows: ModelEvent[] }) {
	const [expanded, setExpanded] = useState<string | null>(null);
	return <div className="obs-table-scroll"><table className="obs-table obs-request-table"><thead><tr><th>时间</th><th>模型 / 工具</th><th>输入 / 输出 Token</th><th className="obs-optional">路由</th><th>证据</th><th><span className="sr-only">展开详情</span></th></tr></thead><tbody>{rows.map((row) => <Fragment key={row.id}>
		<tr><td className="obs-time" title={row.timeKnown === false ? "原始记录未提供调用时间" : row.at}>{row.timeKnown === false ? "时间未记录" : clock(row.at, true)}</td><td><strong className="obs-request-model">{row.model}</strong><span className="obs-subtext">{row.client}</span></td><td className="obs-numeric"><strong>{tokens(row.input)} <span className="obs-slash">/</span> {tokens(row.output)}</strong><span className="obs-subtext">{row.cache !== null ? `缓存 ${compact(row.cache)}` : "缓存未记录"}</span></td><td className="obs-optional obs-route">{row.upstream}</td><td><span className={cn("obs-evidence", row.evidence.length > 1 && "obs-evidence-matched")}>{row.evidence.length > 1 ? <Check size={12} /> : <Database size={12} />}{row.evidence.length > 1 ? "已核对" : row.scope === "turn" ? "会话请求" : row.identity === "configured" ? "会话记录" : "原始记录"}</span>{row.status === "error" && <span className="obs-error-tag">失败</span>}</td><td><button className="obs-icon-button" aria-label={`查看请求 ${row.id} 的证据`} aria-expanded={expanded === row.id} onClick={() => setExpanded(expanded === row.id ? null : row.id)}><ChevronDown size={15} /></button></td></tr>
		{expanded === row.id && <tr className="obs-expanded-row"><td colSpan={6}><div className="obs-request-evidence"><div><span>原始模型名称</span><code>{row.rawModel}</code></div><div><span>计数依据</span><p>{row.scope === "turn" && "一次会话请求，非逐步模型调用 · "}{row.evidence.map((e) => e.source).join(" + ")} · {row.identity === "configured" ? "模型来自会话配置" : "模型来自原始记录"}</p></div><div><span>用量与状态</span><p>{row.input === null ? "Token 未报告" : "输入已包含缓存，缓存不重复相加"} · {row.status === "unknown" ? "HTTP 状态未记录" : row.status === "error" ? "失败 / 取消" : "成功"}{row.duration !== null ? ` · ${(row.duration / 1000).toFixed(2)} 秒` : ""}</p></div><code className="obs-event-id">事件 {row.id}</code></div></td></tr>}
	</Fragment>)}</tbody></table>{!rows.length && <Empty title="这个范围还没有请求" text="换一个时间范围，或清除筛选。新请求被本机记录后会自动出现。" />}</div>;
}

function CoverageView({ snapshot, onRulesChanged }: { snapshot: ObservatorySnapshot; onRulesChanged: () => void }) {
	const rules = [
		["统计单位", "原始用量按模型调用 / 响应计数。Cursor 本地只提供会话请求轮次，单独标明，不能代表全部底层调用。独立重试分别计数；未留证据的请求不推算。"],
		["模型归一", "移除已识别的供应商与路由前缀，保留版本、日期、fast、vision 等变体。不同版本不合成家族；上游若隐藏真实模型，保留日志报告名称。"],
		["Token 口径", "输入 = 非缓存输入 + 缓存读取 + 缓存写入。来源已含缓存则不再累加。总量只加输入与输出；推理 Token 是输出的子集。缺失值保持未知。"],
		["证据与去重", "同一来源的稳定请求 ID 只计一次。会话与路由仅在模型、输入、输出和时间同时匹配且候选唯一时合并。同一来源的独立请求不靠时间桶合并。"],
		["统一接入", "POST /api/observatory/events 接收模型、时间、工具和 usage。稳定 id 支持重传。可用 ~/.model-observatory/aliases.json 明确配置已确认的模型别名。"],
		["已知边界", "无法凭空读取封闭客户端的加密流量。本页不是全机网络拦截器。CC Switch 导入账本不参与最终计数；费用与套餐额度不混入请求数量。"],
	];
	const priority = { error: 0, unsupported: 1, empty: 2, connected: 3 };
	const sources = [...snapshot.coverage].sort((a, b) => priority[a.state] - priority[b.state]);
	const connected = sources.filter((source) => source.state === "connected").length;
	return <>
		<section className="obs-coverage-intro" aria-label="历史累计核对">
			<p>当前接入状态 · 历史累计记录</p>
			<div className="obs-reconcile-stats">{[[snapshot.reconciliation.observations, "原始观测"], [snapshot.reconciliation.merged, "已合并重复证据"], [snapshot.reconciliation.pending, "待核对 · 暂不计入"]].map(([count, label]) => <div key={label}><strong>{number(Number(count))}</strong><span>{label}</span></div>)}</div>
		</section>
		{snapshot.pending.length > 0 && <section className="obs-pending"><div className="obs-section-heading"><h2>待核对的路由证据</h2><span>存在多个匹配候选，暂不重复加总</span></div><RequestRows rows={snapshot.pending} /></section>}
		<div className="obs-section-heading"><h2>采集覆盖</h2><span>{connected} 个来源已接入</span></div>
		<div className="obs-coverage-list">{sources.map((source) => <article key={source.id}>
			<span className={cn("obs-source-state", `obs-source-${source.state}`)}>{source.state === "connected" ? <Check size={17} /> : source.state === "unsupported" ? <CircleHelp size={17} /> : <Database size={17} />}</span>
			<div><h3>{source.name}<span className={cn("obs-state-label", `obs-state-${source.state}`)}>{({ connected: "已接入", empty: "暂无记录", error: "读取异常", unsupported: "待接入" })[source.state]}</span></h3><p>{source.description}</p></div>
			<div className="obs-source-count"><strong>{number(source.count)}</strong><span>条原始记录</span></div>
		</article>)}</div>
		<AliasEditor aliases={snapshot.aliases} names={[...new Set(snapshot.models.flatMap((model) => model.aliases))]} onSaved={onRulesChanged} />
		<section className="obs-method"><h2>数字怎样算</h2><div>{rules.map(([title, description]) => <details key={title}><summary>{title}</summary><p>{description}</p>{title === "统一接入" && <code>{'{ "id": "request-123", "at": "ISO 时间", "model": "模型名称", "client": "工具名称", "input": 120, "output": 40 }'}</code>}</details>)}</div></section>
	</>;
}

// Session preferences survive route changes without changing server-rendered markup.
const preferenceListeners = new Set<() => void>();
const preferenceFallback = new Map<string, string>();
function subscribePreferences(listener: () => void) {
	preferenceListeners.add(listener);
	window.addEventListener("storage", listener);
	return () => { preferenceListeners.delete(listener); window.removeEventListener("storage", listener); };
}
function useSessionPreference(key: string, fallback: string) {
	const value = useSyncExternalStore(subscribePreferences, () => {
		try { return sessionStorage.getItem(key) ?? preferenceFallback.get(key) ?? fallback; }
		catch { return preferenceFallback.get(key) ?? fallback; }
	}, () => fallback);
	function update(next: string) {
		preferenceFallback.set(key, next);
		try { sessionStorage.setItem(key, next); } catch { /* Keep this window usable without storage. */ }
		for (const listener of preferenceListeners) listener();
	}
	return [value, update] as const;
}

export function Observatory({ view = "models", initialModel = "", initialRange = "", initialClient = "" }: { view?: View; initialModel?: string; initialRange?: string; initialClient?: string }) {
	const [savedRange, saveRange] = useSessionPreference("observatory-range", "today");
	const [pausedPreference, savePaused] = useSessionPreference("observatory-refresh-paused", "false");
	const preferencesReady = useSyncExternalStore(subscribePreferences, () => true, () => false);
	const range = ranges.some((r) => r.id === initialRange) ? initialRange : ranges.some((r) => r.id === savedRange) ? savedRange : "today";
	const paused = pausedPreference === "true";
	const [snapshot, setSnapshot] = useState<ObservatorySnapshot | null>(null);
	const [error, setError] = useState(""), [busy, setBusy] = useState(true), [refresh, setRefresh] = useState(0);
	const [resuming, setResuming] = useState(false);
	const [query, setQuery] = useState(""), [modelFilter, setModelFilter] = useState(initialModel), [clientFilter, setClientFilter] = useState(initialClient), [page, setPage] = useState(0), [expanded, setExpanded] = useState<string | null>(null);
	const [sort, setSort] = useState<"requests" | "tokens" | "latest">("requests"), [chartMetric, setChartMetric] = useState<"requests" | "tokens">("requests");
	const { theme, toggleTheme } = useTheme();
	const params = useMemo(() => new URLSearchParams({ range: view === "coverage" ? "all" : range, ...(view === "requests" ? { query, model: modelFilter, client: clientFilter, page: String(page) } : { limit: "0" }) }).toString(), [range, query, modelFilter, clientFilter, page, view]);
	useEffect(() => {
		if (!preferencesReady) return;
		let controller: AbortController | undefined;
		let timer: ReturnType<typeof setTimeout>, active = true, loading = false;
		const desktop = window.desktopWindow;
		let desktopVisible = true, visibilityKnown = !desktop, visibilityEvents = 0;
		const visible = () => visibilityKnown && (desktop ? desktopVisible : !document.hidden);
		async function load() {
			if (!active || loading || !visible()) return;
			loading = true; const request = new AbortController(); controller = request;
			setBusy(true);
			try {
				const response = await fetch(`/api/observatory?${params}`, { signal: request.signal, cache: "no-store" });
				if (!response.ok) throw new Error("读取失败");
				const data = await response.json() as ObservatorySnapshot;
				if (active) {
					if (view !== "coverage") {
						try { sessionStorage.setItem("observatory-range", range); } catch { /* The URL still retains the range. */ }
					}
					setSnapshot((previous) => {
						if (!previous || previous.generatedAt !== data.generatedAt || previous.range !== data.range || previous.requestCount !== data.requestCount || previous.requests.length !== data.requests.length || previous.requests[0]?.id !== data.requests[0]?.id || previous.requests.at(-1)?.id !== data.requests.at(-1)?.id || previous.totals.requests !== data.totals.requests || previous.totals.input !== data.totals.input || previous.totals.output !== data.totals.output || previous.totals.cache !== data.totals.cache || previous.models.length !== data.models.length || previous.models[0]?.model !== data.models[0]?.model || previous.activity.length !== data.activity.length) return data;
						if (previous.collection?.collectedAt === data.collection?.collectedAt && previous.collection?.collecting === data.collection?.collecting && previous.collection?.paused === data.collection?.paused && previous.collection?.error === data.collection?.error && previous.collection?.observations === data.collection?.observations) return previous;
						return { ...previous, collection: data.collection };
					});
					setError(data.collection?.error ?? "");
				}
			} catch { if (active && !request.signal.aborted) setError("暂时无法刷新。保留上次读数，请重试。"); }
			finally { loading = false; if (active) { setBusy(false); if (!paused && visible()) timer = setTimeout(load, 5000); } }
		}
		function visibilityChanged() {
			clearTimeout(timer);
			if (!visible()) controller?.abort();
			else if (!paused) void load();
		}
		document.addEventListener("visibilitychange", visibilityChanged);
		const unsubscribe = desktop?.onVisibilityChange((value) => { visibilityEvents++; desktopVisible = value; visibilityKnown = true; visibilityChanged(); });
		if (desktop) void desktop.isVisible().then((value) => { if (!visibilityEvents) desktopVisible = value; visibilityKnown = true; void load(); }, () => { visibilityKnown = true; void load(); });
		else void load();
		return () => { active = false; controller?.abort(); clearTimeout(timer); unsubscribe?.(); document.removeEventListener("visibilitychange", visibilityChanged); };
	}, [params, paused, refresh, preferencesReady, range, view]);
	const modelRows = useMemo(() => (snapshot?.models ?? []).filter((r) => `${r.model} ${r.clients.map((c) => c.name).join(" ")} ${r.aliases.join(" ")}`.toLowerCase().includes(query.toLowerCase())).sort((a, b) => sort === "requests" ? b.requests - a.requests : sort === "tokens" ? (b.input + b.output) - (a.input + a.output) : b.latest.localeCompare(a.latest)), [snapshot, query, sort]);
	const allClients = useMemo(() => { const result = new Map<string, number>(); for (const m of snapshot?.models ?? []) for (const c of m.clients) result.set(c.name, (result.get(c.name) ?? 0) + c.requests); return [...result].sort((a, b) => b[1] - a[1]); }, [snapshot]);
	const total = snapshot?.totals;
	const collectionPaused = snapshot?.collection?.paused ?? false;
	const titles = { models: "模型总览", requests: "请求流水", coverage: "接入与口径" };
	async function resumeCollection() {
		setResuming(true);
		try {
			const response = await fetch("/api/observatory/collection", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ paused: false }) });
			if (!response.ok) throw new Error();
			const collection = await response.json();
			if (collection.paused !== false) throw new Error();
			setSnapshot((previous) => previous ? { ...previous, collection } : previous);
			setError("");
			setRefresh((n) => n + 1);
		} catch { setError("恢复采集失败。请重试，已保存的历史不受影响。"); }
		finally { setResuming(false); }
	}
	function chooseRange(value: string) {
		saveRange(value); setPage(0);
		// Keep reloads and copied links consistent with the visible range.
		const url = new URL(window.location.href);
		url.searchParams.set("range", value);
		window.history.replaceState(null, "", url);
	}
	const overviewHref = `/?range=${range}`, requestsHref = `/requests?range=${range}`;
	const rangeDescription = error && snapshot?.range !== range ? "所选范围读取失败 · 保留上次结果" : busy || snapshot?.range !== range ? "正在加载所选范围…" : snapshot?.since ? `北京时间 · ${clock(snapshot.since, true)} 起` : "全部历史 · 包含时间未记录的请求";
	return <div className="observatory">
		<aside className="obs-sidebar">
			<Link href={overviewHref} className="obs-brand" aria-label="Model Observatory 首页"><span className="obs-brand-icon"><Image src="/app.ico?v=silver-orbit-1" width={39} height={39} alt="" unoptimized /></span><span>Model<span>Observatory</span></span></Link>
			<nav aria-label="主导航">{([
				{ id: "models", href: overviewHref, icon: Layers3, label: "模型总览" },
				{ id: "requests", href: requestsHref, icon: Activity, label: "请求流水" },
				{ id: "coverage", href: "/tools", icon: Radio, label: "接入与口径" },
			] as const).map((item) => <Link key={item.id} href={item.href} className={cn("obs-nav-link", view === item.id && "is-active")} aria-current={view === item.id ? "page" : undefined}><item.icon size={17} />{item.label}</Link>)}</nav>
			<div className="obs-sidebar-bottom"><button onClick={toggleTheme} className="obs-theme-button">{theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}{theme === "dark" ? "切换浅色" : "切换深色"}</button><span className="obs-version"><LockKeyhole size={13} aria-hidden="true" /><span>本地运行<span>数据留在本机</span></span></span></div>
		</aside>
		<div className="obs-main-wrap">
		<header className="obs-topbar" aria-label="采集与刷新状态">
			<span className={cn("obs-live-status", (paused || collectionPaused || error) && "is-paused")}><i />{error ? "连接中断" : collectionPaused ? "采集已暂停" : snapshot?.collection?.collecting ? "正在补读" : "采集中"}</span>
			<div className="obs-refresh-controls"><span>{busy ? "更新中…" : snapshot ? `${clock(snapshot.collection?.collectedAt ?? snapshot.generatedAt)} 更新` : "等待连接"}{paused && " · 刷新已暂停"}</span><button className="obs-icon-button" aria-label={paused ? "恢复实时刷新" : "暂停实时刷新"} onClick={() => savePaused(String(!paused))}>{paused ? <Play size={14} /> : <Pause size={14} />}</button><button className="obs-icon-button" aria-label="立即刷新" disabled={busy} onClick={() => setRefresh((n) => n + 1)}><RefreshCw size={14} className={cn(busy && "obs-spinning")} /></button><button className="obs-icon-button obs-mobile-theme" onClick={toggleTheme} aria-label="切换主题">{theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}</button></div>
		</header>
		<main className="obs-main" aria-busy={busy}>
		<div className="obs-page-heading"><h1>{titles[view]}</h1>{view === "requests" && <a className="obs-button" href={`/api/observatory?${params}&format=csv`} download><ArrowDownToLine size={15} />导出筛选结果</a>}</div>
		{view !== "coverage" && <div className="obs-toolbar"><div className="obs-range-group" aria-label="时间范围">{ranges.map((r) => <button key={r.id} aria-pressed={range === r.id} className={cn(range === r.id && "is-active")} onClick={() => chooseRange(r.id)}>{r.label}</button>)}</div><span className="obs-range-description">{rangeDescription}</span></div>}

		{snapshot?.collection?.paused && <div className="obs-error-banner" role="status"><span>采集已暂停，历史已保留。恢复后补读暂停期间的原始记录。</span><button disabled={resuming} onClick={resumeCollection}>{resuming ? "补读中…" : "恢复采集"}<Play size={13} /></button></div>}
		{error && <div className="obs-error-banner" role="alert">{error}<button onClick={() => setRefresh((n) => n + 1)}>重试 <RefreshCw size={13} /></button></div>}
		{!snapshot ? <div className="obs-loading" role="status"><Radio size={30} /><h2>{error ? "等待本地采集恢复" : "正在读取本机模型记录"}</h2><p>首次读取需要扫描原始日志。只提取模型与用量，不提取对话内容。</p><div className="obs-loading-lines"><i /><i /><i /></div></div> : view === "coverage" ? <CoverageView snapshot={snapshot} onRulesChanged={() => setRefresh((n) => n + 1)} /> : <>
		{view === "models" && <section className="obs-stat-strip" aria-label="模型统计"><div><span><Activity size={14} aria-hidden="true" />已观测请求</span><strong data-testid="request-total">{number(total!.requests)}<small>次</small></strong>{total!.turnRequests > 0 && <p>含 {number(total!.turnRequests)} 轮会话请求，非底层调用总数</p>}</div><div><span><Zap size={14} aria-hidden="true" />已记录 Token</span><strong>{total!.inputRequests || total!.outputRequests ? compact(total!.input + total!.output) : "未记录"}</strong><p>输入 {tokens(total!.inputRequests ? total!.input : null)} <span>/</span> 输出 {tokens(total!.outputRequests ? total!.output : null)}</p>{total!.tokenRequests < total!.requests && <p>{number(total!.tokenRequests)}/{number(total!.requests)} 条完整用量</p>}</div><div><span><Layers3 size={14} aria-hidden="true" />已记录缓存读取</span><strong>{total!.cacheRequests ? compact(total!.cache) : "未记录"}</strong><p>已包含在输入中，不重复相加</p>{total!.cacheRequests < total!.requests && <p>{number(total!.cacheRequests)}/{number(total!.requests)} 条报告缓存</p>}</div></section>}

		<div className="obs-ledger-heading"><div><h2>{view === "models" ? "模型账本" : modelFilter || clientFilter || query ? "筛选结果" : "请求记录"}</h2><span>{number(view === "models" ? modelRows.length : snapshot.requestCount)} {view === "models" ? "个模型" : "条记录"}</span></div><label className="obs-search"><Search size={15} /><input aria-label={view === "models" ? "搜索模型或工具" : "搜索请求"} placeholder={view === "models" ? "搜索模型、工具…" : "搜索模型、工具、路由…"} value={query} onChange={(e) => { setQuery(e.target.value); setPage(0); }} />{query && <button aria-label="清除搜索" onClick={() => setQuery("")}><X size={13} /></button>}</label></div>
		{view === "models" ? <><div className="obs-table-scroll"><table className="obs-table obs-model-table"><thead><tr><th>模型</th><th><button className={cn(sort === "requests" && "is-sorted")} onClick={() => setSort("requests")}>请求数 <ArrowDown size={12} /></button></th><th><button className={cn(sort === "tokens" && "is-sorted")} onClick={() => setSort("tokens")}>Token <ArrowDown size={12} /></button></th><th className="obs-optional">来自工具</th><th className="obs-optional"><button className={cn(sort === "latest" && "is-sorted")} onClick={() => setSort("latest")}>最近调用 <ArrowDown size={12} /></button></th><th><span className="sr-only">展开模型</span></th></tr></thead><tbody>{modelRows.map((model) => <Fragment key={model.model}><tr className={cn(expanded === model.model && "obs-row-selected")}><td><button className="obs-model-name" aria-expanded={expanded === model.model} onClick={() => setExpanded(expanded === model.model ? null : model.model)}><span className="obs-model-mark">{modelVendor(model.model).slice(0, 1)}</span><span><strong>{model.model}</strong><span>{modelVendor(model.model)}</span>{model.configured > 0 && <span className="obs-identity-label">{model.configured === model.requests ? "配置模型" : "含配置模型"}</span>}</span></button></td><td className="obs-numeric"><strong>{number(model.requests)}</strong><div className="obs-usage-track"><i style={{ width: `${model.requests / Math.max(1, total!.requests) * 100}%` }} /></div></td><td className="obs-numeric"><ModelUsage model={model} /></td><td className="obs-optional"><div className="obs-client-badges">{model.clients.slice(0, 2).map((client) => <span key={client.name}>{client.name}</span>)}{model.clients.length > 2 && <span>+{model.clients.length - 2}</span>}</div></td><td className="obs-optional obs-time">{clock(model.latest)}</td><td><button className="obs-icon-button" aria-label={`展开 ${model.model}`} aria-expanded={expanded === model.model} onClick={() => setExpanded(expanded === model.model ? null : model.model)}><ChevronDown size={15} className={cn(expanded === model.model && "obs-rotated")} /></button></td></tr>{expanded === model.model && <tr className="obs-expanded-row"><td colSpan={6}><ModelDetail model={model} range={range} /></td></tr>}</Fragment>)}</tbody></table>{!modelRows.length && <Empty title={query ? "没有匹配的模型" : "还没有模型活动"} text={query ? "试试模型名称的一部分，或搜索工具名称。" : "选择更长的时间范围，或检查数据接入。"} />}</div><section className="obs-chart-section obs-activity-section"><div className="obs-section-heading"><h2>调用活动</h2><div className="obs-small-toggle"><button className={cn(chartMetric === "requests" && "is-active")} onClick={() => setChartMetric("requests")}>请求</button><button className={cn(chartMetric === "tokens" && "is-active")} onClick={() => setChartMetric("tokens")}>Token</button></div></div><ActivityChart points={snapshot.activity} metric={chartMetric} /></section></> : <><div className="obs-request-filters"><label>模型<select aria-label="按模型筛选" value={modelFilter} onChange={(e) => { setModelFilter(e.target.value); setPage(0); }}><option value="">全部模型</option>{snapshot.models.map((r) => <option key={r.model}>{r.model}</option>)}</select></label><label>工具<select aria-label="按工具筛选" value={clientFilter} onChange={(e) => { setClientFilter(e.target.value); setPage(0); }}><option value="">全部工具</option>{allClients.map(([name]) => <option key={name}>{name}</option>)}</select></label>{(modelFilter || clientFilter || query) && <button className="obs-text-button" onClick={() => { setModelFilter(""); setClientFilter(""); setQuery(""); setPage(0); }}>清除筛选 <X size={13} /></button>}</div><RequestRows rows={snapshot.requests} /><div className="obs-pagination"><span>{snapshot.requestCount ? `${number(page * 50 + 1)}–${number(Math.min((page + 1) * 50, snapshot.requestCount))}` : "0"} / {number(snapshot.requestCount)} 条</span><div><button className="obs-button" disabled={page === 0} onClick={() => setPage(page - 1)}><ChevronLeft size={14} />上一页</button><button className="obs-button" disabled={(page + 1) * 50 >= snapshot.requestCount} onClick={() => setPage(page + 1)}>下一页<ChevronRight size={14} /></button></div></div></>}
		</>}
		</main></div>
	</div>;
}
