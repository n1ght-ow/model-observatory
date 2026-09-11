This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Monitoring data sources

The dashboard monitors two independent API paths:

- **DeepSeek API** — native requests to `https://api.deepseek.com/`. Request
  data comes from CC Switch's `proxy_request_logs` session sync, and account
  balance comes from `GET https://api.deepseek.com/user/balance`, which
  reports the real account currency (CNY for a Chinese account).

### Only native api.deepseek.com traffic

CC Switch stores Codex session logs as `codex_session` rows that keep the model
but **not** the upstream, so `model LIKE '%deepseek%'` alone mixes three very
different paths: DeepSeek's own API, the Codex Router forwarding to DeepSeek,
and the Codex Router forwarding to Command Code. `/deepseek` keeps only the
first, and `src/lib/codex/session-upstream.ts` decides which is which:

1. Every Codex rollout file opens with a `session_meta` record naming its
   `model_provider`; `~/.codex/config.toml` maps that name to a base URL, and a
   `deepseek.com` host means native.
2. Sessions on the `codex-router` provider are otherwise ambiguous, so each row
   is matched against the router's own `~/.codex/codex-router/usage-events.jsonl`
   by model, output token count and a ±3 s window. That log names the provider
   the router finally used — `deepseek` (native) or `commandcode`. A session
   drives one provider profile, so it is classified as a whole: the strongest
   row match wins, and a session with no exact match falls back to the provider
   the router used for the same models around the session's own time span.

The page shows a banner with the split, so the exclusion is auditable. Of the
current 2,835 DeepSeek-model rows:

| Upstream | Rows | Counted |
| --- | --- | --- |
| Codex session configured for `https://api.deepseek.com/` | 899 | yes |
| Codex Router, forwarded to DeepSeek | 494 | yes |
| Codex Router, forwarded to Command Code | 316 | no |
| `api.apikey.fun` and other hosts | 1,123 | no |
| Codex session missing from `~/.codex/sessions` | 3 | no |

### DeepSeek spend is an estimate

The official DeepSeek API has **no** usage or cost endpoint — only
`/user/balance`. Probing `/user/usage`, `/user/billing`,
`/dashboard/billing/usage`, `/v1/dashboard/billing/subscription` and similar
paths all return 404, and third-party trackers report the same. The `Spent` rows
in the `Balance and spend` table on `/deepseek` are therefore computed here from
the token counts in CC Switch's `proxy_request_logs`, priced with DeepSeek's
**official CNY price list** instead of CC Switch's USD estimate:

