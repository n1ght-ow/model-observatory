import { NextResponse } from "next/server";
import { getCurrentCodexProfile } from "@/lib/cc-switch/profile";
import { listMetricSources, resolveActiveSource } from "@/lib/metrics/source";

export const dynamic = "force-dynamic";

export async function GET() {
	const [active, profile] = await Promise.all([
		resolveActiveSource(),
		getCurrentCodexProfile(),
	]);
	return NextResponse.json(
		{
			active,
			profile,
			sources: listMetricSources().map((source) => ({
				id: source.id,
				label: source.label,
				capabilities: source.capabilities,
			})),
		},
		{ headers: { "Cache-Control": "no-store" } }
	);
}
