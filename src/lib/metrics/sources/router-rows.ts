import { createReadStream } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { providerLabel } from "@/lib/metrics/provider";
import type { RequestRecord } from "@/lib/metrics/types";

/**
 * The Codex Router's own event log.
 *
 * Every request that went through the local router is appended here as one JSON line,
 * including the provider the router finally used — which is the only place that is
 * recorded, because CC Switch's import keeps the model but not the upstream.
 */

export const ROUTER_DIR = join(homedir(), ".codex", "codex-router");
const USAGE_EVENTS_PATH = join(ROUTER_DIR, "usage-events.jsonl");

export type UsageEvent = {
	at: string;
	model: string;
	provider: string;
	status: number;
	durationMs: number;
	firstTokenMs: number;
	inputTokens: number;
	outputTokens: number;
	totalTokens: number;
	estimatedInputTokens: number;
};

function toNumber(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function toEvent(raw: unknown): UsageEvent | null {
	if (!raw || typeof raw !== "object") {
		return null;
	}
	const row = raw as Record<string, unknown>;
	const at = typeof row.at === "string" ? row.at : null;
	if (!at) {
		return null;
	}
	return {
		at,
		model: typeof row.model === "string" ? row.model : "unknown",
		provider: typeof row.provider === "string" ? row.provider : "unknown",
		status: toNumber(row.status),
		durationMs: toNumber(row.durationMs),
		firstTokenMs: toNumber(row.firstTokenMs),
		inputTokens: toNumber(row.inputTokens),
		outputTokens: toNumber(row.outputTokens),
		totalTokens: toNumber(row.totalTokens),
		estimatedInputTokens: toNumber(row.estimatedInputTokens),
	};
}

/**
 * Strips the provider prefix the router puts on every model name.
 *
 * The router writes a model as `<upstream>/<model>` — `deepseek/deepseek-v4-flash`,
 * `commandcode/z-ai/glm-5.3-flash` — while the same model reached directly is recorded
 * by CC Switch without any prefix. Two spellings of one model on one upstream meant the
 * Models table listed it twice and never added the two halves together: the router's
 * 655 `deepseek/deepseek-v4.1-flash-expires-on-0910` requests sat in their own row,
 * next to 706 of the same model from a session that called api.deepseek.com directly.
 *
 * Only a prefix equal to the row's own provider is removed, which is exactly the
 * namespacing the router added and cannot be part of a real model id. Checked against
 * the live log: every routed model carries its provider's prefix except the bare
 * `openai` ones, and stripping merges no two different model ids.
 */
function bareModel(provider: string, model: string): string {
	const prefix = provider.toLowerCase() + "/";
	return model.toLowerCase().startsWith(prefix) ? model.slice(prefix.length) : model;
}

/**
 * Router rows, with the router's own provider name normalised.
 *
 * The router records the upstream it finally used (\`deepseek\`, \`commandcode\`, and
 * whatever else is enabled), which is the only place that is written down — CC Switch
 * keeps the model but not the upstream. Names are normalised here so that a routed
 * DeepSeek request and a direct one end up under the same label, and merge.
 */
export function toRequestRecord(event: UsageEvent): RequestRecord {
	const inputTokens =
		event.inputTokens > 0 ? event.inputTokens : event.estimatedInputTokens;
	const derivedTotal = inputTokens + event.outputTokens;
	const totalTokens =
		event.totalTokens > 0
			? Math.max(event.totalTokens, derivedTotal)
			: derivedTotal;
	return {
		at: event.at,
		model: bareModel(event.provider, event.model),
		provider: providerLabel(event.provider),
		status: event.status,
		durationMs: event.durationMs > 0 ? event.durationMs : undefined,
		firstTokenMs: event.firstTokenMs > 0 ? event.firstTokenMs : undefined,
		inputTokens,
		outputTokens: event.outputTokens,
		totalTokens,
	};
}

export async function readEvents(): Promise<UsageEvent[]> {
	const events: UsageEvent[] = [];
	try {
		const stream = createReadStream(USAGE_EVENTS_PATH, { encoding: "utf8" });
		const lines = createInterface({ input: stream, crlfDelay: Infinity });
		for await (const line of lines) {
			const trimmed = line.trim();
			if (!trimmed) {
				continue;
			}
			try {
				const event = toEvent(JSON.parse(trimmed));
				if (event) {
					events.push(event);
				}
			} catch {
				// Skip malformed rows rather than failing the whole dashboard.
			}
		}
	} catch {
		return [];
	}
	return events;
}

/** Router rows, unordered (callers sort by whatever they need). */
export async function readRouterRowsAsync(): Promise<RequestRecord[]> {
	return (await readEvents()).map(toRequestRecord);
}
