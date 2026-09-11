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
- `GET /api/health` — application identity marker, used by the tray to tell our
dashboard apart from anything else that happens to hold the port

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
| `tray/*.cs` | 9,824 lines / 19 files | **1,592 lines / 3 files** at the port; 4,648 / 11 now — see "Where the extra lines went" |
| Compiler | `csc.exe` (.NET Framework) | `csc.exe` — unchanged |
| Executable | 530 KB | 55 KB (+ WebView2 DLLs) |
| Fidelity | hand-matched, pixel by pixel | identical by construction |
| When the web UI changes | re-measure and re-sync by hand | nothing to do |

Across the whole change: **11,201 lines deleted, 547 added.**

#### The flyout is four files, and the controller is owned

`PanelForm` was one 1,454 line class holding window chrome, DPI arithmetic, the
WebView lifecycle and the page protocol at once. It is four partial files by
responsibility, so a new tray capability is a region in the right file rather than a
search through one class:

| File | Lines | Holds |
| --- | --- | --- |
| `PanelForm.cs` | 615 | window chrome, dragging, placement, layout |
| `PanelForm.WebView.cs` | 531 | the WebView lifecycle |
| `PanelForm.Bridge.cs` | 299 | the page/tray protocol and navigation guards |
| `PanelForm.Scaling.cs` | 294 | display scale, drawn size, ZoomFactor |

The split moved members **verbatim** and asserted that each of the 113 members landed
in exactly one file; the executable came out the same size because no code changed in
the move.

**The controller is owned, not reflected into.** WebView2's WinForms `WebView2`
control keeps its controller in the private field `_coreWebView2Controller` and never
exposes it. Chromium only accepts a suspend while the controller reports itself
invisible, so the old code reached into that field by reflection — a private
implementation detail that would have failed silently inside `catch {}` if the SDK
ever renamed it. The tray now calls
`CoreWebView2Environment.CreateCoreWebView2ControllerAsync` against a host window it
owns and uses `IsVisible`, `Bounds`, `ZoomFactor` and `RasterizationScale`, all
public. `BoundsMode` is pinned to `UseRawPixels` so `Bounds` means what the scaling
arithmetic assumes.

Two behaviours turned out to depend on the control that was removed. Both showed up as
the panel hiding itself about 700 ms after opening, and both were found by logging
rather than guessing:

- the WinForms control was a **focusable** control. A plain `Panel` is not, so
  focusing it did nothing, the form never became the active window, and it deactivated
  — hiding itself — as soon as the process that asked for it exited. The host is now a
  small `WebHost : Panel` with `ControlStyles.Selectable`;
- the control hid its child window on suspend as well as flipping `IsVisible`.
  Flipping `IsVisible` alone left Chromium compositing: `suspend hidden: suspended`
  was still reported, but hidden CPU went from **0 to 172 ms** per 0.5 s sample. The
  host is hidden too, and the gate is back to 0.

**Display scale is read per open, and read correctly.** `dpiScale` used to be read
once in the constructor via `Graphics.FromHwnd(IntPtr.Zero)`, which reports the
*primary* monitor's DPI — the wrong answer on a mixed-DPI desktop — while
`PositionNearTray` placed the window on the monitor under the pointer. The two
disagreed about which screen this was. It now asks `GetDpiForMonitor` for the monitor
under the pointer, re-reads it whenever the panel opens, and recomputes the drawn size
if it changed.

**Measured, not assumed.** This machine has one display, so the mixed-DPI path could
not be exercised: the per-monitor reading is verified to give the same answer as before
(DPR 1.275, viewport 1689x936), and the behaviour on a second monitor at a different
scale is **untested**. Dragging the panel between monitors of different scale, or
changing the display scale while the tray runs, remains a known boundary.

`DragStripHeight` is in physical pixels and is deliberately **not** multiplied by the
scale, so the grip strip stays a constant size on screen rather than growing with the
content; every other measurement in the scaling file is scaled. That inconsistency is
intentional and is named in the source.

