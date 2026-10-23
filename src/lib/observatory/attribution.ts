import type { AttributionCandidate, AttributionDimensionCoverage, AttributionFilter, AttributionLink, AttributionModelSummary, AttributionOverview, AttributionReason, AttributionSelection, AttributionStatus, AttributionTotals, AttributionValue, ModelEvent, ModelEventAttribution, ProjectAttributionSummary, SessionAttributionSummary, UnknownAttributionSummary } from "./types";

type AttributionInput = {
	source: string;
	client?: string;
	id?: unknown;
	path?: unknown;
};

const CONTROL = /[\u0000-\u001f\u007f]/;
const DRIVE = /^[a-zA-Z]:\//;
const ABSOLUTE = /^(?:\/|[a-zA-Z]:\/|\/\/)/;
const frozenValues = new WeakSet<object>(), frozenEventValues = new WeakSet<object>();
const labelText: Record<Exclude<AttributionStatus, "known">, string> = {
	missing: "未知",
	unsupported: "来源不支持",
	invalid: "无效",
	conflict: "归属冲突",
};

function cleanSource(value: string) {
	return typeof value === "string" && value && value.length <= 200 && !CONTROL.test(value) ? value : null;
}

function cleanIdentifier(value: unknown): { value: string } | { reason: AttributionReason } | null {
	if (value === undefined) return null;
	if (typeof value !== "string") return { reason: "invalid-id" };
	const trimmed = value.trim();
	if (!trimmed || trimmed !== value || value.length > 200 || CONTROL.test(value)) return { reason: "invalid-id" };
	return { value };
}

/** Only separator and Windows drive-letter spelling are normalized. Case,
 * nested worktrees and dot segments remain distinct because no source in this
 * ledger proves they refer to the same project. */
function attributionKey(prefix: "project-id" | "session", parts: string[]) {
	return `${prefix}:${JSON.stringify(parts)}`;
}

