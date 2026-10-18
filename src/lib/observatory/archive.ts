import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Coverage, ModelEvent } from "./types";

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
	private readMeta;
	private writeMeta;
	private countRows;
	private readEvent;
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
			this.accepted.clear(); this.strings.clear(); this.loaded = false; this.observations = undefined; this.cachedRead = undefined; this.cachedState = undefined;
		}
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
			for (const event of observations) {
				const previous = this.accepted.get(event.id);
				if (previous === event) continue;
				if (previous && (event.output ?? -1) < (previous.output ?? -1)) continue;
				const serialized = JSON.stringify(event);
				if (previous && JSON.stringify(previous) === serialized) continue;
				if (Number(this.insertEvent.run(event.id, serialized).changes)) {
					this.accepted.set(event.id, this.immutable(event)); this.observations = undefined; changed = true; recordsChanged = true;
				} else if (!previous) {
					this.accepted.set(event.id, this.decode(String(this.readEvent.get(event.id)?.event)));
					this.observations = undefined; changed = true; recordsChanged = true;
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
		} catch (error) { this.db.exec("ROLLBACK"); this.accepted.clear(); this.loaded = false; this.observations = undefined; this.cachedRead = undefined; this.cachedState = undefined; throw error; }
	}
	private immutable(event: ModelEvent) {
		// Readers publish revisions as new objects. Sharing these immutable records
		// avoids retaining both a JSON string and several decoded copies per row.
		for (const evidence of event.evidence) Object.freeze(evidence);
		Object.freeze(event.evidence);
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