- `src/lib/deepseek/cny-pricing.ts` holds the table copied from
  [api-docs.deepseek.com](https://api-docs.deepseek.com/zh-cn/quick_start/pricing)
- cached and uncached input are separated (`miss = inputTokens − cacheReadTokens`)
  because DeepSeek charges them at very different rates
- peak hours (北京时间周一至周五 09:00–12:00 与 14:00–18:00) bill at the peak rate,
  everything else at the off-peak rate, which is exactly half
- unknown model names fall back to Flash prices

The rows are labelled `(est.)` and link to the price list, because they remain
an estimate — DeepSeek bills the account directly and this dashboard never sees
the invoice.

### DeepSeek Harness traffic

Requests the harness itself makes never reach Codex, so neither CC Switch nor
the router sees them. DSH does record them though: every session log in
`~/.dsh/sessions/<project>/<session>/session*.jsonl` carries the provider, the
model and the token usage on each `assistant/message` record.
`src/lib/dsh/session-usage.ts` reads those logs — Zstandard frame by frame,
following DSH's own container format — and feeds two places:

- `/deepseek` **merges** the turns served by `deepseek-official` into the same
  metrics as the CC Switch rows, so that page is the whole machine's native
  `api.deepseek.com` traffic. The harness never goes through the Codex Router,
  so the two halves never describe the same request and nothing is double
  counted. Merged rows are tagged `DeepSeek API · Harness` in the API column so
  they stay distinguishable and filterable.
- the **DeepSeek Harness** tab on `/`, `/requests` and `/models` (source id
  `harness`) lists every upstream the harness used — `command-code`,
  `deepseek-official`, `opencode-go`, `b-ai` — because the other tabs cannot
  show harness traffic at all.

DSH reports `inputTokens` as the *uncached* prompt and lists the cached part
separately, unlike CC Switch where the input count already contains it; the
reader normalises both into "total prompt + output".

#### Live updates

The harness data is as live as the rest of the dashboard. DSH appends each finished turn
to its session log immediately (a measured read found the newest usage record
0 s old), the page re-renders every 5 s, and the reader keeps up because it
re-reads almost nothing:

- a file whose size and mtime are unchanged is answered from cache without
  touching the disk, so a poll only reads the session currently being written
  instead of all ~30 MB of history
- a growing file decodes only the Zstandard frames appended since the last read
- the file list is re-scanned at most every 4 s, so a newly started session or a
  subagent session appears on its own

Measured end to end: the newest event is about 3 s old when `/api/metrics`
answers, and the counter advances while the harness is mid-turn. A request that
took ~1,070 ms before this caching took ~110 ms after it.

Real per-month cost is only available from DeepSeek's private dashboard
endpoints, which need a `platform.deepseek.com` **browser session token**
rather than an API key:

- `GET https://platform.deepseek.com/api/v0/usage/cost?month=<m>&year=<y>`
- `GET https://platform.deepseek.com/api/v0/usage/amount?month=<m>&year=<y>`

They are undocumented, can change without notice, and are not wired in yet.
- **Codex Router API** — requests routed through
  `http://127.0.0.1:4202/v1`, read from
  `~/.codex/codex-router/usage-events.jsonl`.

The active source is detected from the current CC Switch Codex profile
(`deepseek-direct-local` → DeepSeek API, `codex-router-local` → Codex Router
API). You can switch sources manually on `/`, `/requests` and `/models` —
including **DeepSeek Harness**, the third tab, which is not profile-backed: it
reads `~/.dsh/sessions` and lists every turn the harness itself sent upstream,
with `provider` as the API column (`command-code`, `deepseek-official`, …).
Because it is session data it also becomes visible immediately — the log
updates while a turn is still running.

All dashboard data refreshes every 5 seconds. The DeepSeek balance endpoint is
cached for 30 seconds to avoid calling the official API too frequently.

### JSON API

- `GET /api/sources` — active source, CC Switch profile, and capability matrix
- `GET /api/metrics?source=deepseek|router|harness&days=7&limit=400` — unified metrics
- `GET /api/command-code` — Command Code account, usage, credits and limits

`source=harness` is the same snapshot shape as the other two sources, built from
the session logs; its records carry no status code (the log has none) and a
`durationMs` measured from the turn's `step/start`.

`/api/metrics` also carries `dsh` (DeepSeek Harness usage per upstream
provider) and, for the DeepSeek source, `upstream` (how many requests were kept
and which were excluded).

The DeepSeek API key is read server-side from `DEEPSEEK_API_KEY` first, then
from `~/.codex/codex-router/deepseek-api-key.secret`. The key is never returned
by any endpoint.

## Command Code

`/command-code` tracks the [Command Code](https://commandcode.ai) account that
backs the `commandcode` provider. Four endpoints on
`https://api.commandcode.ai` are combined into one report:

| Endpoint | Data |
| --- | --- |
| `/alpha/whoami` | account name, username, email, user id |
| `/alpha/usage/summary` | requests, success rate, tokens, credits spent |
| `/alpha/billing/credits` | remaining credits plus the pacing windows |
| `/alpha/billing/subscriptions` | plan, status and billing cycle |

### Limit windows

Command Code paces billing with three windows, all shown as progress bars with
their reset countdown:

- **5-hour window** — rolling `windowLimits.fiveHour` (`used` / `cap` credits)
- **Weekly limit** — rolling `windowLimits.weekly`
- **Monthly limit** — the current billing cycle: spent credits from
  `usage/summary` over `spent + credits.monthlyCredits`, resetting at
  `subscriptions.currentPeriodEnd`

Bars are green below 60%, amber from 60% and red from 85%. When
`windowLimits.limited` is `false` the page shows **unlimited** — extra credits
are never paced. A compact version of the same card is rendered on **Overview**
only; the DeepSeek and Models pages stay scoped to their own provider.

### Credential

The API key is resolved server-side, in order:

1. `COMMAND_CODE_API_KEY`, then `COMMANDCODE_API_KEY` in the environment
2. `~/.dsh/.credentials.yaml` (`refs.COMMAND_CODE_API_KEY`)
3. `~/.config/commandcode/credentials.yaml`, `~/.config/commandcode/config.json`,
   `~/.commandcode/credentials.json`

Only a masked preview (`user_XXXX...XXXX`) and the source path are ever
returned. The report is cached in-process for 30 seconds (120 seconds after a
failure); `GET /api/command-code?fresh=1` bypasses the cache and is what the
**JSON** buttons on the page link to.

## System tray app

`tray/` holds a native WinForms host (`RouterMonitorTray.exe`) that lives in the
notification area and opens the dashboard in a **WebView2** flyout pointed at
`http://127.0.0.1:3000`.

**The flyout is the web app.** It does not imitate the dashboard, it renders it:
there is no drawing code in `tray/` at all. The panel is a borderless window whose
only child is a WebView2 control showing the same URL a browser would show, so the
two surfaces cannot drift apart. Everything that used to be reproduced by hand —
the design tokens, the card geometry, the table layout, the Geist faces and their
kerning, the lucide icon paths, the Cmd-K dialog — is now simply the page.

### What that replaced

The previous tray was a GDI+ re-implementation of the whole front end: 19 C#
files and 9,824 lines, including a 79 KB base64 kerning table, four embedded Geist
faces, hand-copied lucide icon paths and a table auto-layout algorithm, all held in
place by a pixel-diff tool that scored the panel against browser screenshots.

|  | Hand-drawn (before) | WebView2 (now) |
| --- | --- | --- |
| `tray/*.cs` | 9,824 lines / 19 files | **1,592 lines / 3 files** |
| Compiler | `csc.exe` (.NET Framework) | `csc.exe` — unchanged |
| Executable | 530 KB | 55 KB (+ WebView2 DLLs) |
| Fidelity | hand-matched, pixel by pixel | identical by construction |
| When the web UI changes | re-measure and re-sync by hand | nothing to do |

Across the whole change: **11,201 lines deleted, 547 added.**

### Viewport

The page is laid out at exactly **1688x935 CSS pixels** — the size the reference
screenshots were taken at — so the flyout never falls into the app's responsive
layout. WebView2 already scales content by the display scale, so the flyout keeps
`ZoomFactor` at **1.0** (exactly the browser's rendering) and sizes the window to
`1688 x 935 x display scale`. On this machine (2560x1600 at 150%) that is a
2532x1402 window whose page reports `innerWidth x innerHeight = 1688x935` and
`devicePixelRatio = 1.5` — the same numbers a maximised browser gives.

Option (a) of the two allowed was chosen: the panel's physical size is the CSS size
times the display scale, and it only shrinks — never re-lays-out — if it would not
fit the work area, by lowering the window size and `ZoomFactor` together so the
CSS viewport stays 1688x935.

### Performance

The host process is idle-cheap and stays warm. Before the panel is ever opened the
tray is a single **32 MB** process with **no Chromium at all** — the WebView2 is
created lazily on the first open. From then on it is **suspended, never destroyed**,
and the Node server is started on demand and left running. Nothing is torn down when
the flyout closes, so opening it again never pays a cold start.

Measured by `scripts/verify-tray.ps1` (see `logs/verify/report.txt`):

| Scenario | Measured | Budget |
| --- | --- | --- |
| Click tray icon → panel visible | same frame (it is a `Show()`) | 200 ms |
| Reopen after suspend (warm resume) | **37–39 ms** | 200 ms |
| In-panel navigation (click a sidebar link → route changed) | **45–47 ms** | no perceptible stall |
| First open of the day | 1–3 s, with a loading label | 5 s |
| Hidden CPU | **0 ms per 0.5 s sample** (median) | ≈ 0 |
| Visible CPU | 0–450 ms per 0.5 s sample | — |
| Tray process | 53–63 MB | — |
| WebView2 while hidden | 20–25 MB resident / 219 MB committed | 450 MB |
| WebView2 while visible | 437 MB resident / 380–495 MB committed | 450 MB |

The reopen and interaction numbers are the ones that matter. Navigation inside the
panel is handled by the React app itself — the tray adds nothing to the path, which
is exactly why clicking a filter or a sidebar link costs the same as it does in a
browser tab.

While the panel is hidden the working set collapses to ~20 MB because Windows trims
a suspended process; the ~219 MB that stays committed is what makes the resume 37 ms
instead of a cold start. Chromium accepts the suspend (`suspend hidden: suspended`)
and holds it at **zero CPU**.

For the first open of the day the CLI reports 1–3 s: creating the WebView2
environment and starting the Node host are both one-time costs. `/deepseek` is the
slowest page to paint at any time (~2.6 s) because that route renders its whole
report server-side.

The tray does **not** kill the WebView2 or the Node server when the panel closes.
Doing so would turn every reopen into that 1–3 s cold start and is the failure mode
this design exists to avoid.

### Building

```powershell
# one-time: pull the pinned WebView2 SDK into tray\lib
powershell -ExecutionPolicy Bypass -File scripts\fetch-webview2.ps1

powershell -ExecutionPolicy Bypass -File scripts\build-tray.ps1            # compile only
powershell -ExecutionPolicy Bypass -File scripts\install-tray.ps1 -Start   # build, install, launch
```

The build still uses the .NET Framework compiler that ships with Windows, so no
.NET SDK is needed; the only third-party references are the two WebView2 managed
assemblies and their native loader, pinned to **1.0.4191.47** — the SDK matching
the WebView2 Runtime that Edge ships here (152.0.4191.66). `fetch-webview2.ps1`
downloads that exact package from NuGet rather than borrowing a copy from another
product's install directory, whose version would not be under our control.

### Verification

```powershell
powershell -ExecutionPolicy Bypass -File scripts\verify-tray.ps1
```

One command produces `logs/verify/report.txt` with the rendered viewport and DPR,
a screenshot of all five pages taken from the real flyout, the cold and warm open
latencies, whether Chromium accepted the suspend, and process/CPU samples while the
panel is visible and while it is hidden. It counts only the Chromium processes
descended from the tray itself, so other applications' WebView2 instances are not
blamed on this one.

`install-tray.ps1` writes the desktop shortcut, drops an autostart shortcut in the
user's Startup folder (an ONLOGON scheduled task would require elevation) and
starts the app. It also removes the web host's logon task if one exists.

Tray behaviour:

- Left-click the icon, or pick **打开面板**, to open the flyout; it hides again when
  it loses focus, `Esc` closes it, and **固定面板** pins it open.
- Double-click, or pick **打开网页版**, to open the full dashboard in the browser.
- **立即刷新** reloads the page in place.
- **开机自动启动** toggles the Startup-folder shortcut.
- When `http://127.0.0.1:3000` is not answering, the tray starts the hidden host
  itself by running `scripts\start-dashboard.ps1`.

The data-source switcher (DeepSeek API / Codex Router API / DeepSeek Harness) is no
longer in the tray menu: the real page carries it in its header, and duplicating it
would mean two places to keep in sync.

`start-dashboard.ps1` ends in `$server.WaitForExit()`, so it never returns. The
host launches it detached and never waits on it — a `WaitForExit()` there would
block the UI thread forever with no error. The script is safe to call repeatedly:
it exits immediately when the port is already listening, and the host additionally
fires it at most once per process so a long `npm run build` cannot be started twice.

### Escaping the flyout

The page itself has no idea it is in a tray, so a small bridge script is injected on
document creation. It listens for `Escape` on the capture phase and posts
`rm:close` to the host **only when no dialog, listbox or menu is open** — so
`Escape` unwinds an open Cmd-K dialog first and only a bare panel hides the flyout,
which is the behaviour the hand-drawn panel had.

### Diagnostics

Evidence modes drive the real flyout and write a report file, because a `winexe`
has no console of its own:

```powershell
dist\tray\RouterMonitorTray.exe --probe --report logs\verify\probe.txt
dist\tray\RouterMonitorTray.exe --shot  preview\tray\overview.png --page /
dist\tray\RouterMonitorTray.exe --cycle preview\tray\cycle.png --report logs\verify\cycle.txt --hold 30000
```

`--probe` prints the viewport, DPR, page title, WebView2 core version and whether
the Escape bridge was installed. `--shot` opens the flyout on `--page` and saves it
as it appears on screen. `--cycle` opens the panel, times an in-panel navigation,
hides it for `--hold` milliseconds while sampling CPU and memory, reopens it and
prints the warm resume latency. `--report` writes the same lines to a file.

`reference/` holds the four browser screenshots the hand-drawn panel was originally
measured against. They are kept as a record of that work; nothing reads them now.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
