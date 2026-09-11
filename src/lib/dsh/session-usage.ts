import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import * as zlib from "node:zlib";
import { estimateCnyCost } from "@/lib/deepseek/cny-pricing";
import type { RequestRecord as RequestRecordInternal } from "@/lib/metrics/types";

/**
 * DeepSeek Harness (DSH) session usage.
 *
 * DSH writes one append-only JSONL log per session to
 * `~/.dsh/sessions/<project>/<session>/session*.jsonl`, optionally Zstandard
 * compressed as a concatenation of independently decodable frames. Each
 * completed assistant message carries the upstream provider, the model, and the
 * token usage, which is what this module extracts.
 */

export const DSH_SESSIONS_DIR = join(homedir(), ".dsh", "sessions");

/** Provider id DSH records for DeepSeek's own API. */
export const DSH_NATIVE_DEEPSEEK_PROVIDER = "deepseek-official";

export type DshUsageEvent = {
	at: string;
	provider: string;
	model: string;
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	totalTokens: number;
	sessionId: string;
	cwd: string;
	/** Estimated CNY cost, only for turns the native DeepSeek API served. */
	costCny?: number;
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
	tornStart?: number;
} {
	const frames: ZstdFrameRange[] = [];
	let offset = 0;
	while (offset < buffer.length) {
		const start = offset;
		if (buffer.length - offset < 4) {
			return { frames, tornStart: start };
		}
		if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) {
			throw new Error(`invalid Zstandard frame magic at byte ${offset}`);
		}
		offset += 4;
		if (offset === buffer.length) {
			return { frames, tornStart: start };
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
			return { frames, tornStart: start };
		}
		offset += headerBytes;
		for (;;) {
			if (buffer.length - offset < 3) {
				return { frames, tornStart: start };
			}
			const blockHeader = buffer.readUIntLE(offset, 3);
			offset += 3;
			const lastBlock = (blockHeader & 1) !== 0;
			const blockType = (blockHeader >>> 1) & 0x03;
			const blockSize = blockHeader >>> 3;
			const payloadBytes = blockType === 0x01 ? 1 : blockSize;
			if (buffer.length - offset < payloadBytes) {
				return { frames, tornStart: start };
			}
			offset += payloadBytes;
			if (lastBlock) {
				break;
			}
		}
		if (checksum) {
			offset += 4;
		}
		frames.push({ start, end: offset });
	}
	return { frames };
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
	session: { id: string; cwd: string },
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
	// part separately, unlike CC Switch where the input count already contains
	// it. Normalising both into "total prompt + output" keeps the two sources
	// comparable and makes the CNY pricing see the right cache-miss volume.
	const uncachedInputTokens = toNumber(usage.inputTokens);
	const cacheReadTokens = toNumber(usage.cacheReadTokens);
	const outputTokens = toNumber(usage.outputTokens);
	const inputTokens = uncachedInputTokens + cacheReadTokens;
	const provider = toText(source?.provider, "unknown");
	const model = toText(source?.model, "unknown");
	const at = new Date(time > 0 ? time : Date.now()).toISOString();
	const startedAt = stepStarts.get(stepKey(record.data));
	const event: DshUsageEvent = {
		at,
		provider,
		model,
		inputTokens,
		outputTokens,
		cacheReadTokens,
		totalTokens: inputTokens + outputTokens,
		sessionId: session.id,
		cwd: session.cwd,
		durationMs:
			startedAt !== undefined && time > startedAt ? time - startedAt : undefined,
	};
	if (provider === DSH_NATIVE_DEEPSEEK_PROVIDER) {
		event.costCny = estimateCnyCost({
			at,
			cacheReadTokens,
			inputTokens,
			model,
			outputTokens,
		});
	}
	return event;
}

/** Continues the step clock of a cached read, or starts a fresh one. */
function reusableStepStarts(
	cached: FileCacheEntry | undefined
): Map<string, number> {
	return cached ? cached.stepStarts : new Map<string, number>();
}

type FileCacheEntry = {
	/** Bytes the cached read was taken from, to detect untouched files. */
	size: number;
	mtimeMs: number;
	/** Complete frames already decoded from this file. */
	frames: number;
	events: DshUsageEvent[];
	/** `turn:step` → `step/start` time, kept so appended frames can time a turn. */
	stepStarts: Map<string, number>;
};

const fileCache = new Map<string, FileCacheEntry>();
let cachedScan: { at: number; files: string[] } | null = null;

const SCAN_TTL_MS = 4_000;

