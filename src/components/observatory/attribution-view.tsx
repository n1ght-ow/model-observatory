import Link from "next/link";
import { ArrowUpRight, ChevronDown, CircleDollarSign, CircleHelp, Database, Folder, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatCost } from "@/lib/observatory/pricing";
import type {
	AttributionModelSummary,
	AttributionTotals,
	AttributionValue,
	ObservatorySnapshot,
	ProjectAttributionSummary,
	SessionAttributionSummary,
	UnknownAttributionSummary,
} from "@/lib/observatory/types";

export type AttributionSort = "requests" | "tokens" | "cost";

type AttributionViewProps = {
	view: "projects" | "sessions";
	snapshot: ObservatorySnapshot;
	rangeParams: string;
	sort: AttributionSort;
	selectedKey: string;
	contextKey: string;
	busy: boolean;
	error: string;
	rangeMatches: boolean;
	onSort: (sort: AttributionSort) => void;
	onSelect: (key: string) => void;
	onClearSelection: () => void;
	onRetry: () => void;
};

const numberFormat = new Intl.NumberFormat("zh-CN");
const compactFormat = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 2 });
const number = (value: number) => numberFormat.format(value);
const compact = (value: number) => compactFormat.format(value);
const tokens = (value: number | null) => value === null ? "—" : compact(value);
const timeFormat = new Intl.DateTimeFormat("zh-CN", {
	timeZone: "Asia/Shanghai",
	month: "2-digit",
	day: "2-digit",
	hour: "2-digit",
	minute: "2-digit",
	second: "2-digit",
	hour12: false,
});
const clock = (value: string | null) => value ? timeFormat.format(new Date(value)) : "时间未记录";
const recordedTokens = (totals: AttributionTotals) => totals.input + totals.output;

function TokenReadout({ totals }: { totals: AttributionTotals }) {
	const hasUsage = totals.inputRequests > 0 || totals.outputRequests > 0;
	return <>
		<strong>{hasUsage ? compact(recordedTokens(totals)) : "未记录"}</strong>
		<span className="obs-subtext">{hasUsage ? <>{tokens(totals.inputRequests ? totals.input : null)} 入 <span className="obs-slash">/</span> {tokens(totals.outputRequests ? totals.output : null)} 出</> : "用量尚未报告"}</span>
		{hasUsage && totals.tokenRequests < totals.requests && <span className="obs-subtext">已记录 · {number(totals.tokenRequests)}/{number(totals.requests)} 条完整用量</span>}
	</>;
}

function CostReadout({ totals }: { totals: AttributionTotals }) {
	if (!totals.costRequests) return <><strong>未计价</strong><span className="obs-subtext">价目未收录或用量不完整</span></>;
	return <>
		<strong>{formatCost(totals.cost)}</strong>
		<span className="obs-subtext">{number(totals.costRequests)}/{number(totals.requests)} 条已计价</span>
	</>;
}

function ModelLedger({
	models,
	title,
	rangeParams,
	project,
	session,
}: {
	models: AttributionModelSummary[];
	title: string;
	rangeParams: string;
	project?: string;
	session?: string;
}) {
	return <section className="obs-attribution-section">
		<div className="obs-section-heading"><h2>{title}</h2><span>{number(models.length)} 个最终模型</span></div>
		{models.length ? <div className="obs-table-scroll"><table className="obs-table obs-attribution-model-table">
			<thead><tr><th>最终模型</th><th>请求数</th><th>已记录 Token</th><th>花费</th><th><span className="sr-only">查看请求</span></th></tr></thead>
			<tbody>{models.map((model) => <tr key={model.model}>
				<td><strong className="obs-attribution-model">{model.model}</strong></td>
				<td className="obs-numeric"><strong>{number(model.requests)}</strong>{model.turnRequests > 0 && <span className="obs-subtext">含 {number(model.turnRequests)} 轮会话请求</span>}</td>
				<td className="obs-numeric"><TokenReadout totals={model} /></td>
				<td className="obs-numeric"><CostReadout totals={model} /></td>
				<td><Link className="obs-text-button" aria-label={`查看 ${model.model} 在当前归属中的请求`} href={`/requests?${rangeParams}${project ? `&project=${encodeURIComponent(project)}` : ""}${session ? `&session=${encodeURIComponent(session)}` : ""}&model=${encodeURIComponent(model.model)}`}>查看 <ArrowUpRight size={13} /></Link></td>
			</tr>)}</tbody>
		</table></div> : <p className="obs-attribution-empty-line">当前范围内没有模型请求。</p>}
		<p className="obs-attribution-model-note">按现有模型归一结果统计；部分来源模型来自会话配置，未经响应模型验证。</p>
	</section>;
}

