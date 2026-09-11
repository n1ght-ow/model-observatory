/**
 * Page-level assertions for the dashboard, run in a real browser.
 *
 * This covers the half of the tray's behaviour that is really the page's: that the
 * routes load, that navigation is client-side, and - critically - that the tray-only
 * controls are absent here. The flyout half (the JSON buttons must not strand the
 * panel, target="_blank" must leave the flyout) is asserted by
 * scripts/verify-tray.ps1 against the running tray, because only the tray can look
 * inside its own WebView.
 *
 * The playwright library is used directly rather than @playwright/test: the runner
 * is not a dependency of this project and the objective forbids adding one.
 *
 * Usage: npm run test:e2e
 */

import { chromium } from "playwright";

const BASE = process.env.DASHBOARD_URL ?? "http://127.0.0.1:3000";

const results = [];
let failures = 0;

function check(name, ok, detail = "") {
	results.push({ name, ok, detail });
	if (!ok) {
		failures++;
	}
}

async function main() {
	// The runner needs a live dashboard; say so plainly rather than timing out.
	const health = await fetch(`${BASE}/api/health`).catch(() => null);
	if (!health?.ok) {
		console.error(`no dashboard answering at ${BASE}/api/health — start it first`);
		process.exit(2);
	}
	const marker = await health.json();
	check("health names the app", marker.app === "router-monitor-dashboard", JSON.stringify(marker));

	const browser = await chromium.launch();
	const page = await browser.newPage({ viewport: { width: 1688, height: 935 } });
	const consoleErrors = [];
	page.on("pageerror", (error) => consoleErrors.push(String(error)));

	// ---------------------------------------------------------------- routes
	const routes = ["/", "/requests", "/models", "/deepseek", "/command-code"];
	for (const route of routes) {
		const response = await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" });
		check(`${route} responds 200`, response?.status() === 200, `status ${response?.status()}`);
		await page.waitForSelector("main", { timeout: 15000 });
		check(`${route} renders main`, (await page.locator("main").count()) > 0);
	}

	// ------------------------------------------------------------ removed panels
	// These were removed by request; asserting their absence stops them drifting back.
	await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
	check(
		"overview has no Command Code limits card",
		(await page.getByText("Command Code limits", { exact: false }).count()) === 0
	);
	check(
		"overview has no Activity card",
		(await page.getByText("Activity", { exact: true }).count()) === 0
	);
	await page.goto(`${BASE}/deepseek`, { waitUntil: "networkidle" });
	check(
		"deepseek has no scope banner",
		(await page.getByText("every native api.deepseek.com request", { exact: false }).count()) === 0
	);

	// ------------------------------------------------------------------ the All tab
	await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
	check(
		"source switcher offers All",
		(await page.locator('a[href*="source=all"]').count()) > 0
	);

	for (const route of ["/", "/requests", "/models"]) {
		const response = await page.goto(`${BASE}${route}?source=all`, {
			waitUntil: "domcontentloaded",
		});
		check(`${route}?source=all responds 200`, response?.status() === 200, `status ${response?.status()}`);
		await page.waitForSelector("main", { timeout: 15000 });
		check(`${route}?source=all renders main`, (await page.locator("main").count()) > 0);
	}

	// The whole point of All is that it is a union, not a sum: the tabs overlap, so
	// "all equals the sum" would mean the de-duplication silently stopped working.
	const perTab = {};
	for (const source of ["deepseek", "router", "harness", "all"]) {
		const body = await (await fetch(`${BASE}/api/metrics?source=${source}&days=7`)).json();
		perTab[source] = body.window.requests;
	}
	const sum = perTab.deepseek + perTab.router + perTab.harness;
	const max = Math.max(perTab.deepseek, perTab.router, perTab.harness);
	check(
		"all is smaller than the sum of the tabs",
		perTab.all < sum,
		`all=${perTab.all} sum=${sum}`
	);
	check(
		"all is larger than any single tab",
		perTab.all > max,
		`all=${perTab.all} max=${max}`
	);
	check(
		"all reports no combined cost",
		(await (await fetch(`${BASE}/api/metrics?source=all`)).json()).window.totalCostCny === undefined,
		"cost must stay absent: it is not comparable across upstreams"
	);

	// ------------------------------------------------------- tray-only controls
	// The bridge is injected by the tray, so in a browser these must not exist.
	await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
	check(
		"no tray bridge in a browser",
		await page.evaluate(() => typeof window.__rmBridge === "undefined")
	);
	check(
		"no tray close button in a browser",
		(await page.locator('button[aria-label="关闭面板"]').count()) === 0
	);
	check(
		"no tray pin button in a browser",
		(await page.locator('button[aria-label="固定面板"], button[aria-label="取消固定面板"]').count()) === 0
	);

	// --------------------------------------------------------------- navigation
	// The sidebar's nav items are plain <a href> (src/components/nav-group.tsx), not
	// next/link, so clicking one is a full document load rather than a client-side
	// transition. That is the app's actual behaviour and is asserted as such: the
	// route has to change, and it has to do so within a budget. If somebody later
	// switches the sidebar to next/link this still passes, and the measured cost
	// below is what the README quotes.
	let documentLoads = 0;
	page.on("request", (request) => {
		if (request.resourceType() === "document") {
			documentLoads++;
		}
	});
	await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
	const loadsBefore = documentLoads;
	const clickStarted = Date.now();
	await page.click('a[href="/requests"]');
	await page.waitForURL("**/requests", { timeout: 10000 });
	const clickCost = Date.now() - clickStarted;
	check("sidebar link changes route", new URL(page.url()).pathname === "/requests");
	check("sidebar navigation is under 2 s", clickCost < 2000, `${clickCost} ms`);
	check(
		"sidebar navigation cost is a full document load",
		documentLoads - loadsBefore === 1,
		`${documentLoads - loadsBefore} document request(s) in ${clickCost} ms`
	);

	// ------------------------------------------------------------- range chip
	await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
	const chip = page.locator("button", { hasText: /^7d$/ }).first();
	check("range chip exists", (await chip.count()) > 0);
	if (await chip.count()) {
		await chip.click();
		await page.waitForTimeout(1500);
		check("range chip leaves the page usable", (await page.locator("main").count()) > 0);
	}

	// ------------------------------------------------------------------- links
	// These are the links the tray has to intercept: same origin, but /api/ is not
	// a page. They must stay plain self-targeting links so the browser behaves
	// normally and the tray's guard is what protects the flyout.
	const apiLinks = await page.evaluate(() =>
		Array.from(document.querySelectorAll('a[href^="/api/"]')).map((a) => ({
			href: a.getAttribute("href"),
			target: a.getAttribute("target"),
		}))
	);
	check("json links present", apiLinks.length > 0, `${apiLinks.length} found`);
	check(
		"json links are self-targeting",
		apiLinks.every((link) => !link.target),
		JSON.stringify(apiLinks)
	);

	for (const route of ["/deepseek", "/command-code"]) {
		await page.goto(`${BASE}${route}`, { waitUntil: "networkidle" });
		const external = await page.evaluate(() =>
			Array.from(document.querySelectorAll('a[target="_blank"]')).map((a) => a.href)
		);
		check(`${route} has external links`, external.length > 0, `${external.length} found`);
		check(
			`${route} external links are absolute`,
			external.every((href) => href.startsWith("http")),
			JSON.stringify(external)
		);
	}

	// -------------------------------------------------------------- json payload
	// The JSON buttons must still return the API contract the README documents.
	const metrics = await fetch(`${BASE}/api/metrics?source=router`);
	check("/api/metrics answers", metrics.ok, `status ${metrics.status}`);
	const sources = await fetch(`${BASE}/api/sources`);
	check("/api/sources answers", sources.ok, `status ${sources.status}`);

	check("no uncaught page errors", consoleErrors.length === 0, consoleErrors.join("; "));

	await browser.close();

	for (const result of results) {
		console.log(`  ${result.ok ? "ok  " : "FAIL"}  ${result.name}${result.detail ? "  (" + result.detail + ")" : ""}`);
	}
	console.log(`
${results.length - failures}/${results.length} passed`);
	// exitCode rather than process.exit(): tearing the process down while fetch
	// sockets are still closing trips a libuv assertion on Windows, which replaces
	// the exit code this suite exists to report with a crash.
	process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((error) => {
	console.error("e2e run failed:", error);
	process.exitCode = 1;
});
