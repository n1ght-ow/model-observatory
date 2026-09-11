import { getCurrentCodexProfile } from "@/lib/cc-switch/profile";
import { getCommandCodeReport } from "@/lib/commandcode/client";
import { AllSource } from "@/lib/metrics/sources/all-source";
import { DeepSeekSource } from "@/lib/metrics/sources/deepseek-source";
import { HarnessSource } from "@/lib/metrics/sources/harness-source";
import { RouterSource } from "@/lib/metrics/sources/router-source";
import type {
	MetricCapabilities,
	MetricSourceId,
	MetricsSnapshot,
	SnapshotOptions,
} from "@/lib/metrics/types";

export interface MetricSource {
	id: MetricSourceId;
	label: string;
	capabilities: MetricCapabilities;
	getSnapshot(options: SnapshotOptions): Promise<MetricsSnapshot>;
}

const sources: Record<MetricSourceId, MetricSource> = {
	all: new AllSource(),
	deepseek: new DeepSeekSource(),
	router: new RouterSource(),
	harness: new HarnessSource(),
};

export function getMetricSource(id: MetricSourceId): MetricSource {
	return sources[id];
}

/**
 * The three real readers. "all" is deliberately absent: \`/api/sources\` reports where
 * data comes from, and "all" is a view over those readers rather than a fourth source.
 */
export function listMetricSources(): MetricSource[] {
	return [sources.deepseek, sources.router, sources.harness];
}

/**
 * Picks the source a page opens with when the URL does not name one. Only the
 * two profile-backed sources can be active; the harness is a separate data path
 * that is always chosen explicitly.
 */
export async function resolveActiveSource(): Promise<MetricSourceId> {
	const profile = await getCurrentCodexProfile();
	return profile?.kind === "router" ? "router" : "deepseek";
}

/** Parses a `?source=` value, or null when it names no known source. */
export function parseMetricSource(value: unknown): MetricSourceId | null {
	return value === "all" ||
		value === "deepseek" ||
		value === "router" ||
		value === "harness"
		? value
		: null;
}

export async function getMetricsSnapshot(
	id: MetricSourceId,
	options: SnapshotOptions = {}
): Promise<MetricsSnapshot> {
	const [snapshot, commandCode] = await Promise.all([
		getMetricSource(id).getSnapshot(options),
		// A Command Code outage must never break the router or DeepSeek views.
		getCommandCodeReport().catch(() => null),
	]);
	return { ...snapshot, commandCode };
}
