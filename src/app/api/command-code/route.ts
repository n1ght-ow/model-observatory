import { NextResponse } from "next/server";
import { getCommandCodeReport } from "@/lib/commandcode/client";

export const dynamic = "force-dynamic";

/**
 * `GET /api/command-code` — Command Code account usage, credits and the
 * 5-hour / weekly / monthly paced windows.
 *
 * Pass `?fresh=1` to bypass the 30 second in-process cache. The API key is
 * never returned; only a masked preview is exposed.
 */
export async function GET(request: Request) {
	const { searchParams } = new URL(request.url);
	const fresh = searchParams.get("fresh");
	const report = await getCommandCodeReport({ force: fresh === "1" });
	return NextResponse.json(report, {
		headers: { "Cache-Control": "no-store" },
	});
}
