// Captures the browser pages the tray is compared against.
//
// Both surfaces use the app's default light theme (theme-provider.tsx stores
// "light" unless the user picks dark). The viewport is 1688x935 CSS pixels: the
// width is the maintainer's reference viewport, where the web's max-w-80rem page
// block is capped and centred so the grid is 1232 wide at x=356, and the height
// is that viewport's page area. The tray's own surface is 1688x981 because it
// carries a 46px control strip the browser does not have, which the comparison
// skips.
//
// Usage: node scripts/capture-web-reference.js [baseUrl] [outDir]
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const baseUrl = process.argv[2] || "http://127.0.0.1:3000";
const outDir = process.argv[3] || "D:/dashboard/logs";

const pages = [
  { path: "/", name: "overview" },
  { path: "/requests", name: "requests" },
  { path: "/models", name: "models" },
  { path: "/deepseek", name: "deepseek" },
  { path: "/command-code", name: "command-code" },
];

const rectOf = (el) => {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
};

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1688, height: 935 },
    deviceScaleFactor: 1,
  });
  await context.addInitScript(() => {
    try {
      window.localStorage.setItem("router-monitor-theme", "light");
    } catch (error) {
      /* private mode: light is the default anyway */
    }
  });
  const page = await context.newPage();
  const geometry = {};

  for (const entry of pages) {
    await page.goto(baseUrl + entry.path, { waitUntil: "networkidle", timeout: 60000 });
    await page.waitForTimeout(1500);
    const dark = await page.evaluate(() => document.documentElement.classList.contains("dark"));
    geometry[entry.name] = await page.evaluate((rectSource) => {
      const R = eval("(" + rectSource + ")");
      return [...document.querySelectorAll('[data-slot="card"]')].map((card) => {
        const title = card.querySelector('[data-slot="card-title"]');
        return { title: title ? title.textContent.trim() : "", ...R(card) };
      });
    }, rectOf.toString());
    const file = path.join(outDir, "web-" + entry.name + ".png");
    await page.screenshot({ path: file, fullPage: false });
    console.log("captured " + file + " (dark=" + dark + ", " + geometry[entry.name].length + " cards)");
  }

  fs.writeFileSync(path.join(outDir, "web-geometry.json"), JSON.stringify(geometry, null, 1), "utf8");
  await browser.close();
})().catch((error) => {
  console.error("capture failed: " + error.message);
  process.exit(1);
});
