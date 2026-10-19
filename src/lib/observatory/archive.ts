import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { freezeEventAttribution, mergeEventAttribution } from "./attribution";
import type { Coverage, ModelEvent, ModelEventAttribution } from "./types";

export type CollectionState = { paused: boolean; collectedAt: string | null; observations: number };

/** Store observations before reconciliation, so later evidence can still match history. */
export class ObservationArchive {
	private db: DatabaseSync;
	private dataVersion = -1;
	private accepted = new Map<string, ModelEvent>();
	private strings = new Map<string, string>();
	private loaded = false;
	private observationRevision = 0;
	get revision() { return this.observationRevision; }
	private observations?: ModelEvent[];
	private cachedRead?: { observations: ModelEvent[]; coverage: Coverage[] };
	private cachedState?: CollectionState;
	private storedAttributions?: Map<string, ModelEventAttribution>;
	private storedIds?: Set<string>;
	private readMeta;
	private writeMeta;
	private countRows;
	private readEvent;
	private readIds;
	private readAttributions;
	private dataVersionQuery;
	private insertEvent;
	constructor(path: string) {
		mkdirSync(dirname(path), { recursive: true });
		this.db = new DatabaseSync(path);
		// The parsed ledger is the working copy. Keep SQLite's page cache small
		// and skip mapping the whole file into this process.
		this.db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
			PRAGMA cache_size=-512; PRAGMA mmap_size=0;
			CREATE TABLE IF NOT EXISTS observations (id TEXT PRIMARY KEY, event TEXT NOT NULL);
			CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
		this.readMeta = this.db.prepare("SELECT value FROM metadata WHERE key=?");
		this.writeMeta = this.db.prepare("INSERT INTO metadata VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value");
		this.countRows = this.db.prepare("SELECT count(*) AS n FROM observations");
		this.readEvent = this.db.prepare("SELECT event FROM observations WHERE id=?");
		this.readIds = this.db.prepare("SELECT id FROM observations");
		this.readAttributions = this.db.prepare("SELECT id,json_extract(event,'$.attribution') AS attribution FROM observations WHERE json_type(event,'$.attribution')='object'");
		this.dataVersionQuery = this.db.prepare("PRAGMA data_version");
		this.insertEvent = this.db.prepare(`INSERT INTO observations VALUES (?,?) ON CONFLICT(id) DO UPDATE SET event=excluded.event
			WHERE observations.event<>excluded.event AND
			COALESCE(json_extract(excluded.event,'$.output'),-1) >= COALESCE(json_extract(observations.event,'$.output'),-1)`);
	}
	private value(key: string): string | undefined {
		return this.readMeta.get(key)?.value as string | undefined;
	}
	private put(key: string, value: string) {
		this.writeMeta.run(key, value);
	}
	private checkExternalWrites() {
		// A preview or a second profile can share the ledger. data_version changes
		// for another connection's commit, not for this connection's own writes.
		const version = Number(this.dataVersionQuery.get()?.data_version);
		if (version !== this.dataVersion) {
			this.observationRevision++;
			this.dataVersion = version;
			this.accepted.clear(); this.strings.clear(); this.loaded = false; this.observations = undefined; this.cachedRead = undefined; this.cachedState = undefined; this.storedAttributions = undefined; this.storedIds = undefined;
		}
	}
	private ids() {
		if (this.storedIds) return this.storedIds;
		const values = new Set<string>();
		for (const row of this.readIds.iterate()) values.add(String(row.id));
		return this.storedIds = values;
	}
	private attributions() {
		if (this.storedAttributions) return this.storedAttributions;
		const values = new Map<string, ModelEventAttribution>();
		for (const row of this.readAttributions.iterate()) {
			try {
				const attribution = JSON.parse(String(row.attribution)) as ModelEventAttribution;
				if (attribution && typeof attribution === "object") values.set(String(row.id), freezeEventAttribution(attribution));
			} catch {
				// A malformed old row remains readable as unattributed history.
			}
		}
		return this.storedAttributions = values;
	}
	state(): CollectionState {
		this.checkExternalWrites();
		return this.cachedState ??= { paused: this.value("paused") === "true", collectedAt: this.value("collectedAt") ?? null, observations: this.loaded ? this.accepted.size : Number(this.countRows.get()?.n ?? 0) };
	}
	setPaused(paused: boolean) {
		this.put("paused", String(paused));
		this.cachedState = undefined;
		return this.state();
	}
	commit(observations: ModelEvent[], coverage: Coverage[]): boolean {
		this.checkExternalWrites();
		this.db.exec("BEGIN IMMEDIATE");
		try {
			// A pause may arrive while readers await disk I/O. Read it inside the
			// transaction; the cached state may predate this lock.
			if (this.value("paused") === "true") { this.db.exec("ROLLBACK"); return false; }
			// Stream fragments and copied logs can replay an older, shorter revision.
			let changed = false, recordsChanged = false;
			const storedAttributions = this.attributions();
			const storedIds = this.ids();
			for (const incoming of observations) {
				let previous = this.accepted.get(incoming.id);
				if (previous === incoming) continue;
				if (!previous && storedIds.has(incoming.id)) {
					const serialized = String(this.readEvent.get(incoming.id)?.event ?? "");
					if (serialized) {
						previous = this.decode(serialized);
						this.accepted.set(incoming.id, previous);
					}
				}
				const attribution = mergeEventAttribution(previous?.attribution, incoming.attribution);
				// Usage revisions only move forward. Attribution evidence is
				// independent: a lower-usage replay can still establish a conflict,
				// so keep the published usage row and revise only its ownership.
				const advancesUsage = !previous || (incoming.output ?? -1) >= (previous.output ?? -1);
				const event = attribution
					? advancesUsage ? { ...incoming, attribution } : { ...previous!, attribution }
					: advancesUsage ? incoming : previous!;
				if (previous && JSON.stringify(previous) === JSON.stringify(event)) continue;
				const serialized = JSON.stringify(event);
				const inserted = Number(this.insertEvent.run(event.id, serialized).changes);
				if (inserted) {
					this.accepted.set(event.id, this.immutable(event)); this.observations = undefined; changed = true; recordsChanged = true;
					storedIds.add(event.id);
					if (attribution) storedAttributions.set(event.id, attribution);
				}
			}
			const encodedCoverage = JSON.stringify(coverage);
			if (this.value("coverage") !== encodedCoverage) { this.put("coverage", encodedCoverage); changed = true; }
			this.put("collectedAt", new Date().toISOString());
			this.db.exec("COMMIT");
			this.cachedState = undefined;
			if (changed) this.cachedRead = undefined;
			if (recordsChanged) this.observationRevision++;
			return true;
		} catch (error) { this.db.exec("ROLLBACK"); this.accepted.clear(); this.loaded = false; this.observations = undefined; this.cachedRead = undefined; this.cachedState = undefined; this.storedAttributions = undefined; this.storedIds = undefined; throw error; }
	}
	private immutable(event: ModelEvent) {
		// Readers publish revisions as new objects. Sharing these immutable records
		// avoids retaining both a JSON string and several decoded copies per row.
		for (const evidence of event.evidence) Object.freeze(evidence);
		Object.freeze(event.evidence);
		if (event.attribution) freezeEventAttribution(event.attribution);
		return Object.freeze(event);
	}
	private shared<T extends string>(value: T): T {
		const previous = this.strings.get(value);
		if (previous !== undefined) return previous as T;
		// Client-supplied names may be unique. Bound the pool independently of
		// ledger growth; evicting a name does not change any published record.
		if (this.strings.size >= 2048) this.strings.delete(this.strings.keys().next().value!);
		this.strings.set(value, value);
		return value;
	}
	private decode(serialized: string) {
		// JSON gives every row its own copies of long model and source names.
		// Share them before publishing, without changing immutable reader records.
		const event = JSON.parse(serialized) as ModelEvent;
		event.model = this.shared(event.model); event.rawModel = this.shared(event.rawModel);
		event.client = this.shared(event.client); event.upstream = this.shared(event.upstream);
		event.status = this.shared(event.status); event.identity = this.shared(event.identity);
		if (event.scope) event.scope = this.shared(event.scope);
		if (event.attribution) freezeEventAttribution(event.attribution);
		for (const evidence of event.evidence) {
			evidence.source = this.shared(evidence.source); evidence.kind = this.shared(evidence.kind);
			if (evidence.id === event.id) evidence.id = event.id;
		}
		return this.immutable(event);
	}
	read() {
		this.checkExternalWrites();
		if (this.cachedRead) return this.cachedRead;
		if (!this.loaded) {
			for (const row of this.db.prepare("SELECT id,event FROM observations").iterate()) {
				const previous = this.accepted.get(String(row.id)), serialized = String(row.event);
				if (!previous || JSON.stringify(previous) !== serialized) {
					const event = this.decode(serialized);
					this.accepted.set(event.id === row.id ? event.id : String(row.id), event);
				}
			}
			this.loaded = true; this.observations = undefined;
		}
		const observations = this.observations ??= [...this.accepted.values()];
		const coverage = JSON.parse(this.value("coverage") ?? "[]") as Coverage[];
		// Counts describe retained evidence; the source state still reports read failures.
		const counts = new Map<string, { count: number; latest: string | null }>();
		for (const row of observations) for (let index = 0; index < row.evidence.length; index++) {
			const evidence = row.evidence[index];
			const source = evidence.kind === "event" ? "events" : evidence.source;
			// Most rows have one source. Avoid a temporary array and Set per
			// historical request while still counting repeated evidence only once.
			let duplicate = false;
			for (let previous = 0; previous < index; previous++) {
				const entry = row.evidence[previous];
				if ((entry.kind === "event" ? "events" : entry.source) === source) { duplicate = true; break; }
			}
			if (duplicate) continue;
			const value = counts.get(source) ?? { count: 0, latest: null };
			value.count++;
			if (row.timeKnown !== false && (value.latest === null || row.at > value.latest)) value.latest = row.at;
			counts.set(source, value);
		}
		for (const source of coverage) {
			source.count = counts.get(source.id)?.count ?? 0;
			source.latest = counts.get(source.id)?.latest ?? null;
			if (source.count && source.state === "empty") source.state = "connected";
		}
		return this.cachedRead = { observations, coverage };
	}
	close() { this.db.close(); }
}