function AttributionState({ value }: { value: AttributionValue }) {
	if (value.status === "known") {
		return <><strong>{value.label ?? "已识别"}</strong><span className="obs-subtext">{value.source ?? "来源未记录"}</span></>;
	}
	const reason = value.reason === "legacy"
		? "历史记录未包含归属元数据"
		: value.reason === "source-unsupported"
			? "来源不提供该归属"
			: value.reason === "invalid-path"
				? "项目路径无效"
				: value.status === "conflict"
					? "存在冲突的归属证据"
					: value.status === "invalid"
						? "原始归属数据无效"
						: "原始记录未提供";
	return <><strong>{value.label ?? "未知归属"}</strong><span className="obs-subtext">{reason}</span></>;
}

function AttributionCandidates({ value }: { value: AttributionValue }) {
	if (!value.candidates.length) return null;
	return <div className="obs-attribution-candidates">
		{value.candidates.map((candidate) => <div key={`${candidate.source}:${candidate.key ?? candidate.label}:${candidate.path ?? candidate.id ?? ""}`}>
			<code>{candidate.path ?? candidate.id ?? candidate.label}</code>
			<span>{candidate.source}{candidate.client ? ` · ${candidate.client}` : ""}</span>
		</div>)}
	</div>;
}

export function RequestAttribution({ value }: { value: AttributionValue }) {
	return <div className="obs-request-attribution">
		<AttributionState value={value} />
		{value.status === "known" && !value.candidates.length && (value.path || value.id || value.key) && <code>{value.path ?? value.id ?? value.key}</code>}
		<AttributionCandidates value={value} />
	</div>;
}

function ProjectSummary({ totals }: { totals: AttributionTotals }) {
	return <>
		<div><span>当前范围请求</span><strong data-testid="attribution-detail-requests">{number(totals.requests)}<small>次</small></strong>{totals.turnRequests > 0 && <p>含 {number(totals.turnRequests)} 轮会话请求</p>}</div>
		<div><span>已记录 Token</span><strong data-testid="attribution-detail-tokens">{totals.inputRequests || totals.outputRequests ? compact(recordedTokens(totals)) : "未记录"}</strong><p data-testid="attribution-detail-coverage">{number(totals.tokenRequests)}/{number(totals.requests)} 条完整用量</p></div>
		<div><span>缓存读取</span><strong>{totals.cacheRequests ? compact(totals.cache) : "未记录"}</strong><p>{number(totals.cacheRequests)}/{number(totals.requests)} 条报告缓存</p></div>
		<div><span>估算花费</span><strong data-testid="attribution-detail-cost">{totals.costRequests ? formatCost(totals.cost) : "未计价"}</strong><p data-testid="attribution-detail-cost-coverage">{number(totals.costRequests)}/{number(totals.requests)} 条已计价</p></div>
	</>;
}