#### Where the extra lines went

The port left the tray at 1,592 lines in three files, all of it window chrome and
WebView plumbing. It is **4,648 lines in eleven files** now. **This is more, and the
target was less.** The objective asked for `tray/` to fit in 1,976 lines; it does not.
The honest breakdown:

| File | Lines |
| --- | --- |
| `Program.cs` (was 1,805) | 1,525 |
| `PanelForm.cs` — chrome, layout | 615 |
| `PanelForm.WebView.cs` — WebView lifecycle | 531 |
| `ControlChannel.cs` | 373 |
| `ServerHost.cs` | 370 |
| `PanelForm.Bridge.cs` — protocol, guards | 299 |
| `Diagnostics.cs` | 295 |
| `PanelForm.Scaling.cs` — DPI, zoom | 294 |
| `Settings.cs` | 184 |
| `ProcessSampler.cs` | 141 |
| `AssemblyInfo.cs` | 21 |

What did *not* grow is the diagnostic shell. `CliContext` — 460 lines of headless
driver that shipped inside the executable and duplicated probe/shot/cycle — is **gone
entirely**; `Program.cs` is 1,525 lines *while gaining* every forwarding path above,
having once been 1,805. There is no diagnostic code outside `Diagnostics.cs`, and no
`--mode` to add when a capability arrives: it is one row in
`RegisterControlHandlers()`, demonstrated above.

So where did the rest come from? Capability that did not exist — a control channel
(373), persisted settings (184), process sampling (141), the measurements themselves
(295) — plus ~400 lines of comments explaining decisions that had been silent. Roughly
1,000 lines of the 4,648 are the channel and the diagnostics. Whether that is worth it
is a judgement call, and this is not a claim that the tray got smaller. What did get
smaller is the cost of the next change: a new capability is one table row, and
verification is a command that fails rather than a report somebody has to interpret.

### Viewport and size

The page is laid out at exactly **1688x935 CSS pixels** — the size the reference
screenshots were taken at — so the flyout never falls into the app's responsive
layout. That is achieved by pairing the window size with `ZoomFactor`; the two move
together so the CSS viewport is constant while the drawn size is not.

The drawn size is **85% of the browser's own** (`UserScale` in `PanelForm.cs`; a
single constant, so it is one number to change). At 150% display scaling that means
`ZoomFactor = 0.85` and a window of **2152x1212**, whose page still reports
`innerWidth x innerHeight = 1688x935`. At 1.0 the window would be 2532x1402 — on a
2560x1600 panel that is 99% of the width and 88% of the height, i.e. effectively full
screen, which is what the original brief produced and what made the panel feel wrong
to use. 70% was tried first and read as too small, hence 85%.

If even the reduced size would not fit the work area, the window and `ZoomFactor`
are lowered together again; the **layout never changes**, only the drawn size.

### Moving the window

The panel is freely draggable. It has no title bar (`WS_CAPTION` is masked off, so
the window cannot expose one), so a **grip strip** 20 physical pixels tall sits above
the page and carries the three-bar hint; the page is placed *below* the strip so the
strip covers no content. Dragging it runs Windows' own move loop — the strip issues
`WM_NCLBUTTONDOWN` with `HTCAPTION` after releasing capture.

Two things had to give way for this, both of which were inherited from the hand-drawn
panel and were what actually blocked dragging:

- the `WM_WINDOWPOSCHANGING` / `WM_MOVING` handler used to snap the window back to
  its anchor on every reposition, so any move was undone immediately;
- `WM_SYSCOMMAND` with `SC_MOVE` was swallowed. That is the message a caption drag
  sends, so the move loop started and then died. `SC_SIZE` is still blocked.

