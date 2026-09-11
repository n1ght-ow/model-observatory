declare module "node:sqlite" {
	type SqliteValue = string | number | bigint | null | Uint8Array;

	export class StatementSync {
		all(...params: SqliteValue[]): Record<string, SqliteValue>[];
		get(...params: SqliteValue[]): Record<string, SqliteValue> | undefined;
		run(...params: SqliteValue[]): {
			changes: number;
			lastInsertRowid: number | bigint;
		};
	}

	export class DatabaseSync {
		constructor(
			path: string,
			options?: {
				open?: boolean;
				readOnly?: boolean;
			}
		);
		prepare(sql: string): StatementSync;
		close(): void;
	}
}
