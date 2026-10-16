import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";

type FileState<T, S> = { offset: number; mtime: number; identity: string; path: string; tail: Buffer[]; tailBytes: number; rows: T[]; state: S };
const files = new Map<string, FileState<unknown, unknown>>();

/** The archive keeps the parsed records. Drop the reader's extra row list, but
 * keep the byte cursor and parser state so the next poll reads only an append.
 * A rotated or deleted log is forgotten, including any partial multi-megabyte tail. */
export async function releaseCommittedJsonl(prefix = "observatory-") {
	await Promise.all([...files.entries()].filter(([key]) => key.startsWith(prefix)).map(async ([key, file]) => {
		try {
			const info = await stat(file.path);
			const identity = `${info.dev}:${info.ino}:${info.birthtimeMs}`;
			if (identity !== file.identity || info.size < file.offset) files.delete(key);
			else file.rows = [];
		} catch { files.delete(key); }
	}));
}

/** Commit only complete lines. A live writer's partial JSON is retried next poll. */
export async function scanJsonl<T, S>(path: string, namespace: string, initial: () => S,
	parse: (value: Record<string, unknown>, state: S, line: number) => T[], interesting?: (line: string) => boolean): Promise<T[]> {
	const info = await stat(path);
	const identity = `${info.dev}:${info.ino}:${info.birthtimeMs}`;
	const key = `${namespace}:${path}`;
	let file = files.get(key) as FileState<T, S> | undefined;
	if (!file || file.identity !== identity || info.size < file.offset || (info.size === file.offset && info.mtimeMs !== file.mtime)) {
		file = { offset: 0, mtime: 0, identity, path, tail: [], tailBytes: 0, rows: [], state: initial() };
	}
	if (file.offset === info.size && file.mtime === info.mtimeMs) return file.rows;
	if (info.size > file.offset) {
		const stream = createReadStream(path, { start: file.offset, end: info.size - 1, highWaterMark: 256 * 1024 });
		for await (const chunk of stream) {
			const bytes = chunk as Buffer;
			let from = 0;
			let end: number;
			while ((end = bytes.indexOf(10, from)) !== -1) {
				const segment = bytes.subarray(from, end);
				// A tool result can occupy megabytes. Join its fragments once at the
				// newline, rather than copying the entire growing line for every read.
				const line = (file.tailBytes ? Buffer.concat([...file.tail, segment], file.tailBytes + segment.length) : segment).toString("utf8");
				file.tail = []; file.tailBytes = 0;
				from = end + 1;
				if (interesting && !interesting(line)) continue;
				try { file.rows.push(...parse(JSON.parse(line), file.state, file.rows.length)); } catch { /* A malformed observation cannot erase valid history. */ }
			}
			if (from < bytes.length) {
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