The anchor is now only the *initial* placement. Once the window has been moved by
hand it keeps that position — across restarts, because the drag writes it to
`settings.json` — and `KeepOnScreen` pulls it back into view if it is ever dragged
off the desktop: the panel has no taskbar entry, so an off-screen window would
otherwise be unrecoverable. **重置窗口位置** in the tray menu forgets the position
and docks the panel back to the tray.

### Settings

Everything that was a compile-time constant and turned out to be a preference
lives in `%LOCALAPPDATA%\RouterMonitorTray\settings.json`:

| Field | Default | What it is |
| --- | --- | --- |
| `userScale` | `0.85` | drawn size as a fraction of the browser's own; the CSS viewport never changes |
| `dragStripHeight` | `20` | height of the grip strip above the page, in physical pixels |
| `stayOpen` | `false` | whether the flyout survives losing focus (固定面板) |
| `topMost` | `true` | always-on-top (窗口置顶) |
| `hasPosition`, `windowX`, `windowY` | unset | where the panel was last dragged to |
| `port` | `3000` | the port the local dashboard answers on |

The tray menu changes the first four live — **固定面板**, **窗口置顶**, **面板大小**
(70% / 85% / 100%) and **重置窗口位置** — and each writes the file immediately.
`userScale` and `dragStripHeight` can also be changed over the channel, which is
the same code path the menu uses, so a click and a script cannot drift:

```powershell
dist\tray\RouterMonitorTray.exe --ctl config --arg key=userScale --arg value=1.0
```

`port` is read at startup (the host script is launched with `-Port`), so changing
it needs a restart; asking the channel for it returns that as an error rather than
pretending. A missing file is the defaults; a damaged one is the defaults plus a
line in `logs/tray-init.log` and the bad file kept beside it as `settings.json.bad`.
The tray never fails to start because of this file.

### Performance

The host process is idle-cheap and stays warm. Before the panel is ever opened the
tray is a single **32 MB** process with **no Chromium at all** — the WebView2 is
created lazily on the first open. From then on it is **suspended, never destroyed**,
and the Node server is started on demand and left running. Nothing is torn down when
the flyout closes, so opening it again never pays a cold start.

Measured by `scripts/verify-tray.ps1`, which drives the running tray and **exits
non-zero when a threshold is missed**; each run appends a dated row with the commit
to [`docs/tray-evidence.md`](docs/tray-evidence.md). The tray process is the one `RouterMonitorTray.exe`;
"WebView2" counts only the Chromium processes descended from it, so other
applications' WebView2 instances are never included.

Every number below is produced by `verify-tray.ps1` on this machine
(2560x1600 @ 150%, one display). The figures quoted for the current build are from
the `docs/tray-evidence.md` row for commit `4cf9dd1`; re-run the gate to reproduce them.

| Scenario | Measured | Gate threshold |
| --- | --- | --- |
| Click tray icon → panel visible | same frame (a `Show()`) | — |
| Drag the grip → window moved | follows the pointer exactly | — |
| **Reopen after suspend** (script round-trip into the resumed renderer) | **13–24 ms** | `-MaxReopenMs` 200 |
| **Route change** (click a sidebar link → route changed) | **20–34 ms** | `-MaxRouteChangeMs` 500 |
| Rendering viewport / DPR | 1689x936 CSS px at DPR 1.275 | ±1 px of 1688x935 |
| Hidden CPU | **0 ms per 0.5 s sample** (median of 30) | `-MaxHiddenCpuMs` 20 |
| Visible CPU | 0–450 ms per 0.5 s sample | — |
| Tray process, panel never opened | 32 MB, zero Chromium processes | — |
| Tray process, panel open | 53–63 MB | — |
| WebView2 while hidden | ~27 MB resident / ~220 MB committed | — |
| WebView2 while visible | 419–449 MB resident / 368–489 MB committed | — |

The viewport is **1689x936 rather than exactly 1688x935** because the window is sized
in whole physical pixels and the viewport is that divided by the device pixel ratio.
The gate allows ±1 px and records the measured value instead of rounding it away.

