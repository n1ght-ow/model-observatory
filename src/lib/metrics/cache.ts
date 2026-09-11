export type TtlCache<T> = {
	get(loader: () => Promise<T>): Promise<T>;
	invalidate(): void;
};

export function createTtlCache<T>(ttlMs: number): TtlCache<T> {
	let value: T | null = null;
	let expiresAt = 0;

	return {
		async get(loader) {
			const now = Date.now();
			if (value !== null && expiresAt > now) {
				return value;
			}
			const next = await loader();
			value = next;
			expiresAt = Date.now() + ttlMs;
			return next;
		},
		invalidate() {
			value = null;
			expiresAt = 0;
		},
	};
}
