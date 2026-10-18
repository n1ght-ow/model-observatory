import { normalizeModel } from "./identity";
import type { ModelEvent, ModelSummary, ObservatorySnapshot, Coverage } from "./types";
import { timeBounds, type CustomDates } from "./time-range";

/** One-to-one reconciliation: never dedupe two calls made by the same reader. */
export function reconcile(observations: ModelEvent[], aliases: Record<string, string> = {}) {
	type Entry = { row: ModelEvent };
	const native: Entry[] = [];
	const routers: Entry[] = [];
	const stableIds = new Map<string, Entry>();
	const modelNames = new Map<string, string>();
	let merged = 0;
	for (const observation of observations) {
		let model = modelNames.get(observation.rawModel);
		if (model === undefined) { model = normalizeModel(observation.rawModel, aliases); modelNames.set(observation.rawModel, model); }
		const row = model === observation.model ? observation : { ...observation, model };
		const key = row.requestId ? `${row.evidence[0].source}:${row.requestId}` : row.id;
		const previous = stableIds.get(key);
		if (previous) {
			// Re-emitted message ids are revisions of one request, not new calls.
			if ((row.output ?? 0) >= (previous.row.output ?? 0)) previous.row = { ...previous.row, ...row };
			merged++;
			continue;
		}
		const entry = { row };
		stableIds.set(key, entry);
		(row.evidence[0].kind === "router" ? routers : native).push(entry);
	}
	const byUsage = new Map<string, Entry[]>();
	for (const entry of native) {
		const { row } = entry;
		if (row.output === null || row.output === 0) continue;
		const key = `${row.model}:${row.output}`;
		const bucket = byUsage.get(key) ?? [];
		bucket.push(entry);
		byUsage.set(key, bucket);
	}
	const used = new Set<string>();
	const pending: ModelEvent[] = [];
	for (const routerEntry of routers) {
		const router = routerEntry.row;
		const end = Date.parse(router.at);
		const candidates = (byUsage.get(`${router.model}:${router.output}`) ?? []).filter(({ row }) => {
			if (used.has(row.id)) return false;
			const delta = Math.min(Math.abs(Date.parse(row.at) - end), Math.abs(Date.parse(row.at) - end - (router.duration ?? 0)));
			return delta <= 15_000 && row.input !== null && router.input !== null && row.input === router.input;
		});
		if (candidates.length === 1) {
			const entry = candidates[0], owner = entry.row;
			used.add(owner.id);
			// Only reconciled or renamed rows need a new object. Raw evidence can
			// stay shared with the archive and incremental readers across queries.
			entry.row = { ...owner, evidence: [...owner.evidence, ...router.evidence], upstream: router.upstream, status: router.status, duration: router.duration, identity: "reported", cache: router.cache ?? owner.cache };
			merged++;
		} else if (candidates.length > 1) {
			pending.push(router);
		} else {
			native.push(routerEntry);
		}
	}
	return { events: native.map(({ row }) => row), pending, merged };
}

const rangeDuration: Record<string, number> = { "24h": 86_400_000, "7d": 7 * 86_400_000, "30d": 30 * 86_400_000 };

export function eventTimes(events: ModelEvent[]) {
	const times = new Float64Array(events.length);
	for (let index = 0; index < events.length; index++) times[index] = Date.parse(events[index].at);
	return times;
}

/** The instant a cached window would gain or lose a record. `all` stays valid
 * until a future-dated record becomes current; sliding ranges also expire the
 * oldest included record. Callers reuse the snapshot until then. */
export function nextSnapshotChange(range: string, now: number, events: ModelEvent[], times: Float64Array, dates?: CustomDates) {
	let until = Number.POSITIVE_INFINITY;
	const bounds = timeBounds(range, now, dates);
	if (range !== "custom" && bounds.until !== null) until = bounds.until;
	const duration = rangeDuration[range];
	for (let index = 0; index < events.length; index++) {
		const at = times[index];
		if (!Number.isFinite(at)) continue;
		if (at > now && at < until && (bounds.since === null || at >= bounds.since) && (bounds.until === null || at < bounds.until)) until = at;
		if (duration && events[index].timeKnown !== false && at <= now && at >= now - duration) until = Math.min(until, at + duration + 1);
	}
	return until;
}

