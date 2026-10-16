import { readdir } from "node:fs/promises";
import { join } from "node:path";

/** Missing tool directories are an empty source, not a failure. */
export async function listFiles(
	root: string,
	pattern: RegExp,
	depth: number,
): Promise<string[]> {
	const files: string[] = [];
	const walk = async (dir: string, levels: number): Promise<void> => {
		if (levels < 0) {
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
				await walk(path, levels - 1);
			} else if (pattern.test(entry.name)) {
				files.push(path);
			}
		}
	};
	await walk(root, depth);
	files.sort();
	return files;
}

