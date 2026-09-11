import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Identity marker for the tray.
 *
 * The tray cannot tell "our dashboard is up" from "something else took port
 * 3000" by looking at a status code - a foreign service answering 404 to
 * /api/sources proves only that a foreign service is there. This endpoint names
 * the application, and both the tray (ServerHost.IsServing) and
 * scripts/start-dashboard.ps1 check it before believing the port is theirs.
 *
 * Keep APP_ID in step with TrayIdentity.AppId in tray/ServerHost.cs.
 */
export const APP_ID = "router-monitor-dashboard";

export async function GET() {
	return NextResponse.json(
		{ app: APP_ID, v: 1, ok: true, at: new Date().toISOString() },
		{ headers: { "Cache-Control": "no-store" } }
	);
}
