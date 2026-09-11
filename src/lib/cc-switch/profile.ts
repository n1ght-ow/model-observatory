import { queryRows } from "@/lib/cc-switch/client";

export type CcSwitchProfileKind = "deepseek" | "router" | "other";

export type CcSwitchProfile = {
	id: string;
	name: string;
	kind: CcSwitchProfileKind;
};

type ProviderRow = {
	id?: unknown;
	name?: unknown;
	is_current?: unknown;
};

export async function getCurrentCodexProfile(): Promise<CcSwitchProfile | null> {
	const rows = queryRows<ProviderRow>(
		`SELECT id, name, is_current
		 FROM providers
		 WHERE app_type = 'codex'`
	);
	const current = rows.find((row) => Number(row.is_current) === 1);
	if (!current || typeof current.id !== "string") {
		return null;
	}
	const name = typeof current.name === "string" ? current.name : current.id;
	const normalizedName = name.toLowerCase();
	const kind: CcSwitchProfileKind =
		current.id === "deepseek-direct-local" || normalizedName.includes("deepseek")
			? "deepseek"
			: current.id === "codex-router-local" ||
				  normalizedName.includes("codex router")
				? "router"
				: "other";
	return { id: current.id, name, kind };
}