export function normalizeProjectPath(value: string): string | null {
	if (typeof value !== "string" || !value || value.length > 4096 || value.trim() !== value || CONTROL.test(value)) return null;
	let path = value;
	if (/^\\\\[.?]\\/.test(path)) {
		if (/^\\\\\?\\UNC\\/i.test(path)) path = "//" + path.slice("\\\\?\\UNC\\".length);
		else if (/^\\\\\?\\[a-zA-Z]:\\/.test(path)) path = path.slice("\\\\?\\".length);
		else return null;
		path = path.replaceAll("\\", "/");
	} else if (/^\\\\[^\\]/.test(path) || /^[a-zA-Z]:\\/.test(path)) {
		path = path.replaceAll("\\", "/");
	}
	if (/^[a-zA-Z]:\//.test(path)) path = path[0].toUpperCase() + path.slice(1);
	if (!ABSOLUTE.test(path)) return null;
	if (path.startsWith("//")) {
		path = "//" + path.slice(2).replace(/\/{2,}/g, "/");
		const [server, share] = path.slice(2).split("/");
		if (!server || server === "." || server === "?" || !share) return null;
	}
	else path = path.replace(/\/{2,}/g, "/");
	if (path.length > 1 && path.endsWith("/") && !/^[a-zA-Z]:\/$/.test(path)) path = path.replace(/\/+$/, "");
	if (/(?:^|\/)\.{1,2}(?:\/|$)/.test(path)) return null;
	return path;
}

function projectLabel(path: string | undefined, id: string | undefined) {
	if (path) {
		const trimmed = path.length > 1 ? path.replace(/\/+$/, "") : path;
		const segment = trimmed.slice(trimmed.lastIndexOf("/") + 1);
		if (segment && !DRIVE.test(segment)) return segment;
	}
	return id ?? (path || "未知");
}

function makeCandidate(source: string, client: string | undefined, label: string, key: string | null, id?: string, path?: string): AttributionCandidate {
	const candidate: AttributionCandidate = { source, label, key };
	if (client) candidate.client = client;
	if (id) candidate.id = id;
	if (path) candidate.path = path;
	return Object.freeze(candidate);
}

function makeValue(fields: Omit<AttributionValue, "candidates"> & { candidates?: AttributionCandidate[] }): AttributionValue {
	const candidates = fields.candidates ? [...fields.candidates] : [];
	for (const candidate of candidates) Object.freeze(candidate);
	const value = Object.freeze({ ...fields, candidates: Object.freeze(candidates) });
	frozenValues.add(value);
	return value;
}

function unknownValue(source: string | null, client: string | undefined, status: Exclude<AttributionStatus, "known">, reason?: AttributionReason, candidates: AttributionCandidate[] = []): AttributionValue {
	const fields: Omit<AttributionValue, "candidates"> = { status, key: null, label: labelText[status], source };
	if (client) fields.client = client;
	if (reason) fields.reason = reason;
	return makeValue({ ...fields, candidates });
}

const legacyMissing: ModelEventAttribution = Object.freeze({
	project: unknownValue(null, undefined, "missing", "legacy"),
	session: unknownValue(null, undefined, "missing", "legacy"),
});

export function projectAttribution(input: AttributionInput, missingReason: AttributionReason = "not-provided"): AttributionValue {
	const source = cleanSource(input.source);
	const client = input.client && !CONTROL.test(input.client) ? input.client : undefined;
	const id = cleanIdentifier(input.id);
	const pathValue = input.path === undefined ? null : typeof input.path === "string" ? normalizeProjectPath(input.path) : null;
	if (!source) return unknownValue(null, client, "invalid", "invalid-id");
	if (id && "reason" in id) return unknownValue(source, client, "invalid", id.reason);
	if (input.path !== undefined && !pathValue) return unknownValue(source, client, "invalid", "invalid-path");
	if (pathValue) {
		const key = `project-path:${pathValue}`;
		const label = projectLabel(pathValue, id?.value);
		const candidate = makeCandidate(source, client, label, key, id?.value, pathValue);
		return makeValue({ status: "known", key, label, source, client, id: id?.value, path: pathValue, candidates: [candidate] });
	}
	if (id?.value) {
		const key = attributionKey("project-id", [source, id.value]);
		const candidate = makeCandidate(source, client, id.value, key, id.value);
		return makeValue({ status: "known", key, label: id.value, source, client, id: id.value, candidates: [candidate] });
	}
	return unknownValue(source, client, "missing", missingReason);
}

export function sessionAttribution(input: AttributionInput, missingReason: AttributionReason = "not-provided"): AttributionValue {
	const source = cleanSource(input.source);
	const client = input.client && !CONTROL.test(input.client) ? input.client : undefined;
	const id = cleanIdentifier(input.id);
	if (!source) return unknownValue(null, client, "invalid", "invalid-id");
	if (id && "reason" in id) return unknownValue(source, client, "invalid", id.reason);
	if (!id?.value) return unknownValue(source, client, "missing", missingReason);
	const key = attributionKey("session", [source, client ?? "", id.value]);
	const candidate = makeCandidate(source, client, id.value, key, id.value);
	return makeValue({ status: "known", key, label: id.value, source, client, id: id.value, candidates: [candidate] });
}

export function unsupportedAttribution(source: string, client?: string): AttributionValue {
	return unknownValue(cleanSource(source), client && !CONTROL.test(client) ? client : undefined, "unsupported", "source-unsupported");
}

export function freezeAttributionValue(value: AttributionValue): AttributionValue {
	if (frozenValues.has(value)) return value;
	for (const candidate of value.candidates) Object.freeze(candidate);
	Object.freeze(value.candidates);
	Object.freeze(value);
	frozenValues.add(value);
	return value;
}

export function freezeEventAttribution(value: ModelEventAttribution): ModelEventAttribution {
	if (frozenEventValues.has(value)) return value;
	freezeAttributionValue(value.project);
	freezeAttributionValue(value.session);
	if (value.parentSession) freezeAttributionValue(value.parentSession);
	Object.freeze(value);
	frozenEventValues.add(value);
	return value;
}

export function eventAttribution(event: Pick<ModelEvent, "attribution" | "client" | "evidence">): ModelEventAttribution {
	return event.attribution ? freezeEventAttribution(event.attribution) : legacyMissing;
}

function candidateKey(candidate: AttributionCandidate) {
	return `${candidate.source}\u0000${candidate.client ?? ""}\u0000${candidate.key ?? ""}\u0000${candidate.id ?? ""}\u0000${candidate.path ?? ""}`;
}

function uniqueCandidates(values: (AttributionValue | undefined)[]) {
	const seen = new Set<string>(), result: AttributionCandidate[] = [];
	for (const value of values) {
		if (!value) continue;
		for (const candidate of value.candidates) {
			const key = candidateKey(candidate);
			if (seen.has(key)) continue;
			seen.add(key);
			result.push(candidate);
		}
	}
	return result;
}

function conflictValue(values: (AttributionValue | undefined)[]): AttributionValue {
	const candidates = uniqueCandidates(values);
	return unknownValue(values.find((value) => value?.source)?.source ?? null, undefined, "conflict", "conflicting-values", candidates);
}

/** Known values fill absent evidence. Any two different known values, or a
 * known value beside malformed evidence, remain a conflict so aggregation
 * cannot silently pick a winner. */
export function mergeAttribution(previous: AttributionValue | undefined, incoming: AttributionValue | undefined): AttributionValue | undefined {
	if (!previous) return incoming ? freezeAttributionValue(incoming) : undefined;
	if (!incoming) return freezeAttributionValue(previous);
	if (previous.status === "conflict" || incoming.status === "conflict") return conflictValue([previous, incoming]);
	if (previous.status === "known" && incoming.status === "known") {
		return previous.key === incoming.key ? freezeAttributionValue(previous) : conflictValue([previous, incoming]);
	}
	if (previous.status === "known") {
		if (incoming.status === "missing" || incoming.status === "unsupported") return freezeAttributionValue(previous);
		return conflictValue([previous, incoming]);
	}
	if (incoming.status === "known") {
		if (previous.status === "missing" || previous.status === "unsupported") return freezeAttributionValue(incoming);
		return conflictValue([previous, incoming]);
	}
	if (previous.status === "invalid" || incoming.status === "invalid") {
		return unknownValue(previous.source ?? incoming.source, previous.client, "invalid", (previous.status === "invalid" ? previous.reason : incoming.reason) ?? "invalid-id", uniqueCandidates([previous, incoming]));
	}
	if (previous.status === "unsupported" || incoming.status === "unsupported") {
		return unknownValue(previous.source ?? incoming.source, previous.client, "unsupported", "source-unsupported");
	}
	return previous.reason === "legacy" && incoming.reason !== "legacy" ? freezeAttributionValue(incoming) : freezeAttributionValue(previous);
}

export function mergeEventAttribution(previous?: ModelEventAttribution, incoming?: ModelEventAttribution): ModelEventAttribution | undefined {
	if (!previous && !incoming) return undefined;
	const project = mergeAttribution(previous?.project, incoming?.project) ?? unknownValue(null, undefined, "missing", "legacy");
	const session = mergeAttribution(previous?.session, incoming?.session) ?? unknownValue(null, undefined, "missing", "legacy");
	const parentSession = mergeAttribution(previous?.parentSession, incoming?.parentSession);
	if (previous && project === previous.project && session === previous.session && parentSession === previous.parentSession) return freezeEventAttribution(previous);
	if (incoming && project === incoming.project && session === incoming.session && parentSession === incoming.parentSession) return freezeEventAttribution(incoming);
	const result: ModelEventAttribution = { project, session };
	if (parentSession) result.parentSession = parentSession;
	return freezeEventAttribution(result);
}

export function emptyAttributionTotals(): AttributionTotals {
	return { requests: 0, turnRequests: 0, input: 0, output: 0, cache: 0, inputRequests: 0, outputRequests: 0, cacheRequests: 0, tokenRequests: 0, errors: 0 };
}

function addTotals(target: AttributionTotals, row: ModelEvent) {
	target.requests++;
	target.turnRequests += Number(row.scope === "turn");
	target.input += row.input ?? 0;
	target.output += row.output ?? 0;
	target.cache += row.cache ?? 0;
	target.inputRequests += Number(row.input !== null);
	target.outputRequests += Number(row.output !== null);
	target.cacheRequests += Number(row.cache !== null);
	target.tokenRequests += Number(row.input !== null && row.output !== null);
	target.errors += Number(row.status === "error");
}

function copyTotals(value: AttributionTotals): AttributionTotals {
	return { ...value };
}

type ModelAccumulator = Map<string, AttributionModelSummary>;

function modelSummary(map: ModelAccumulator, row: ModelEvent) {
	let model = map.get(row.model);
	if (!model) {
		model = { model: row.model, ...emptyAttributionTotals() };
		map.set(row.model, model);
	}
	addTotals(model, row);
}

function modelList(map: ModelAccumulator) {
	return [...map.values()].sort((a, b) => b.requests - a.requests || (b.input + b.output) - (a.input + a.output) || a.model.localeCompare(b.model));
}

function unknownKey(dimension: "project" | "session", value: AttributionValue) {
	return `unknown:${dimension}:${value.status}:${value.reason ?? "unspecified"}`;
}

function unknownLabel(dimension: "project" | "session", value: AttributionValue) {
	const subject = dimension === "project" ? "项目归属" : "会话归属";
	if (value.status === "missing") return value.reason === "legacy" ? `${subject}未知（历史记录未提供）` : `${subject}未知`;
	if (value.status === "unsupported") return `${subject}来源不支持`;
	if (value.status === "invalid") return `${subject}无效`;
	return `${subject}冲突`;
}

function addUnknown(map: Map<string, UnknownAttributionSummary>, dimension: "project" | "session", value: AttributionValue, row: ModelEvent) {
	const key = unknownKey(dimension, value);
	let item = map.get(key);
	if (!item) {
		item = { key, dimension, status: value.status as Exclude<AttributionStatus, "known">, label: unknownLabel(dimension, value), totals: emptyAttributionTotals() };
		if (value.reason) item.reason = value.reason;
		map.set(key, item);
	}
	addTotals(item.totals, row);
}

type ProjectAccumulator = {
	key: string;
	label: string;
	source: string;
	id?: string;
	path?: string;
	totals: AttributionTotals;
	models: ModelAccumulator;
	sessions: Map<string, AttributionLink>;
	latest: string | null;
};

type SessionAccumulator = {
	key: string;
	label: string;
	source: string;
	client: string;
	id: string;
	project: AttributionValue;
	parentSession?: AttributionValue;
	totals: AttributionTotals;
	models: ModelAccumulator;
	start: string | null;
	latest: string | null;
};

function compareDate(a: string | null, b: string | null) {
	return (a ?? "").localeCompare(b ?? "");
}

/** Build every attribution dimension in one pass over the already selected,
 * reconciled requests. No per-group snapshot or activity reconstruction. */
export function buildAttribution(events: ModelEvent[]): { overview: AttributionOverview; totals: AttributionTotals; models: AttributionModelSummary[] } {
	const projects = new Map<string, ProjectAccumulator>(), sessions = new Map<string, SessionAccumulator>();
	const unknownProjects = new Map<string, UnknownAttributionSummary>(), unknownSessions = new Map<string, UnknownAttributionSummary>();
	const totals = emptyAttributionTotals(), models: ModelAccumulator = new Map();
	const projectCoverage: AttributionDimensionCoverage = { knownRequests: 0, unknownRequests: 0, knownTokenRequests: 0, unknownTokenRequests: 0 };
	const sessionCoverage: AttributionDimensionCoverage = { knownRequests: 0, unknownRequests: 0, knownTokenRequests: 0, unknownTokenRequests: 0 };
	for (const row of events) {
		const attribution = eventAttribution(row);
		addTotals(totals, row);
		modelSummary(models, row);
		const projectValue = attribution.project;
		if (projectValue.status === "known" && projectValue.key) {
			const projectKey: string = projectValue.key;
			let project = projects.get(projectKey);
			if (!project) {
				project = { key: projectKey, label: projectValue.label ?? projectKey, source: projectValue.source ?? "未知", totals: emptyAttributionTotals(), models: new Map(), sessions: new Map(), latest: row.timeKnown === false ? null : row.at };
				if (projectValue.id) project.id = projectValue.id;
				if (projectValue.path) project.path = projectValue.path;
				projects.set(projectKey, project);
			}
			addTotals(project.totals, row);
			modelSummary(project.models, row);
			if (row.timeKnown !== false && (!project.latest || row.at > project.latest)) project.latest = row.at;
			projectCoverage.knownRequests++;
			projectCoverage.knownTokenRequests += Number(row.input !== null && row.output !== null);
			const linkedSession = attribution.session;
			if (linkedSession.status === "known" && linkedSession.key) {
				const sessionKey: string = linkedSession.key;
				let link = project.sessions.get(sessionKey);
				if (!link) {
					link = { key: sessionKey, label: linkedSession.label ?? sessionKey, source: linkedSession.source ?? "未知", totals: emptyAttributionTotals() };
					project.sessions.set(link.key, link);
				}
				addTotals(link.totals, row);
			}
		} else {
			addUnknown(unknownProjects, "project", attribution.project, row);
			projectCoverage.unknownRequests++;
			projectCoverage.unknownTokenRequests += Number(row.input !== null && row.output !== null);
		}
		const sessionValue = attribution.session;
		if (sessionValue.status === "known" && sessionValue.key) {
			const sessionKey: string = sessionValue.key;
			let session = sessions.get(sessionKey);
			if (!session) {
				session = {
					key: sessionKey, label: sessionValue.label ?? sessionValue.id ?? sessionKey, source: sessionValue.source ?? "未知", client: sessionValue.client ?? row.client,
					id: sessionValue.id ?? sessionValue.label ?? sessionKey, project: projectValue, totals: emptyAttributionTotals(), models: new Map(),
					start: row.timeKnown === false ? null : row.at, latest: row.timeKnown === false ? null : row.at,
				};
				if (attribution.parentSession) session.parentSession = attribution.parentSession;
				sessions.set(sessionKey, session);
			} else {
				session.project = mergeAttribution(session.project, attribution.project) ?? session.project;
				if (attribution.parentSession) session.parentSession = mergeAttribution(session.parentSession, attribution.parentSession);
			}
			addTotals(session.totals, row);
			modelSummary(session.models, row);
			if (row.timeKnown !== false) {
				if (!session.start || row.at < session.start) session.start = row.at;
				if (!session.latest || row.at > session.latest) session.latest = row.at;
			}
			sessionCoverage.knownRequests++;
			sessionCoverage.knownTokenRequests += Number(row.input !== null && row.output !== null);
		} else {
			addUnknown(unknownSessions, "session", attribution.session, row);
			sessionCoverage.unknownRequests++;
			sessionCoverage.unknownTokenRequests += Number(row.input !== null && row.output !== null);
		}
	}
	const projectList: ProjectAttributionSummary[] = [...projects.values()].map((project) => ({
		key: project.key, label: project.label, source: project.source,
		...(project.id ? { id: project.id } : {}), ...(project.path ? { path: project.path } : {}),
		totals: copyTotals(project.totals), modelCount: project.models.size, sessionCount: project.sessions.size, models: modelList(project.models),
		sessions: [...project.sessions.values()].sort((a, b) => b.totals.requests - a.totals.requests || a.label.localeCompare(b.label)),
		latest: project.latest,
	})).sort((a, b) => b.totals.requests - a.totals.requests || (b.totals.input + b.totals.output) - (a.totals.input + a.totals.output) || a.label.localeCompare(b.label));
	const sessionList: SessionAttributionSummary[] = [...sessions.values()].map((session) => ({
		key: session.key, label: session.label, source: session.source, client: session.client, id: session.id,
		project: session.project, ...(session.parentSession ? { parentSession: session.parentSession } : {}),
		totals: copyTotals(session.totals), modelCount: session.models.size, models: modelList(session.models), start: session.start, latest: session.latest,
	})).sort((a, b) => compareDate(b.latest, a.latest) || a.label.localeCompare(b.label));
	return {
		overview: {
			projects: projectList, sessions: sessionList,
			unknownProjects: [...unknownProjects.values()].sort((a, b) => b.totals.requests - a.totals.requests || a.key.localeCompare(b.key)),
			unknownSessions: [...unknownSessions.values()].sort((a, b) => b.totals.requests - a.totals.requests || a.key.localeCompare(b.key)),
			coverage: { projects: projectCoverage, sessions: sessionCoverage },
		},
		totals, models: modelList(models),
	};
}

export function matchesAttribution(row: ModelEvent, filter: AttributionFilter): boolean {
	if (!filter.project && !filter.session && !filter.unknown) return true;
	const attribution = eventAttribution(row);
	if (filter.project) {
		if (filter.project === "unknown") {
			if (attribution.project.status === "known") return false;
		} else if (attribution.project.status !== "known" || attribution.project.key !== filter.project) return false;
	}
	if (filter.session) {
		if (filter.session === "unknown") {
			if (attribution.session.status === "known") return false;
		} else if (attribution.session.status !== "known" || attribution.session.key !== filter.session) return false;
	}
	if (filter.unknown) {
		const projectUnknown = attribution.project.status !== "known", sessionUnknown = attribution.session.status !== "known";
		if (filter.unknown === "project" && !projectUnknown) return false;
		if (filter.unknown === "session" && !sessionUnknown) return false;
		if (filter.unknown === "both" && !(projectUnknown && sessionUnknown)) return false;
	}
	return true;
}

export function makeAttributionSelection(events: ModelEvent[], filters: AttributionFilter): AttributionSelection {
	const grouped = buildAttribution(events);
	return {
		filters, totals: grouped.totals, models: grouped.models,
		projects: grouped.overview.projects, sessions: grouped.overview.sessions,
		unknownProjects: grouped.overview.unknownProjects, unknownSessions: grouped.overview.unknownSessions,
	};
}
