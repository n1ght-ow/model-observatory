import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";

type FileState<T, S> = { offset: number; mtime: number; identity: string; path: string; tail: Buffer[]; tailBytes: number; discarded: boolean; rows: T[]; emitted: number; state: S };
const files = new Map<string, FileState<unknown, unknown>>();

/** The archive keeps the parsed records. Drop the reader's extra row list, but
 * keep the byte cursor and parser state so the next poll reads only an append.
 * A rotated or deleted log is forgotten, including any partial multi-megabyte tail. */
export async function releaseCommittedJsonl(prefix = "observatory-") {
	const release = async (key: string, file: FileState<unknown, unknown>) => {
		try {
			const info = await stat(file.path);
			const identity = `${info.dev}:${info.ino}:${info.birthtimeMs}`;
			if (identity !== file.identity || info.size < file.offset) files.delete(key);
			else file.rows = [];
		} catch { files.delete(key); }
	};
	// A large session directory must not enqueue a stat and a promise per file.
	let batch: Promise<void>[] = [];
	for (const [key, file] of files) if (key.startsWith(prefix)) {
		batch.push(release(key, file));
		if (batch.length === 32) { await Promise.all(batch); batch = []; }
	}
	await Promise.all(batch);
}

/** Commit only complete lines. A live writer's partial JSON is retried next poll. */
export async function scanJsonl<T, S>(path: string, namespace: string, initial: () => S,
	parse: (value: Record<string, unknown>, state: S, line: number) => T[], interesting?: (line: string) => boolean,
	discardPrefix?: (prefix: string) => boolean): Promise<T[]> {
	const info = await stat(path);
	const identity = `${info.dev}:${info.ino}:${info.birthtimeMs}`;
	const key = `${namespace}:${path}`;
	let file = files.get(key) as FileState<T, S> | undefined;
	if (!file || file.identity !== identity || info.size < file.offset || (info.size === file.offset && info.mtimeMs !== file.mtime)) {
		file = { offset: 0, mtime: 0, identity, path, tail: [], tailBytes: 0, discarded: false, rows: [], emitted: 0, state: initial() };
	}
	if (file.offset === info.size && file.mtime === info.mtimeMs) return file.rows;
	const discard = (segment: Buffer) => {
		if (file.discarded || !discardPrefix) return file.discarded;
		// Only an explicitly recognized prefix can discard a line. Unknown field
		// order keeps the complete parser; wanted records have no size cutoff.
		let head: Buffer;
		if (!file.tailBytes) head = segment.subarray(0, 512);
		else {
			const length = Math.min(512, file.tailBytes + segment.length);
			head = Buffer.allocUnsafe(length);
			let offset = 0;
			for (const part of file.tail) {
				offset += part.copy(head, offset, 0, length - offset);
				if (offset === length) break;
			}
			if (offset < length) segment.copy(head, offset, 0, length - offset);
		}
		if (!discardPrefix(head.toString("utf8"))) return false;
		file.tail = []; file.tailBytes = 0; file.discarded = true;
		return true;
	};
	if (info.size > file.offset) {
		const stream = createReadStream(path, { start: file.offset, end: info.size - 1, highWaterMark: 256 * 1024 });
		for await (const chunk of stream) {
			const bytes = chunk as Buffer;
			let from = 0;
			let end: number;
			while ((end = bytes.indexOf(10, from)) !== -1) {
				const segment = bytes.subarray(from, end);
				from = end + 1;
				if (discard(segment)) { file.discarded = false; continue; }
				// A tool result can occupy megabytes. Join its fragments once at the
				// newline, rather than copying the entire growing line for every read.
				const line = (file.tailBytes ? Buffer.concat([...file.tail, segment], file.tailBytes + segment.length) : segment).toString("utf8");
				file.tail = []; file.tailBytes = 0;
				if (interesting && !interesting(line)) continue;
				try {
					// Fallback request IDs use this ordinal. Releasing committed rows
					// must not restart it and overwrite an earlier independent call.
					const rows = parse(JSON.parse(line), file.state, file.emitted);
					for (const row of rows) file.rows.push(row);
					file.emitted += rows.length;
				} catch { /* A malformed observation cannot erase valid history. */ }
			}
			if (from < bytes.length && !discard(bytes.subarray(from))) {
				// A few unfinished bytes must not pin the entire 256 KiB read buffer
				// for the lifetime of a quiet log. Large line fragments stay zero-copy.
				const tail = bytes.subarray(from);
				file.tail.push(from > bytes.length / 2 ? Buffer.from(tail) : tail);
				file.tailBytes += tail.length;
			}
			file.offset += bytes.length;
		}
	}
	file.offset = info.size;
	file.mtime = info.mtimeMs;
	files.set(key, file as FileState<unknown, unknown>);
	return file.rows;
}
