


/**
 * The desktop verifies this marker before trusting its loopback data service.
 * Keep it in step with the check in desktop/main.cjs.
 */
const APP_ID = "router-monitor-dashboard";

export async function GET() {
	return Response.json(
		{ app: APP_ID, v: 1, ok: true, at: new Date().toISOString() },
		{ headers: { "Cache-Control": "no-store" } }
	);
}
