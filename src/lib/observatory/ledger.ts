import { normalizeModel, UNRECORDED_CLIENT } from "./identity";
import type { ActivityModel, ActivityPoint, ModelEvent, ModelSummary, ObservatorySnapshot, Coverage } from "./types";
import { timeBounds, type CustomDates } from "./time-range";
import { buildAttribution, mergeEventAttribution } from "./attribution";

/** One-to-one reconciliation: never dedupe two calls made by the same reader. */
export function reconcile(observations: ModelEvent[], aliases: Record<string, string> = {}) {
	const native: ModelEvent[] = [];
	const routers: ModelEvent[] = [];
	// Signed, one-based slots keep revisions in their original owner list
	// without an extra wrapper object for every historical observation.
	const stableIds = new Map<string, number>();
	const modelNames = new Map<string, string>();
	let merged = 0;
	for (const observation of observations) {
		let model = modelNames.get(observation.rawModel);
		if (model === undefined) { model = normalizeModel(observation.rawModel, aliases); modelNames.set(observation.rawModel, model); }
		// Retained router history uses the old placeholder; revise the view without
		// rewriting immutable evidence or inferring a caller from the route name.
		const client = observation.client === "未识别工具" && observation.evidence[0].kind === "router" ? UNRECORDED_CLIENT : observation.client;
		const row = model === observation.model && client === observation.client ? observation : { ...observation, model, client };
		const key = row.requestId ? JSON.stringify([row.evidence[0].source, row.requestId]) : row.id;
		const previous = stableIds.get(key);
		if (previous !== undefined) {
			const list = previous > 0 ? native : routers, index = Math.abs(previous) - 1;
			// Re-emitted message ids are revisions of one request, not new calls.
			const current = list[index];
			const attribution = mergeEventAttribution(current.attribution, row.attribution);
			// Usage keeps the newest report while ownership evidence from an older
			// replay can still establish a conflict.
			list[index] = (row.output ?? 0) >= (current.output ?? 0)
				? { ...current, ...row, ...(attribution ? { attribution } : {}) }
				: { ...current, ...(attribution ? { attribution } : {}) };
			merged++;
			continue;
		}
		const router = row.evidence[0].kind === "router";
		const list = router ? routers : native;
		stableIds.set(key, (router ? -1 : 1) * list.push(row));
	}
	if (!routers.length) return { events: native, pending: [], merged };
	// Numeric linked slots replace thousands of bucket arrays and concatenated
	// model/token keys. Timestamps are parsed once, even in large collision groups.
	const byUsage = new Map<string, Map<number, number>>();
	for (const row of routers) {
		if (row.output === null || row.output === 0) continue;
		const outputs = byUsage.get(row.model) ?? new Map<number, number>();
		outputs.set(row.output, 0);
		byUsage.set(row.model, outputs);
	}
	const next = new Int32Array(native.length), times = new Float64Array(native.length);
	for (let index = 0; index < native.length; index++) {
		const row = native[index];
		if (row.output === null || row.output === 0) continue;
		const outputs = byUsage.get(row.model);
		if (!outputs?.has(row.output)) continue;
		next[index] = outputs.get(row.output) ?? 0;
		outputs.set(row.output, index + 1);
		times[index] = Date.parse(row.at);
	}
	const used = new Set<string>();
	const pending: ModelEvent[] = [];
	for (const router of routers) {
		const end = Date.parse(router.at);
		let candidate = -1, matches = 0;
		for (let slot = router.output === null ? 0 : byUsage.get(router.model)?.get(router.output) ?? 0; slot; slot = next[slot - 1]) {
			const index = slot - 1, row = native[index];
			if (used.has(row.id)) continue;
			const delta = Math.min(Math.abs(times[index] - end), Math.abs(times[index] - end - (router.duration ?? 0)));
			if (delta <= 15_000 && row.input !== null && router.input !== null && row.input === router.input) {
				candidate = index;
				if (++matches === 2) break;
			}
		}
		if (matches === 1) {
			const owner = native[candidate];
			used.add(owner.id);
			// Only reconciled or renamed rows need a new object. Raw evidence can
			// stay shared with the archive and incremental readers across queries.
			const attribution = mergeEventAttribution(owner.attribution, router.attribution);
			native[candidate] = { ...owner, evidence: [...owner.evidence, ...router.evidence], upstream: router.upstream, status: router.status, duration: router.duration, identity: "reported", cache: router.cache ?? owner.cache, ...(attribution ? { attribution } : {}) };
			merged++;
		} else if (matches > 1) {
			pending.push(router);
		} else {
			native.push(router);
		}
	}
	return { events: native, pending, merged };
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
	const buckets = new Map<number, ActivityPoint>();
	const bucketModels = new Map<ActivityPoint, Map<string, ActivityModel>>();
	for (let at = bucketAt(start); at <= end; at += bucketMs) buckets.set(at, { at: new Date(Math.max(at, start)).toISOString(), until: new Date(Math.min(at + bucketMs, end + 1)).toISOString(), requests: 0, tokens: 0, models: [] });
	for (let index = 0; index < events.length; index++) {
		if (events[index].timeKnown === false) continue;
		const bucket = buckets.get(bucketAt(times[index]));
		if (bucket) {
			const row = events[index];
			bucket.requests++; bucket.tokens += (row.input ?? 0) + (row.output ?? 0);
			const byModel = bucketModels.get(bucket) ?? new Map<string, ActivityModel>();
			const model = byModel.get(row.model) ?? { model: row.model, requests: 0, input: 0, output: 0, cache: 0, inputRequests: 0, outputRequests: 0, cacheRequests: 0, tokenRequests: 0 };
			model.requests++;
			model.input += row.input ?? 0; model.output += row.output ?? 0; model.cache += row.cache ?? 0;
			model.inputRequests += Number(row.input !== null); model.outputRequests += Number(row.output !== null); model.cacheRequests += Number(row.cache !== null);
			model.tokenRequests += Number(row.input !== null && row.output !== null);
			if (!byModel.has(row.model)) { byModel.set(row.model, model); bucket.models.push(model); }
			bucketModels.set(bucket, byModel);
		}
	}
	if (!prepared) events.sort((a, b) => b.at.localeCompare(a.at));
	const attribution = buildAttribution(events).overview;
	return {
		generatedAt: new Date(now).toISOString(), range, since: since === null ? null : new Date(since).toISOString(), until: until === null ? null : new Date(until).toISOString(),
		totals: { requests: events.length, turnRequests, models: models.size, clients: clients.size, input, output, cache, inputRequests, outputRequests, cacheRequests, errors, tokenRequests },
		models: list, activity: [...buckets.values()], requests: events, requestCount: events.length, coverage,
		reconciliation: { observations: observations.length, merged: ledger.merged, pending: ledger.pending.length, excluded: 0 },
		pending: ledger.pending, aliases, attribution,
	};
}
