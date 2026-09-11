import { queryRows } from "@/lib/cc-switch/client";
import { estimateCnyCost } from "@/lib/deepseek/cny-pricing";
import type { RequestRecord } from "@/lib/metrics/types";

/**
 * Codex rows as CC Switch recorded them.
 *
 * CC Switch imports Codex session logs into `proxy_request_logs` as `codex_session`
 * rows, and that import loses the upstream: a row is just "a request for some model".
 * Sorting out which upstream served it is `session-upstream.ts`'s job; this module
 * only reads the rows.
 *
 * Two views need them and they need *different* subsets:
 *
 * - `/deepseek` wants the DeepSeek-named rows only, because it is a page about one
 *   upstream (and applies its own upstream filter on top).
 * - `/all` wants every Codex row, including the 952 non-DeepSeek ones that no other
 *   tab can show — those are glm, gpt, qwen and friends, and they are only invisible
 *   today because each tab is scoped to one upstream.
 */

type CcSwitchRow = {
	model?: unknown;
	input_tokens?: unknown;
	output_tokens?: unknown;
	cache_read_tokens?: unknown;
	total_cost_usd?: unknown;
	latency_ms?: unknown;
	first_token_ms?: unknown;
	duration_ms?: unknown;
	status_code?: unknown;
	data_source?: unknown;
	session_id?: unknown;
	created_at?: unknown;
};

/** A record plus the Codex session it came from, used for upstream filtering. */
export type CodexRequestRow = RequestRecord & { sessionId: string };

/**
 * Placeholder until a caller classifies the row. Never shown: both callers relabel
 * every row they read, because only they know which session it belongs to.
 */
const UNKNOWN_PROVIDER = "unknown";

function toNumber(value: unknown): number {
	if (typeof value === "number" && Number.isFinite(value)) {
		return value;
	}
	if (typeof value === "bigint") {
		return Number(value);
	}
	if (typeof value === "string") {
		const parsed = Number.parseFloat(value);
		if (Number.isFinite(parsed)) {
			return parsed;
		}
	}
	return 0;
}

function toStringValue(value: unknown, fallback = ""): string {
	return typeof value === "string" ? value : fallback;
}

function toRow(row: CcSwitchRow): CodexRequestRow {
	const createdAt = toNumber(row.created_at);
	const inputTokens = toNumber(row.input_tokens);
	const outputTokens = toNumber(row.output_tokens);
	const latencyMs = toNumber(row.latency_ms);
	const durationMs = toNumber(row.duration_ms);
	const firstTokenMs = toNumber(row.first_token_ms);
	const cacheReadTokens = toNumber(row.cache_read_tokens);
	const model = toStringValue(row.model, "unknown");
	const at = new Date(createdAt * 1000).toISOString();
	return {
		at,
		model,
		provider: UNKNOWN_PROVIDER,
		sessionId: toStringValue(row.session_id, "unknown"),
		status: toNumber(row.status_code),
		durationMs:
			latencyMs > 0 ? latencyMs : durationMs > 0 ? durationMs : undefined,
		firstTokenMs: firstTokenMs > 0 ? firstTokenMs : undefined,
		inputTokens,
		outputTokens,
		cacheReadTokens,
		totalTokens: inputTokens + outputTokens,
		costUsd: toNumber(row.total_cost_usd),
		// CC Switch prices in USD; the DeepSeek account is billed in CNY, so the
		// official DeepSeek price list is applied to the token counts instead.
		costCny: estimateCnyCost({
			at,
			cacheReadTokens,
			inputTokens,
			model,
			outputTokens,
		}),
		dataSource: toStringValue(row.data_source, "unknown"),
	};
}

/**
 * Reads Codex rows, newest first.
 *
 * `deepseekOnly` keeps the `LIKE '%deepseek%'` filter the /deepseek page has always
 * used; omitting it returns every Codex row, which is what /all needs.
 */
export function readCodexRows(options: {
	deepseekOnly: boolean;
}): CodexRequestRow[] {
	const modelFilter = options.deepseekOnly
		? "AND lower(model) LIKE '%deepseek%'"
		: "";
	const rows = queryRows<CcSwitchRow>(
		`SELECT
			model,
			input_tokens,
			output_tokens,
			cache_read_tokens,
			total_cost_usd,
			latency_ms,
			first_token_ms,
			duration_ms,
			status_code,
			data_source,
			session_id,
			created_at
		FROM proxy_request_logs
		WHERE app_type = 'codex' ${modelFilter}
		ORDER BY created_at DESC`
	);
	// Left unlabelled on purpose: the caller decides what this row's upstream is.
	// CC Switch stores Codex traffic without the upstream, and the answer depends on
	// which session the row came from, so it cannot be decided here.
	return rows.map(toRow);
}
