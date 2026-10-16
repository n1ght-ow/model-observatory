import { createReadStream } from "node:fs";
import { open, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import * as zlib from "node:zlib";
import { listFiles } from "../files";

/**
 * DeepSeek Harness (DSH) session usage.
 *
 * DSH writes one append-only JSONL log per session to
 * `~/.dsh/sessions/<project>/<session>/session*.jsonl`, optionally Zstandard
 * compressed as a concatenation of independently decodable frames. Each
 * completed assistant message carries the upstream provider, the model, and the
 * token usage, which is what this module extracts.
 */

const DSH_SESSIONS_DIR = join(homedir(), ".dsh", "sessions");

type DshUsageEvent = {
	sequence: number;
	at: string;
	provider: string;
	model: string;
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	sessionId: string;
	/** `step/end` minus the matching `step/start`, i.e. how long the turn took. */
	durationMs?: number;
};
type ZstdFrameRange = { start: number; end: number };

const ZSTD_MAGIC = 0xfd2fb528;

const zstdDecompressSync = (
	zlib as unknown as {
		zstdDecompressSync?: (input: Buffer) => Buffer;
	}
).zstdDecompressSync;

/**
 * Walk a concatenated Zstandard container and report the byte range of every
 * structurally complete frame. Ported from DSH's own session persistence
 * reader so the dashboard never has to guess frame boundaries.
 */
function scanZstdFrames(buffer: Buffer): {
	frames: ZstdFrameRange[];
} {
	const frames: ZstdFrameRange[] = [];
	let offset = 0;
	while (offset < buffer.length) {
		const start = offset;
		if (buffer.length - offset < 4) {
			return { frames };
		}
		if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) {
			throw new Error(`invalid Zstandard frame magic at byte ${offset}`);
		}
		offset += 4;
		if (offset === buffer.length) {
			return { frames };
		}
		const descriptor = buffer.readUInt8(offset);
		offset += 1;
		const contentSizeFlag = descriptor >>> 6;
		const singleSegment = (descriptor & 0x20) !== 0;
		const checksum = (descriptor & 0x04) !== 0;
		const dictionaryFlag = descriptor & 0x03;
		const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag;
		const contentSizeBytes =
			contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag;
		const headerBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes;
		if (buffer.length - offset < headerBytes) {
			return { frames };
		}
		offset += headerBytes;
		for (;;) {
			if (buffer.length - offset < 3) {
				return { frames };
			}
			const blockHeader = buffer.readUIntLE(offset, 3);
			offset += 3;
			const lastBlock = (blockHeader & 1) !== 0;
			const blockType = (blockHeader >>> 1) & 0x03;
			const blockSize = blockHeader >>> 3;
			const payloadBytes = blockType === 0x01 ? 1 : blockSize;
			if (buffer.length - offset < payloadBytes) {
				return { frames };
			}
			offset += payloadBytes;
			if (lastBlock) {
				break;
			}
		}
		if (checksum) {
			if (buffer.length - offset < 4) return { frames };
			offset += 4;
		}
		frames.push({ start, end: offset });
	}
	return { frames };
}

/** The record types this reader needs; everything else in a log is tool output. */
const WANTED_TYPES = new Set(["assistant/message", "step/start", "session"]);

/**
 * The type a record announces in its own first bytes, or null when the line has
 * another shape.
 *
 * DSH writes one JSON object per line with `type` first, and a session log is
 * overwhelmingly tool results: 182k lines on this machine, of which 22k are the
 * records this reader wants. Parsing all of them cost a full second of the first
 * read after a server start. A line whose type is read from its prefix and is none
 * of the three wanted ones is skipped; a line whose prefix is *not* in that shape
 * is parsed anyway, so a change to the writer's field order costs speed rather
 * than records.
 */