**The reopen and interaction numbers are the ones that matter**, and they are the
reason this design took the shape it did: the tray adds nothing to the path, so
clicking a filter, paging the log or switching a page costs what it costs in a
browser tab.

One correction to an earlier version of this section. It said navigation inside the
panel "is handled by the React app itself", i.e. client-side. It is not: the sidebar's
nav items are plain `<a href>` (`src/components/nav-group.tsx`), not `next/link`, so
clicking one is a full document load. Measured in Chromium at 1688x935: **one document
request, 109–117 ms**, which is well inside the budget but is a real reload rather than
a client-side transition. `npm run test:e2e` asserts that cost so a regression shows
up, and asserts the route change either way, so switching the sidebar to `next/link`
later would not break the suite.

**First open is the slow case, and it is not gated.** The warm reopen is 13–24 ms
because the page is already rendered and hydrated; the *first* open of the process
has to load and hydrate and lands around 0.9 s, or 2.6–4.2 s when the Node host also
has to start. `verify-tray.ps1` reports `first content` but sets no threshold on it,
so those two figures are measurements from earlier runs rather than numbers the gate
will fail on. Gating them would need a cold-start fixture the suite does not have.

While the panel is hidden the working set collapses to ~27 MB because Windows trims
a suspended process; the ~220 MB that stays committed is exactly what makes the
resume tens of milliseconds instead of a cold start. Chromium accepts the suspend
(`suspend hidden: suspended`) and holds it at **zero CPU** — which the gate asserts,
because it is the whole reason the flyout is suspended rather than destroyed.

Interval-level detail, if a single number is not enough: `--cycle` prints a
`sample` line every 0.5 s with the process count, resident and committed memory of
our Chromium processes, the CPU delta since the previous sample, and the tray's own
working set. The median is used rather than the mean because startup samples are not
representative; the gate samples for at least `-MinHiddenSamples` (10) before it will
judge, and 30 in a default run.

`/deepseek` is the slowest page to paint at any time (~2.6 s) because that route
renders its whole report server-side; every other page is under 0.9 s.

The tray does **not** kill the WebView2 or the Node server when the panel closes.
Doing so would turn every reopen into the cold start above — that is the failure
mode this design exists to avoid.

### Building

```powershell
# one-time: pull the pinned WebView2 SDK into tray\lib
powershell -ExecutionPolicy Bypass -File scripts\fetch-webview2.ps1

powershell -ExecutionPolicy Bypass -File scripts\build-tray.ps1            # compile only
# a running tray is stopped first: replacing a live executable is what the
# compiler reports as a bare "access denied"
powershell -ExecutionPolicy Bypass -File scripts\install-tray.ps1 -Start   # build, install, launch
powershell -ExecutionPolicy Bypass -File scripts\uninstall-tray.ps1        # undo the above
```

The build uses the .NET Framework compiler that ships with Windows, so no
.NET SDK is needed; the only third-party references are the two WebView2 managed
assemblies and their native loader, pinned to **1.0.4191.47** — the SDK matching
the WebView2 Runtime that Edge ships here (152.0.4191.66). `fetch-webview2.ps1`
downloads that exact package from NuGet rather than borrowing a copy from another
product's install directory, whose version would not be under our control.

### The local server

The tray starts `scripts/start-dashboard.ps1` on demand and never waits on it: the
script ends in `$server.WaitForExit()`, so a `WaitForExit()` here would block the UI
thread forever with no error.

**Identity, not occupancy.** A listening socket and a 2xx-5xx status code both prove
only that *something* is on the port. `GET /api/health` answers
`{"app":"router-monitor-dashboard","v":1,"ok":true}` and both sides check that
marker (`ServerHost.IsServing`, `Test-DashboardHealth` in the start script). Before
this, any unrelated program on port 3000 was taken for the dashboard: the tray
navigated to it, and the start script exited 0 without ever starting anything.
Now the tray reports 本地服务：端口被占用, logs which program is in the way, gives up
after about twenty seconds instead of four minutes, and the start script refuses to
fight over a port it does not own.