async function listSessionFiles(): Promise<string[]> {
	if (cachedScan && Date.now() - cachedScan.at < SCAN_TTL_MS) {
		return cachedScan.files;
	}
	const files: string[] = [];
	const walk = async (dir: string, depth: number): Promise<void> => {
		if (depth < 0) {
			return;
		}
		let entries;
		try {
			entries = await readdir(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			const path = join(dir, entry.name);
			if (entry.isDirectory()) {
				await walk(path, depth - 1);
			} else if (/^session.*\.jsonl(\.zstd)?$/.test(entry.name)) {
				files.push(path);
			}
		}
	};
	await walk(DSH_SESSIONS_DIR, 3);
	cachedScan = { at: Date.now(), files };
	return files;
}

/**
 * Reads one session log, decoding only the frames appended since the previous
 * read. A session file rewritten shorter starts over so stale events never
 * survive.
 *
 * The dashboard polls every few seconds while only the session being written is
 * growing, so an untouched file is answered from the cache without touching the
 * disk at all — otherwise each poll would re-read every session (tens of MB).
 */
async function readSessionFile(path: string): Promise<DshUsageEvent[]> {
	const cached = fileCache.get(path);
	if (cached && cached.size > 0) {
		try {
			const current = await stat(path);
			if (current.size === cached.size && current.mtimeMs === cached.mtimeMs) {
				return cached.events;
			}
		} catch {
			// A file that vanished falls through and reports no events.
			fileCache.delete(path);
			return [];
		}
	}
	const info = await stat(path);
	const buffer = await readFile(path);
	const compressed = path.endsWith(".zstd");
	const session = { id: path, cwd: "" };
	const events: DshUsageEvent[] = [];
	const stepStarts = reusableStepStarts(cached);

	let ranges: ZstdFrameRange[];
	if (compressed) {
		if (!zstdDecompressSync) {
			throw new Error("This Node.js build has no Zstandard support.");
		}
		ranges = scanZstdFrames(buffer).frames;
	} else {
		ranges = [{ start: 0, end: buffer.length }];
	}

	const reusable =
		cached !== undefined && cached.frames > 0 && ranges.length >= cached.frames;
	const startFrame = reusable ? cached.frames : 0;
	if (reusable) {
		events.push(...cached.events);
		const first = cached.events[0];
		if (first) {
			session.id = first.sessionId;
			session.cwd = first.cwd;
		}
	}

	for (let index = startFrame; index < ranges.length; index += 1) {
		const range = ranges[index];
		const text = compressed
			? zstdDecompressSync!(buffer.subarray(range.start, range.end)).toString("utf8")
			: buffer.subarray(range.start, range.end).toString("utf8");
		for (const line of text.split("\n")) {
			if (!line) {
				continue;
			}
			let record: unknown;
			try {
				record = JSON.parse(line);
			} catch {
				continue;
			}
			if (!isRecord(record)) {
				continue;
			}
			if (record.type === "session") {
				session.id = toText(record.id, session.id);
				session.cwd = toText(record.cwd, session.cwd);
				continue;
			}
			if (record.type === "step/start" && isRecord(record.data)) {
				stepStarts.set(stepKey(record.data), toNumber(record.time));
				continue;
			}
			const event = toUsageEvent(record, session, stepStarts);
			if (event) {
				events.push(event);
			}
		}
	}

	fileCache.set(path, {
		size: info.size,
		mtimeMs: info.mtimeMs,
		frames: ranges.length,
		events,
		stepStarts,
	});
	return events;
}

/** Every usage event DSH has recorded, newest first. */
export async function readDshUsageEvents(): Promise<DshUsageEvent[]> {
	const files = await listSessionFiles();
	const all: DshUsageEvent[] = [];
	for (const path of files) {
		try {
			all.push(...(await readSessionFile(path)));
		} catch {
			// A session that cannot be read must not break the dashboard.
		}
	}
	all.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
	return all;
}
/**
 * Projects the harness events into the dashboard's request-record shape, so the
 * DeepSeek page and the Requests/Models pages can list harness traffic next to
 * the rows CC Switch imported.
 *
 * DSH logs a completed turn rather than an HTTP exchange: there is no status
 * code, so every record is reported as a completed 200, and the duration comes
 * from the matching \`step/start\`.
 */
export function toDshRequestRecords(
	events: readonly DshUsageEvent[]
): RequestRecordInternal[] {
	return events.map((event) => ({
		at: event.at,
		model: event.model,
		provider: event.provider,
		status: 200,
		durationMs: event.durationMs,
		inputTokens: event.inputTokens,
		outputTokens: event.outputTokens,
		cacheReadTokens: event.cacheReadTokens,
		totalTokens: event.totalTokens,
		costCny: event.costCny,
		dataSource: "dsh-session",
	}));
}