export function makeSnapshot(observations: ModelEvent[], coverage: Coverage[], range: string, aliases: Record<string, string>, now = Date.now(), prepared?: ReturnType<typeof reconcile> & { times?: Float64Array }, dates?: CustomDates): ObservatorySnapshot {
	const ledger = prepared ?? reconcile(observations, aliases);
	const { since, until } = timeBounds(range, now, dates);
	const source = ledger.events;
	const parsed = prepared?.times?.length === source.length ? prepared.times : eventTimes(source);
	const selected: number[] = [];
	for (let index = 0; index < source.length; index++) {
		const at = parsed[index], row = source[index];
		if (Number.isFinite(at) && at <= now && (since === null || (row.timeKnown !== false && at >= since)) && (until === null || at < until)) selected.push(index);
	}
	// The unfiltered ledger is already the response list. A window keeps only
	// its own index array, so a one-day view does not copy the whole history.
	const events = selected.length === source.length ? source : selected.map((index) => source[index]);
	const times = selected.length === source.length ? parsed : Float64Array.from(selected, (index) => parsed[index]);
	const models = new Map<string, ModelSummary>();
	const clientMaps = new Map<string, Map<string, { name: string; requests: number }>>();
	const upstreams = new Map<string, Set<string>>();
	const aliasSets = new Map<string, Set<string>>();
	const clients = new Set<string>();
	let turnRequests = 0, input = 0, output = 0, cache = 0, inputRequests = 0, outputRequests = 0, cacheRequests = 0, tokenRequests = 0, errors = 0;
	for (let index = 0; index < events.length; index++) {
		const row = events[index];
		const item = models.get(row.model) ?? { model: row.model, requests: 0, input: 0, output: 0, cache: 0, inputRequests: 0, outputRequests: 0, cacheRequests: 0, tokenRequests: 0, errors: 0, clients: [], upstreams: [], aliases: [], latest: row.timeKnown === false ? "" : row.at, configured: 0, turnRequests: 0 };
		item.requests++;
		const turn = Number(row.scope === "turn");
		item.turnRequests += turn; turnRequests += turn;
		const rowInput = row.input ?? 0, rowOutput = row.output ?? 0, rowCache = row.cache ?? 0;
		item.input += rowInput; input += rowInput;
		item.output += rowOutput; output += rowOutput;
		item.cache += rowCache; cache += rowCache;
		const hasInput = Number(row.input !== null), hasOutput = Number(row.output !== null), hasCache = Number(row.cache !== null);
		item.inputRequests += hasInput; inputRequests += hasInput;
		item.outputRequests += hasOutput; outputRequests += hasOutput;
		item.cacheRequests += hasCache; cacheRequests += hasCache;
		const complete = Number(row.input !== null && row.output !== null);
		item.tokenRequests += complete; tokenRequests += complete;
		const failed = Number(row.status === "error");
		item.errors += failed; errors += failed;
		item.configured += Number(row.identity === "configured");
		if (row.timeKnown !== false && row.at > item.latest) item.latest = row.at;
		const byClient = clientMaps.get(row.model) ?? new Map<string, { name: string; requests: number }>();
		const client = byClient.get(row.client);
		if (client) client.requests++;
		else { const created = { name: row.client, requests: 1 }; byClient.set(row.client, created); item.clients.push(created); }
		clientMaps.set(row.model, byClient);
		const routes = upstreams.get(row.model) ?? new Set<string>();
		if (!routes.has(row.upstream)) { routes.add(row.upstream); item.upstreams.push(row.upstream); }
		upstreams.set(row.model, routes);
		const names = aliasSets.get(row.model) ?? new Set<string>();
		if (!names.has(row.rawModel)) { names.add(row.rawModel); item.aliases.push(row.rawModel); }
		aliasSets.set(row.model, names);
		models.set(row.model, item);
		clients.add(row.client);
	}
	const list = [...models.values()].sort((a, b) => b.requests - a.requests);
	const end = Math.min(now, until === null ? now : until - 1);
	const span = end - (since ?? end - 86_400_000);
	const bucketMs = since !== null && span <= 86_400_000 ? 3_600_000 : Math.max(1, Math.ceil(span / (120 * 86_400_000))) * 86_400_000;
	let earliest = now - 86_400_000;
	if (since === null) for (let index = 0; index < events.length; index++) if (events[index].timeKnown !== false && times[index] < earliest) earliest = times[index];
	const start = since ?? earliest;
	const offset = bucketMs >= 86_400_000 ? 8 * 3_600_000 : 0;
	const bucketAt = (at: number) => Math.floor((at + offset) / bucketMs) * bucketMs - offset;
	const buckets = new Map<number, { at: string; requests: number; tokens: number }>();
	for (let at = bucketAt(start); at <= end; at += bucketMs) buckets.set(at, { at: new Date(at).toISOString(), requests: 0, tokens: 0 });
	for (let index = 0; index < events.length; index++) {
		if (events[index].timeKnown === false) continue;
		const bucket = buckets.get(bucketAt(times[index]));
		if (bucket) { bucket.requests++; bucket.tokens += (events[index].input ?? 0) + (events[index].output ?? 0); }
	}
	if (!prepared) events.sort((a, b) => b.at.localeCompare(a.at));
	return {
		generatedAt: new Date(now).toISOString(), range, since: since === null ? null : new Date(since).toISOString(), until: until === null ? null : new Date(until).toISOString(),
		totals: { requests: events.length, turnRequests, models: models.size, clients: clients.size, input, output, cache, inputRequests, outputRequests, cacheRequests, errors, tokenRequests },
		models: list, activity: [...buckets.values()], requests: events, requestCount: events.length, coverage,
		reconciliation: { observations: observations.length, merged: ledger.merged, pending: ledger.pending.length, excluded: 0 },
		pending: ledger.pending, aliases,
	};
}
