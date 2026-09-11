import { createReadStream } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
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
		model: event.model,
		provider: event.provider,
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
