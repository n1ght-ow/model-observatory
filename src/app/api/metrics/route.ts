import { NextResponse } from "next/server";
import {
	getMetricsSnapshot,
	parseMetricSource,
	resolveActiveSource,
} from "@/lib/metrics/source";

export const dynamic = "force-dynamic";

function parseWindowDays(value: string | null): number {
	if (!value || value === "all") {
		return 0;
	}
	const numeric = Number.parseFloat(value);
	if (!Number.isFinite(numeric)) {
		return 7;
	}
	return Math.min(Math.max(Math.trunc(numeric), 1), 90);
}

export async function GET(request: Request) {
	const { searchParams } = new URL(request.url);
	const source =
		parseMetricSource(searchParams.get("source")) ?? (await resolveActiveSource());
	const windowDays = parseWindowDays(
		searchParams.get("days") ?? searchParams.get("range")
	);
	const provider = searchParams.get("provider");
	const model = searchParams.get("model");
	const requestedLimit = Number(searchParams.get("limit") ?? "400");
	const recentCount = Number.isFinite(requestedLimit)
		? Math.min(Math.max(Math.trunc(requestedLimit), 1), 1000)
		: 400;

	const snapshot = await getMetricsSnapshot(source, {
		windowDays,
		filters: {
			provider: provider || null,
			model: model || null,
		},
		recentCount,
	});

	return NextResponse.json(snapshot, {
		headers: { "Cache-Control": "no-store" },
	});
}