**Retrying is real.** The old launcher latched a one-shot flag that only cleared if
`Process.Start` threw, so a script that ran and *failed* left the tray waiting and
never trying again. A launch is now gated on the script process itself: while it is
alive a build or the server is in progress and a second launch would only duplicate
the build, and once it has exited without the dashboard answering, opening the panel
again starts it again.

**A stopped server is recoverable.** The tray menu shows what the server is doing
(运行中 / 未运行 / 端口被占用) and carries **重启本地服务**, which stops our server
and starts it again. Opening the panel re-checks the server whenever the page is not
content-ready, so killing the server out from under a running tray no longer leaves
the flyout dead until the tray is restarted. A transition to stopped raises a
balloon once - a tray that has quietly stopped working must not look like one that is
fine.

| Command | What it does |
| --- | --- |
| `powershell -File scripts\start-dashboard.ps1` | start if our dashboard is not already serving |
| `powershell -File scripts\start-dashboard.ps1 -Restart` | stop ours and start it again |

`curl http://127.0.0.1:3000/api/health` reproduces the identity check by hand.

### Where things are found

Nothing is pinned to `D:\dashboard` any more. Every script derives the root from its
own location (`$PSScriptRoot\..`), and the tray derives it from the executable it is
running as — it is built into `<root>\dist\tray\`, so a copy of the tree works from
any path. Verified by building and running a copy at `D:\dashboard-moved`: it built,
started, and wrote its log to *its own* `logs\`, leaving the original untouched.

Node is resolved rather than hardcoded — `NODE_EXE`, then `PATH`, then the usual
install locations — because a fixed path broke the moment Node moved, which an nvm
upgrade does without warning. `npm.cmd` is derived from wherever `node.exe` was found.
A missing Node now logs what was searched and what to do, instead of naming a path
that was never going to exist.

### The executable says which build it is

`RouterMonitorTray.exe` used to report `0.0.0.0`, an empty description and no company,
which is useless for a process that runs all day — there was no way to tell which
build was on the machine. `tray/AssemblyInfo.cs` supplies the fixed attributes and
`build-tray.ps1` generates the informational version per build:

```
FileVersion     : 1.0.0.0
ProductVersion  : 1.0.0+9e3676e.dirty (2026-09-12 00:40)
FileDescription : Router Monitor Tray
ProductName     : Router Monitor
```

`git` is invoked defensively: a native command writing to stderr is a *terminating*
error under `ErrorActionPreference = Stop`, so an exported copy of the tree with no
`.git` could not be built at all. It now degrades to `1.0.0+unknown`.

### Installing and uninstalling

`install-tray.ps1` writes the desktop shortcut, drops the autostart shortcut and
starts the app. `uninstall-tray.ps1` is its other half and did not exist:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\uninstall-tray.ps1
powershell -ExecutionPolicy Bypass -File scripts\uninstall-tray.ps1 -KeepSettings -KeepLogs
```

It asks the running tray to quit **through the control channel** before touching
anything, so the WebView is suspended and disposed rather than killed — killing it is
what leaves `msedgewebview2` children holding the profile lock. It then removes the
desktop and Startup shortcuts, any legacy scheduled task, and the per-user data
(`settings.json`, the WebView2 profile, the logs). The repository and the build output
are left alone, and it says so.

### One place for logs

