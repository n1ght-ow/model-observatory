import { DatabaseSync } from "node:sqlite";
import { homedir } from "node:os";
import { join } from "node:path";

export const CC_SWITCH_DB_PATH = join(
	homedir(),
	".cc-switch",
	"cc-switch.db"
);

export function queryRows<T extends Record<string, unknown>>(
	sql: string
): T[] {
	try {
		const db = new DatabaseSync(CC_SWITCH_DB_PATH, { readOnly: true });
		try {
			return db.prepare(sql).all() as T[];
		} finally {
			db.close();
		}
	} catch {
		return [];
	}
}
