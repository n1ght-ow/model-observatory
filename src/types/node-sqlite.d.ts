declare module "node:sqlite" {
	type SqliteValue = string | number | bigint | null | Uint8Array;

	export class StatementSync {
		iterate(...params: SqliteValue[]): IterableIterator<Record<string, SqliteValue>>;
		all(...params: SqliteValue[]): Record<string, SqliteValue>[];
		get(...params: SqliteValue[]): Record<string, SqliteValue> | undefined;
		run(...params: SqliteValue[]): {
			changes: number;
			lastInsertRowid: number | bigint;
		};
	}

	export class DatabaseSync {
		exec(sql: string): void;
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