The crash log lived in `%TEMP%` while everything else was in `logs\`, so "what
happened?" meant knowing to look in two unrelated directories. Both are under
`logs\` now — `tray-init.log` and `tray-crash.log`.

Failures that used to disappear into an empty `catch {}` now leave a line: a missing
tray icon, an autostart shortcut that could not be written (which also raises a
balloon, because a checkbox that silently does not stick is a lie), a controller
geometry call that was rejected, a URL the shell refused to open.

### Verification

```powershell
powershell -ExecutionPolicy Bypass -File scripts\verify-tray.ps1     # the gate
npm run test:e2e                                                     # page only
```

`verify-tray.ps1` is a gate, not a report. It drives the tray that is **already
running** — through the control channel — asserts every threshold, and exits non-zero
when one is missed. Tightening a threshold is how that is checked:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\verify-tray.ps1 -MaxReopenMs 1
echo $LASTEXITCODE   # 1
```

| Threshold | Default | What it protects |
| --- | --- | --- |
| `-MaxReopenMs` | 200 | warm reopen after a suspend |
| `-MaxRouteChangeMs` | 500 | clicking a sidebar link |
| `-MaxHiddenCpuMs` | 20 | CPU per 0.5 s sample while hidden (measured: 0) |
| `-MinHiddenSamples` | 10 | that the hidden phase was actually sampled |
| `-MinShotKb` | 20 | that a screenshot is a real capture, not a blank frame |

It also asserts the rendered viewport, that the page is content-ready, that Chromium
accepted the suspend, and that the browser suite passes. Each run appends a dated row
with the commit to `docs/tray-evidence.md` — `logs/` is ignored by git, so the summary
is the part that belongs in the repository.

**The viewport is 1689x936, not 1688x935.** The layout target is 1688x935 CSS pixels,
but at 85% the window is sized in whole physical pixels and the viewport is that
divided by the device pixel ratio, so it lands one pixel wide. The gate allows ±1 px
and records the measured value rather than rounding it away. At 100% (`ZoomFactor`
1.0) it is exactly 1688x935.

`npm run test:e2e` runs page-level assertions in real Chromium via the installed
`playwright` library — the `@playwright/test` runner is not a dependency of this
project and adding one is out of scope, so the runner is a small script with its own
assertions. It covers route loads, that the tray-only controls are **absent** in a
browser, sidebar navigation and its cost, the range chip, that the JSON links stay
self-targeting, that external links stay `target="_blank"`, and that no page raises an
uncaught error.

`install-tray.ps1` writes the desktop shortcut, drops an autostart shortcut in the
user's Startup folder (an ONLOGON scheduled task would require elevation) and
starts the app. It also removes the web host's logon task if one exists.
`uninstall-tray.ps1` reverses all of it — see "Installing and uninstalling" above.

**The browser is never needed.** The tray starts the local server itself if it is
not already listening and renders the page inside its own WebView2, so the flyout
works with no browser window open and with no dashboard tab anywhere. Start the
tray and nothing else; the server comes up behind it.

If WebView2 cannot be initialised the panel says so briefly and retries, rather
than staying dead for the rest of the session, and the underlying exception is
appended to `logs/tray-init.log`. The most common cause is a previous instance
that was force-killed while Chromium was alive: the orphaned `msedgewebview2`
processes keep the profile lock until they exit on their own. `taskkill /IM
msedgewebview2.exe` clears it, but the retry means a restart is not required.

Tray behaviour:

- Left-click the icon, or pick **打开面板**, to open the flyout; it hides again when
  it loses focus, `Esc` closes it, and **固定面板** pins it open.
- Double-click, or pick **打开网页版**, to open the full dashboard in the browser.
- **立即刷新** reloads the page in place.
- **固定面板**, **窗口置顶**, **面板大小** and **重置窗口位置** are preferences:
  they are remembered in `settings.json` and take effect immediately.
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

### Control channel

The tray is driven through a named pipe, not through command line switches. The
wire format is one JSON envelope per line - `{v, id, cmd, args}` in,
`{v, id, ok, error, result}` back on the same connection - and the pipe is
per-user, so two accounts on one machine cannot drive each other's tray.