function ProjectDetail({
	project,
	totals,
	rangeParams,
	sessionFilter,
	onClear,
}: {
	project: ProjectAttributionSummary;
	totals: AttributionTotals;
	rangeParams: string;
	sessionFilter: string;
	onClear: () => void;
}) {
	const models = project.models;
	const sessions = project.sessions;
	const requestParams = new URLSearchParams(rangeParams);
	requestParams.set("project", project.key);
	if (sessionFilter) requestParams.set("session", sessionFilter);
	return <section className="obs-attribution-detail" aria-labelledby="project-detail-title">
		<div className="obs-attribution-detail-head">
			<div><h2 id="project-detail-title"><Folder size={17} />{project.label}</h2><p>{project.source}{project.path ? ` · ${project.path}` : project.id ? ` · ${project.id}` : ""}</p></div>
			<div className="obs-attribution-detail-actions"><Link className="obs-button" href={`/requests?${requestParams}`}>查看此项目请求 <ArrowUpRight size={14} /></Link><button className="obs-button" onClick={onClear}>返回项目列表</button></div>
		</div>
		<p className="obs-attribution-scope"><Database size={13} />统计范围为当前时间范围 + 当前项目{sessionFilter ? " + 当前会话" : ""}；跨出范围的请求不会在本详情中补齐；关联会话也沿用这些条件。</p>
		<section className="obs-stat-strip obs-attribution-stat-strip" aria-label="项目统计"><ProjectSummary totals={totals} /></section>
		<div className="obs-attribution-detail-grid">
			<ModelLedger models={models} title="这个项目的最终模型" rangeParams={rangeParams} project={project.key} session={sessionFilter || undefined} />
			<section className="obs-attribution-section">
				<div className="obs-section-heading"><h2>关联会话</h2><span>{number(sessions.length)} 个已知会话</span></div>
				{sessions.length ? <div className="obs-attribution-links">{sessions.map((session) => <Link key={session.key} href={`/sessions?${rangeParams}&project=${encodeURIComponent(project.key)}&session=${encodeURIComponent(session.key)}`}>
					<span><MessageSquare size={14} /><code>{session.label}</code></span>
					<span>{session.source} · {number(session.totals.requests)} 次请求 · {session.totals.costRequests ? formatCost(session.totals.cost) : "未计价"}</span>
					<ArrowUpRight size={14} />
				</Link>)}</div> : <p className="obs-attribution-empty-line">当前范围内没有同时具备项目与会话归属的请求。只缺会话归属的请求仍计入上方项目统计。</p>}
			</section>
		</div>
	</section>;
}

function SessionDetail({
	session,
	totals,
	rangeParams,
	projectFilter,
	onClear,
}: {
	session: SessionAttributionSummary;
	totals: AttributionTotals;
	rangeParams: string;
	projectFilter: string;
	onClear: () => void;
}) {
	const requestParams = new URLSearchParams(rangeParams);
	requestParams.set("session", session.key);
	if (projectFilter) requestParams.set("project", projectFilter);
	return <section className="obs-attribution-detail" aria-labelledby="session-detail-title">
		<div className="obs-attribution-detail-head">
			<div><h2 id="session-detail-title"><MessageSquare size={17} />{session.label}</h2><p>{session.source} · {session.client}</p></div>
			<div className="obs-attribution-detail-actions"><Link className="obs-button" href={`/requests?${requestParams}`}>查看此会话请求 <ArrowUpRight size={14} /></Link><button className="obs-button" onClick={onClear}>返回会话列表</button></div>
		</div>
		<p className="obs-attribution-scope"><Database size={13} />统计范围为当前时间范围 + 当前会话{projectFilter ? " + 当前项目" : ""}。若此会话跨出范围，详情不会把范围外请求补进合计。</p>
		<section className="obs-stat-strip obs-attribution-stat-strip" aria-label="会话统计"><ProjectSummary totals={totals} /></section>
		<div className="obs-attribution-detail-grid">
			<section className="obs-attribution-section">
				<div className="obs-section-heading"><h2>可靠标识与归属</h2><span>完整原始标识</span></div>
				<dl className="obs-attribution-facts">
					<div><dt>会话标识</dt><dd><code className="obs-identifier">{session.id}</code></dd></div>
					<div><dt>来源 / 工具</dt><dd>{session.source} · {session.client}</dd></div>
					<div><dt>项目归属</dt><dd><AttributionState value={session.project} />{session.project.status === "known" && session.project.key && <Link className="obs-text-button" href={`/projects?${rangeParams}&project=${encodeURIComponent(session.project.key)}&session=${encodeURIComponent(session.key)}`}>查看项目（含当前会话） <ArrowUpRight size={13} /></Link>}<AttributionCandidates value={session.project} /></dd></div>
					<div><dt>范围内首条</dt><dd>{clock(session.start)}</dd></div>
					<div><dt>范围内最近</dt><dd>{clock(session.latest)}</dd></div>
					{session.parentSession && (session.parentSession.status === "known" || session.parentSession.status === "conflict") && <div><dt>父会话</dt><dd><code className="obs-identifier">{session.parentSession.label ?? session.parentSession.id ?? "未知"}</code></dd></div>}
				</dl>
			</section>
			<ModelLedger models={session.models} title="这个会话的最终模型" rangeParams={rangeParams} project={projectFilter || undefined} session={session.key} />
		</div>
	</section>;
}