const RECORD_TYPE = /^\{"type":"([a-z/-]+)"/;

/**
 * Visits every record of one decoded frame that this reader could want.
 *
 * The scan works on the frame's bytes, so an unwanted line is never decoded into a
 * string or parsed at all - which is where the time went.
 */
function visitRecords(
	chunk: Buffer,
	visit: (record: Record<string, unknown>) => void
): void {
	let from = 0;
	while (from < chunk.length) {
		let end = chunk.indexOf(0x0a, from);
		if (end < 0) {
			end = chunk.length;
		}
		if (end > from) {
			// Only the prefix decides whether the line is parsed; a multi-byte
			// character cut by this slice cannot reach it.
			const head = chunk.toString("utf8", from, Math.min(end, from + 40));
			const type = RECORD_TYPE.exec(head);
			if (type === null || WANTED_TYPES.has(type[1])) {
				const line =
					end - from <= head.length ? head : chunk.toString("utf8", from, end);
				let record: unknown = null;
				try {
					record = JSON.parse(line);
				} catch {
					record = null;
				}
				if (isRecord(record)) {
					visit(record);
				}
			}
		}
		from = end + 1;
	}
}

function toNumber(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function toText(value: unknown, fallback = ""): string {
	return typeof value === "string" && value.length > 0 ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * One `assistant/message` record. DSH records the provider and model that
 * served the turn on the message source and the token usage beside it.
 */
function stepKey(data: Record<string, unknown>): string {
	return `${toNumber(data.turn)}:${toNumber(data.step)}`;
}

function toUsageEvent(
	record: Record<string, unknown>,
	session: { id: string },
	stepStarts: Map<string, number>
): DshUsageEvent | null {
	if (record.type !== "assistant/message" || !isRecord(record.data)) {
		return null;
	}
	const usage = record.data.usage;
	if (!isRecord(usage)) {
		return null;
	}
	const message = record.data.message;
	const source = isRecord(message) && isRecord(message.source) ? message.source : null;
	const time = toNumber(record.time);
	// DSH reports `inputTokens` as the *uncached* prompt and lists the cached
	// part separately. The ledger always stores input including cached tokens.
	const uncachedInputTokens = toNumber(usage.inputTokens);
	const cacheReadTokens = toNumber(usage.cacheReadTokens);
	const outputTokens = toNumber(usage.outputTokens);
	const inputTokens = uncachedInputTokens + cacheReadTokens;
	const provider = toText(source?.provider, "unknown");
	const model = toText(source?.model, "unknown");
	const at = new Date(time > 0 ? time : Date.now()).toISOString();
	const startedAt = stepStarts.get(stepKey(record.data));
	const event: DshUsageEvent = {
		sequence: 0,
		at,
		provider,
		model,
		inputTokens,
		outputTokens,
		cacheReadTokens,
		sessionId: session.id,
		durationMs:
			startedAt !== undefined && time > startedAt ? time - startedAt : undefined,
	};
	return event;
}

type FileCacheEntry = {
	/** Bytes and mtime of the file when this cache was stored. */
	size: number;
	mtimeMs: number;
	/** First byte not yet parsed. An incomplete frame or line starts here. */
	parsedBytes: number;
	/** Detects a rewrite that grows without being a pure append. */
	prefix: Buffer;
	events: DshUsageEvent[];
	sequence: number;
	/** `turn:step` → `step/start` time, kept so appended frames can time a turn. */
	stepStarts: Map<string, number>;
	sessionId: string;
	/** True when the next byte is still inside a log line this reader does not need. */
	skippingLine: boolean;
};

const fileCache = new Map<string, FileCacheEntry>();

/** Committed observations live in SQLite; retain only the incremental decoder. */
export function releaseCommittedDsh() {
	for (const file of fileCache.values()) file.events = [];
}

async function prefixMatches(path: string, prefix: Buffer) {
	if (prefix.length === 0) return true;
	const file = await open(path, "r");
	try {
		const sample = Buffer.alloc(prefix.length);
		const { bytesRead } = await file.read(sample, 0, prefix.length, 0);
		return bytesRead === prefix.length && sample.equals(prefix);
	} finally {
		await file.close();
	}
}

/**
 * Reads one session log. An untouched file is answered from memory. An append
 * is streamed from the first unparsed byte in 256 KiB pieces, so a long session
 * is not loaded whole on every poll. A shorter file, a same-size rewrite, or a
 * changed prefix starts over and cannot reuse stale calls.
 */
export async function readDshSessionFile(path: string): Promise<DshUsageEvent[]> {
	const cached = fileCache.get(path);
	let info;
	try {
		info = await stat(path);
	} catch {
		fileCache.delete(path);
		return [];
	}
	if (cached && info.size === cached.size && info.mtimeMs === cached.mtimeMs) return cached.events;
	const compressed = path.endsWith(".zstd");
	if (compressed && !zstdDecompressSync) throw new Error("This Node.js build has no Zstandard support.");
	const sameSizeRewrite = Boolean(cached) && info.mtimeMs !== cached!.mtimeMs && info.size <= cached!.size;
	let reset = !cached || info.size < cached.size || sameSizeRewrite;
	if (!reset && cached && !(await prefixMatches(path, cached.prefix))) reset = true;
	const events = reset ? [] : [...cached!.events];
	let sequence = reset ? 0 : cached!.sequence;
	const stepStarts = reset ? new Map<string, number>() : cached!.stepStarts;
	const session = { id: reset || !cached ? path : cached.sessionId };
	const start = reset ? 0 : cached!.parsedBytes;
	let prefix = reset ? Buffer.alloc(0) : cached!.prefix;
	let pending = Buffer.alloc(0);
	let skippingLine = Boolean(!reset && cached?.skippingLine);
	const absorb = (chunk: Buffer) => {
		visitRecords(chunk, (record) => {
			if (record.type === "session") {
				session.id = toText(record.id, session.id);
				return;
			}
			if (record.type === "step/start" && isRecord(record.data)) {
				stepStarts.set(stepKey(record.data), toNumber(record.time));
				return;
			}
			const event = toUsageEvent(record, session, stepStarts);
			if (event) {
				event.sequence = sequence++;
				events.push(event);
			}
		});
	};
	// Tool-result lines dominate a session and can be megabytes. Once the type
	// prefix shows the line is irrelevant, the rest is discarded instead of joined.
	const takePlain = (bytes: Buffer) => {
		let from = 0;
		while (from < bytes.length) {
			if (skippingLine) {
				const end = bytes.indexOf(10, from);
				if (end === -1) return;
				skippingLine = false;
				from = end + 1;
				continue;
			}
			const end = bytes.indexOf(10, from);
			const piece = bytes.subarray(from, end === -1 ? bytes.length : end);
			const combined = pending.length ? Buffer.concat([pending, piece]) : piece;
			if (end === -1) {
				const head = combined.toString("utf8", 0, Math.min(combined.length, 40));
				const type = RECORD_TYPE.exec(head);
				if (combined.length >= 40 && type && !WANTED_TYPES.has(type[1])) {
					skippingLine = true;
					pending = Buffer.alloc(0);
				} else pending = Buffer.from(combined);
				return;
			}
			absorb(combined);
			pending = Buffer.alloc(0);
			from = end + 1;
		}
	};
	if (info.size > start) {
		const stream = createReadStream(path, { start, end: info.size - 1, highWaterMark: 256 * 1024 });
		for await (const chunk of stream) {
			const bytes = chunk as Buffer;
			if (reset && prefix.length < 64) prefix = Buffer.concat([prefix, Buffer.from(bytes.subarray(0, 64 - prefix.length))]);
			if (compressed) {
				pending = pending.length === 0 ? Buffer.from(bytes) : Buffer.concat([pending, bytes]);
				let consumed = 0;
				for (const range of scanZstdFrames(pending).frames) {
					absorb(zstdDecompressSync!(pending.subarray(range.start, range.end)));
					consumed = range.end;
				}
				pending = consumed === 0 ? pending : consumed === pending.length ? Buffer.alloc(0) : Buffer.from(pending.subarray(consumed));
			} else takePlain(bytes);
		}
	}
	fileCache.set(path, {
		size: info.size, mtimeMs: info.mtimeMs, parsedBytes: info.size - pending.length, prefix, events, sequence, stepStarts, sessionId: session.id, skippingLine,
	});
	return events;
}

/** Every usage event DSH has recorded; the shared ledger owns display ordering. */
export async function readDshUsageEvents(): Promise<DshUsageEvent[]> {
	const files = await listFiles(DSH_SESSIONS_DIR, /^session.*\.jsonl(\.zstd)?$/, 3);
	const live = new Set(files);
	for (const path of fileCache.keys()) if (!live.has(path)) fileCache.delete(path);
	const all: DshUsageEvent[] = [];
	for (const path of files) {
		try {
			for (const event of await readDshSessionFile(path)) all.push(event);
		} catch {
			// A session that cannot be read must not break the dashboard.
		}
	}
	return all;
}