```powershell
# any command, from any script, against the tray that is already running
dist\tray\RouterMonitorTray.exe --ctl ping --report logs\verify\ping.txt
dist\tray\RouterMonitorTray.exe --ctl show
```

`--ctl <cmd>` is the only client entry point the executable has: it sends one
command and writes the answer, so a new capability never adds a switch.
`ping` reports the commands the running tray knows, so the channel is
discoverable without reading the source.

| Command | What it does |
| --- | --- |
| `ping` | build, pid, panel/webview/suspend state, whether the server is serving, command list |
| `show` / `hide` / `toggle` | open, close or flip the flyout |
| `reload` | reload the page in place |
| `probe` | viewport, DPR, page title, document size, WebView2 core, bridge state |
| `shot` | `args.path` - save the flyout as it appears on screen; `args.page` sends the panel to a dashboard route first |
| `eval` | `args.script` or `args.file` - run script inside the live flyout |
| `cycle` | `args.path`, `args.page`, `args.holdMs` - the suspend/reopen measurement |
| `config` | read the settings, or change one live |
| `quit` | tear down the way the menu's Quit does |

Arguments are passed with repeated `--arg name=value` pairs, so the channel
stays generic:

```powershell
dist\tray\RouterMonitorTray.exe --ctl config
dist\tray\RouterMonitorTray.exe --ctl config --arg key=userScale --arg value=1.0
```

Adding a command is **one row in `RegisterControlHandlers()`** in
`tray/Program.cs` and nothing else: not `Main`, not the menu, not the command
line, not the diagnostics. That is the point of the channel - it is where a new
capability goes.

#### Adding a capability: the demonstration

The objective for this work asked for one command to be added as proof that the
channel makes it cheap. `status` is that command.

**Why the page cannot do it.** The one line in the notification-area tooltip belongs
to the tray; a web page cannot write it. The page is also suspended whenever the
flyout is hidden, so the tooltip is the only place a page-derived value can sit while
nobody is looking at the panel.

**What it cost.** One row in `RegisterControlHandlers()` and one method. Nothing in
`Main`, the command line, the menu or the diagnostics learned about it — the generic
client reaches it immediately:

```powershell
dist\tray\RouterMonitorTray.exe --ctl status --arg "text=Router Monitor — Requests"
```

The page reaches the same method through the bridge, so both transports share one
implementation rather than two:

```ts
setStatus("Router Monitor — Requests");
```

The tray icon now reads `Router Monitor — Overview`, `— Requests`, and so on, so a
glance at the notification area says which page the panel is on. `TrayControls`
reports it on every route change; `WinForms` caps `NotifyIcon.Text` at 63 characters
and throws above that, so the tray trims rather than trusting the page.

Two consequences worth knowing:

- **A second launch no longer dies without a word.** It asks the running tray to
  show the panel and exits 0; with no tray running it starts one.
- **The diagnostics prefer the tray that is already running.** `--probe` and
  `--shot` (including their `--page` route) are forwarded over the channel
  whenever an instance answers, because
  standing up a second WebView2 on the same user data folder is a documented way
  to break both of them. `--cycle` still measures itself in its own process: it
  drives the panel through a visible/hidden/reopen sequence, and it moves onto
  the channel as the rest of the diagnostics do.

Quitting, logging off and shutting down all teardown the same way - the icon
goes, the WebView is suspended and disposed, and the exit is recorded in
`logs/tray-init.log` as `shutdown: <reason>`. Killing the process was what used
to leave `msedgewebview2` children holding the profile lock.

### The page/tray bridge

The flyout renders the dashboard, so the page has to know it is in a tray and be
able to ask the tray for things a browser cannot do. A script is injected on
document creation that installs `window.__rmBridge`, and **its presence is the
answer to "am I in the tray"** — `src/lib/tray/bridge.ts` is the page's half, and
`BridgeScript` in `tray/PanelForm.cs` is the tray's.