function UnknownLedger({
	view,
	items,
	coverage,
	rangeParams,
}: {
	view: "projects" | "sessions";
	items: UnknownAttributionSummary[];
	coverage: ObservatorySnapshot["attribution"]["coverage"]["projects"];
	rangeParams: string;
}) {
	const subject = view === "projects" ? "项目" : "会话";
	const filter = view === "projects" ? "project" : "session";
	return <section className="obs-attribution-unknown" aria-labelledby={`unknown-${filter}-title`}>
		<div className="obs-section-heading obs-attribution-unknown-heading"><h2 id={`unknown-${filter}-title`}>未知{subject}</h2><span>{number(coverage.unknownRequests)} 条请求缺少可用{subject}归属</span><Link className="obs-text-button" href={`/requests?${rangeParams}&unknown=${filter}`}>查看全部未知{subject}请求 <ArrowUpRight size={14} /></Link></div>
		{items.length ? <div className="obs-attribution-unknown-list">{items.map((item) => <article key={item.key}>
			<div className="obs-attribution-unknown-icon"><CircleHelp size={16} /></div>
			<div><h3>{item.label}</h3><p>{number(item.totals.requests)} 次请求 · {item.totals.tokenRequests}/{item.totals.requests} 条完整用量 · {item.totals.costRequests ? `${formatCost(item.totals.cost)} 估算花费` : "未计价"}</p></div>
		</article>)}</div> : <div className="obs-attribution-empty-line">当前范围内没有缺少{subject}归属的请求。</div>}
	</section>;
}