Every message is a versioned envelope, `{v:1,type:...}`, so a new message is a new
`case` on both sides rather than a new magic string.

| Page → tray | Meaning |
| --- | --- |
| `bridge` | sent by the injected script as soon as it installs |
| `ready` | the app has hydrated and can receive messages |
| `close` | hide the flyout |
| `openExternal` `{url}` | open a URL in the default browser, not in the flyout |
| `pin` `{pinned}` | pin the flyout open, or stop pinning it |

| Tray → page | Meaning |
| --- | --- |
| `state` `{pinned}` | what the tray currently is; sent in reply to `bridge` and `ready` |

The tray ignores an unknown `type` and logs it rather than failing: a page newer
than the tray should not be able to stop the flyout from opening. The pre-v1
`rm:close` string still works, so a stale cached page cannot wedge the panel.

Two things follow from the bridge being real:

- **The page knows.** In the flyout the header grows a pin and a close button
  (`src/components/tray-controls.tsx`); in a browser it renders nothing at all.
  Pinning from the page updates the tray menu and `settings.json`, because both go
  through the same handler.
- **`Escape` still unwinds a dialog first.** The injected script keeps the capture
  phase listener and only closes the panel when no dialog, listbox or menu is open.

### Staying on the dashboard

NaN
turned off, so a navigation away from the dashboard is a one way trip. Two guards
keep that from happening:

- **`NavigationStarting`** cancels anything that is not a page of this dashboard and
  hands it to the default browser. Same origin is deliberately *not* enough: the
  dashboard's own `/api/` endpoints live there too, and the four **JSON** buttons on
  `/command-code`, `/deepseek` and the source cards used to strand the panel on a
  bare API response. `Reload` is `Navigate` to the remembered dashboard route rather
  than `CoreWebView2.Reload()` — reloading the current URL reloaded the API response,
  which is why that state was previously unrecoverable.
- **`NewWindowRequested`** is handled, so `target="_blank"` links (Platform, Docs)
  open in the default browser. Left unhandled, WebView2 gives them a popup window
  with no chrome. Marking the event handled also stops the popup existing at all,
  so the flyout keeps its place.

A cancelled navigation still reports a failure to `NavigationCompleted`, which would
flash the "page failed to load" label over a navigation nobody wanted; that specific
failure is suppressed.

### Diagnostics

`--probe`, `--shot` and `--cycle` are thin clients. They are measurements of the
tray's own WebView — how long it takes to resume, what its Chromium children cost —
so they are **asked of a tray** rather than taken by a second process: standing up a
rival WebView2 on the same user data folder is a documented way to break both of them.
If no tray is running, one is started (fully detached, via `Win32_Process.Create`) and
measured. A diagnostic therefore never leaves a temporary process behind, and there is
no diagnostic code in the executable outside `Diagnostics.cs`.

```powershell
dist\tray\RouterMonitorTray.exe --probe --report logs\verify\probe.txt
dist\tray\RouterMonitorTray.exe --shot  preview\tray\overview.png --page /
dist\tray\RouterMonitorTray.exe --cycle preview\tray\cycle.png --report logs\verify\cycle.txt --hold 30000
```

`--probe` prints the viewport, DPR, page title, WebView2 core version, the bridge
protocol version and the last bridge message. `--shot` opens the flyout on `--page`
and saves it as it appears on screen. `--cycle` opens the panel, times an in-panel
navigation, hides it for `--hold` milliseconds while sampling CPU and memory, reopens
it and prints the warm resume latency. `--report` writes the same lines to a file.

Each one is also reachable over the channel as `probe`, `shot` and `cycle`, and that
is the path they take when a tray is already running. Anything the page itself can be
asked is available through `--ctl eval`, which is what made the flyout behaviours in
this section testable:

```powershell
dist\tray\RouterMonitorTray.exe --ctl eval --arg "script=location.pathname"
```

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