function SortHeader({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
	return <button className={cn(active && "is-sorted")} onClick={onClick}>{children}<span aria-hidden="true">{active ? "↓" : "↕"}</span></button>;
}

function DetailStatus({
	view,
	tone,
	title,
	text,
	onRetry,
	onClear,
}: {
	view: "projects" | "sessions";
	tone: "loading" | "empty" | "error";
	title: string;
	text: string;
	onRetry: () => void;
	onClear: () => void;
}) {
	const Icon = view === "projects" ? Folder : MessageSquare;
	return <div className={cn("obs-attribution-loading", tone === "empty" && "obs-attribution-result-empty")} role={tone === "error" ? "alert" : "status"}>
		<Icon size={26} />
		<h2>{title}</h2>
		<p>{text}</p>
		{tone !== "loading" && <div className="obs-attribution-state-actions">{tone === "error" && <button className="obs-button" onClick={onRetry}>重试</button>}<button className="obs-button" onClick={onClear}>返回{view === "projects" ? "项目" : "会话"}列表</button></div>}
	</div>;
}

export function AttributionView({ view, snapshot, rangeParams, sort, selectedKey, contextKey, busy, error, rangeMatches, onSort, onSelect, onClearSelection, onRetry }: AttributionViewProps) {
	const attribution = snapshot.attribution;
	const coverage = view === "projects" ? attribution.coverage.projects : attribution.coverage.sessions;
	const unknown = view === "projects" ? attribution.unknownProjects : attribution.unknownSessions;
	const knownRequests = coverage.knownRequests, allRequests = knownRequests + coverage.unknownRequests;
	const completeUsage = coverage.knownTokenRequests + coverage.unknownTokenRequests;

	if (view === "projects" && selectedKey) {
		const selection = snapshot.selection;
		const expectedSession = contextKey || undefined;
		const matches = selection?.filters.project === selectedKey && selection.filters.session === expectedSession && !selection.filters.unknown;
		const project = matches ? selection.projects.find((item) => item.key === selectedKey) : undefined;
		if (!matches) {
			if (error && !busy) return <DetailStatus view={view} tone="error" title="项目详情读取失败" text="已保留项目筛选 URL；可以重试，或返回项目列表。" onRetry={onRetry} onClear={onClearSelection} />;
			if (busy || !rangeMatches) return <DetailStatus view={view} tone="loading" title="正在读取项目详情" text="只在当前时间范围和当前归属条件下汇总关联请求。" onRetry={onRetry} onClear={onClearSelection} />;
			return <DetailStatus view={view} tone="error" title="项目详情尚未同步" text="本地返回的数据与当前项目筛选不一致。可以重试，或返回项目列表。" onRetry={onRetry} onClear={onClearSelection} />;
		}
		return project
			? <ProjectDetail project={project} totals={selection.totals} rangeParams={rangeParams} sessionFilter={contextKey} onClear={onClearSelection} />
			: <DetailStatus view={view} tone="empty" title="当前范围无匹配请求" text="该归属对象不存在，或它在当前时间范围内没有请求。" onRetry={onRetry} onClear={onClearSelection} />;
	}
	if (view === "sessions" && selectedKey) {
		const selection = snapshot.selection;
		const expectedProject = contextKey || undefined;
		const matches = selection?.filters.session === selectedKey && selection.filters.project === expectedProject && !selection.filters.unknown;
		const session = matches ? selection.sessions.find((item) => item.key === selectedKey) : undefined;
		if (!matches) {
			if (error && !busy) return <DetailStatus view={view} tone="error" title="会话详情读取失败" text="已保留会话筛选 URL；可以重试，或返回会话列表。" onRetry={onRetry} onClear={onClearSelection} />;
			if (busy || !rangeMatches) return <DetailStatus view={view} tone="loading" title="正在读取会话详情" text="只在当前时间范围和当前归属条件下汇总关联请求。" onRetry={onRetry} onClear={onClearSelection} />;
			return <DetailStatus view={view} tone="error" title="会话详情尚未同步" text="本地返回的数据与当前会话筛选不一致。可以重试，或返回会话列表。" onRetry={onRetry} onClear={onClearSelection} />;
		}
		return session
			? <SessionDetail session={session} totals={selection.totals} rangeParams={rangeParams} projectFilter={contextKey} onClear={onClearSelection} />
			: <DetailStatus view={view} tone="empty" title="当前范围无匹配请求" text="该归属对象不存在，或它在当前时间范围内没有请求。" onRetry={onRetry} onClear={onClearSelection} />;
	}

	const sortValue = (totals: AttributionTotals) => sort === "tokens" ? recordedTokens(totals) : sort === "cost" ? totals.cost : totals.requests;
	const projects = [...attribution.projects].sort((a, b) => sortValue(b.totals) - sortValue(a.totals) || b.totals.requests - a.totals.requests || a.label.localeCompare(b.label));
	const sessions = [...attribution.sessions].sort((a, b) => sortValue(b.totals) - sortValue(a.totals) || b.totals.requests - a.totals.requests || (b.latest ?? "").localeCompare(a.latest ?? ""));
	return <>
		<section className="obs-stat-strip obs-attribution-stat-strip" aria-label={view === "projects" ? "项目归属统计" : "会话归属统计"}>
			<div><span><Folder size={14} />{view === "projects" ? "已识别项目" : "已识别会话"}</span><strong data-testid="attribution-known-count">{number(view === "projects" ? projects.length : sessions.length)}</strong><p>{number(unknown.length)} 类未知归属入口</p></div>
			<div><span><Database size={14} />有{view === "projects" ? "项目" : "会话"}归属</span><strong data-testid="attribution-known-requests">{number(knownRequests)}<small>/ {number(allRequests)} 次</small></strong><p>{allRequests ? `${Math.round(knownRequests / allRequests * 100)}% 的范围内请求可归属` : "当前范围没有请求"}</p></div>
			<div><span><Database size={14} />完整用量覆盖</span><strong>{number(completeUsage)}<small>/ {number(allRequests)} 条</small></strong><p>只有同时报告输入与输出的请求计入完整用量</p></div>
			<div><span><CircleDollarSign size={14} />估算花费</span><strong data-testid="attribution-cost-total">{snapshot.totals.costRequests ? formatCost(snapshot.totals.cost) : "未计价"}</strong><p>{number(snapshot.totals.costRequests)}/{number(snapshot.totals.requests)} 条请求已计价</p></div>
		</section>

		{view === "projects" ? <>
			<div className="obs-ledger-heading obs-attribution-heading"><div><h2>项目账本</h2><span>{number(projects.length)} 个项目</span></div><span className="obs-attribution-sort-note">按{sort === "tokens" ? "已记录 Token" : sort === "cost" ? "估算花费" : "请求数"}从高到低</span></div>
			<div className="obs-table-scroll"><table className="obs-table obs-attribution-table" data-testid="project-ledger">
				<thead><tr><th>项目</th><th aria-sort={sort === "requests" ? "descending" : undefined}><SortHeader active={sort === "requests"} onClick={() => onSort("requests")}>请求数</SortHeader></th><th aria-sort={sort === "tokens" ? "descending" : undefined}><SortHeader active={sort === "tokens"} onClick={() => onSort("tokens")}>已记录 Token</SortHeader></th><th aria-sort={sort === "cost" ? "descending" : undefined}><SortHeader active={sort === "cost"} onClick={() => onSort("cost")}>花费</SortHeader></th><th>涉及模型</th><th>最近活动</th><th><span className="sr-only">打开项目</span></th></tr></thead>
				<tbody>{projects.map((project) => <tr key={project.key}>
					<td><button className="obs-attribution-name" aria-label={`打开项目 ${project.label}`} onClick={() => onSelect(project.key)}><strong>{project.label}</strong>{project.path && <code>{project.path}</code>}<span>{project.source}</span></button></td>
					<td className="obs-numeric"><strong>{number(project.totals.requests)}</strong><div className="obs-usage-track"><i style={{ width: `${project.totals.requests / Math.max(1, allRequests) * 100}%` }} /></div></td>
					<td className="obs-numeric"><TokenReadout totals={project.totals} /></td>
					<td className="obs-numeric"><CostReadout totals={project.totals} /></td>
					<td className="obs-numeric"><strong>{number(project.modelCount)}</strong><span className="obs-subtext">个最终模型</span></td>
					<td className="obs-time">{clock(project.latest)}</td>
					<td><button className="obs-icon-button" aria-label={`查看项目 ${project.label} 的模型与会话`} onClick={() => onSelect(project.key)}><ChevronDown size={15} /></button></td>
				</tr>)}</tbody>
			</table>{!projects.length && <div className="obs-empty"><Folder size={26} strokeWidth={1.2} /><h3>当前范围没有已识别项目</h3><p>可以从下方未知项目入口核对缺少归属的请求。</p></div>}</div>
		</> : <>
			<div className="obs-ledger-heading obs-attribution-heading"><div><h2>会话账本</h2><span>{number(sessions.length)} 个会话</span></div><span className="obs-attribution-sort-note">按{sort === "tokens" ? "已记录 Token" : sort === "cost" ? "估算花费" : "请求数"}从高到低</span></div>
			<div className="obs-table-scroll"><table className="obs-table obs-attribution-table" data-testid="session-ledger">
				<thead><tr><th>会话</th><th>项目归属</th><th aria-sort={sort === "requests" ? "descending" : undefined}><SortHeader active={sort === "requests"} onClick={() => onSort("requests")}>请求数</SortHeader></th><th aria-sort={sort === "tokens" ? "descending" : undefined}><SortHeader active={sort === "tokens"} onClick={() => onSort("tokens")}>已记录 Token</SortHeader></th><th aria-sort={sort === "cost" ? "descending" : undefined}><SortHeader active={sort === "cost"} onClick={() => onSort("cost")}>花费</SortHeader></th><th>涉及模型</th><th>范围内最近</th><th><span className="sr-only">打开会话</span></th></tr></thead>
				<tbody>{sessions.map((session) => <tr key={session.key}>
					<td><button className="obs-attribution-name" aria-label={`打开会话 ${session.label}`} onClick={() => onSelect(session.key)}><code>{session.id}</code><span>{session.source} · {session.client}</span></button></td>
					<td><AttributionState value={session.project} />{session.project.status === "known" && (session.project.path || session.project.id || session.project.key) && <code className="obs-attribution-inline-id">{session.project.path ?? session.project.id ?? session.project.key}</code>}</td>
					<td className="obs-numeric"><strong>{number(session.totals.requests)}</strong><div className="obs-usage-track"><i style={{ width: `${session.totals.requests / Math.max(1, allRequests) * 100}%` }} /></div></td>
					<td className="obs-numeric"><TokenReadout totals={session.totals} /></td>
					<td className="obs-numeric"><CostReadout totals={session.totals} /></td>
					<td className="obs-numeric"><strong>{number(session.modelCount)}</strong><span className="obs-subtext">个最终模型</span></td>
					<td className="obs-time">{clock(session.latest)}</td>
					<td><button className="obs-icon-button" aria-label={`查看会话 ${session.label} 的模型与归属`} onClick={() => onSelect(session.key)}><ChevronDown size={15} /></button></td>
				</tr>)}</tbody>
			</table>{!sessions.length && <div className="obs-empty"><MessageSquare size={26} strokeWidth={1.2} /><h3>当前范围没有已识别会话</h3><p>可以从下方未知会话入口核对缺少归属的请求。</p></div>}</div>
		</>}

		<UnknownLedger view={view} items={unknown} coverage={coverage} rangeParams={rangeParams} />
	</>;
}
