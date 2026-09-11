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

`tray/` holds a native WinForms panel (`RouterMonitorTray.exe`) that reads the
same JSON API, so the dashboard can live in the notification area instead of a
browser tab. It is compiled with the .NET Framework compiler that ships with
Windows, so no .NET SDK or extra npm package is needed.

### Visual parity with the web app

The flyout is not a lookalike: it is drawn from the same design tokens. Every
colour in `tray/Theme.cs` is the sRGB rendering of a variable in
`src/app/globals.css` (both the dark and the light theme), and the tray uses
the same CSS pixel type scale and the same recharts geometry, so the two
surfaces match. **Light is the default**, just as in the app:
`theme-provider` stores "light" unless the user picks dark, and the theme
button in the header flips it.

| Web | Tray |
| --- | --- |
| `:root` / `.dark` tokens | panel, card and sidebar fills, text, borders |
| `--border` (white/10) | 1px card grid, exactly like `grid gap-px bg-border` |
| `--chart-1/2/3/4/5` | tokens line, request bars, successful line, sparklines, donut |
| `emerald-500/10` / `red-500/10` delta badges | up/down badges on stats and card headings |
| `Badge` (h-5, rounded-4xl, text-xs) | status, `n OK`, error chips, `Messages` |
| `DashboardCard` flush grid (`gap-px bg-border`) | Overview / DeepSeek hairline tiles |
| `Card` (`rounded-xl bg-card ring-foreground/10`) | Requests / Models cards, drawn as real tiles |
| `CardHeader` / `CardContent` / `CardFooter` | 16px padding, `gap-4`, `border-b`, `bg-muted/50` footer |
| a wrapping `CardDescription` | `Cards.Header` word-wraps it, so a two-line description makes the header 101 not 81 and moves everything below it down 20px |
| a bare `text-base` `CardTitle` | 2px taller than the default `leading-snug` one, which moves its description to +44 and its content to +81 — pass `Mx.TitleLineBase` to `Cards.Header` |
| a trend card header (`space-y-2`) | its description sits at +46, not +42 |
| a `CardFooter` holding a button | 61px (`Cards.FooterWithButton`) rather than the 49px a plain text line needs |
| footer text vertical centring | the label centres on the footer's own 49/61px strip, never on whatever is left to the card's bottom edge |
| a footer on a stretched card | follows the content, not the card's bottom edge — `Command Code limits` leaves 361px blank under its footer, `DeepSeek API account` 119px |
| `Avatar` (`after:border-border`) | the header avatar always carries its 1px ring |
| `SidebarGroupLabel` (h-8 px-2 font-medium) | the Router / Data captions |
| sidebar + `h-14` header | the real 16rem rail and 56px bar, breadcrumb, search chip |
| lucide-react icons | `tray/Glyph.cs` carries the same path data, stroked at `stroke-width: 2` |
| Geist (next/font) | `scripts/generate-tray-fonts.py` emits static 400/500/600/700 faces, embedded in the exe and registered by `tray/Fonts.cs` |
| `font-normal`/`font-medium`/`font-semibold` | `Theme.TextW(..., weight, ...)` picks the matching face |
| baseline alignment | the browser centres each run's glyph box in its line box; `Theme.InkShift(px)` corrects GDI+'s ascent anchoring — 0 at 12/14px, +2 at 16px, +3 at 20px, −4 at 24px |
| OpenType kerning | Geist keeps its kerning in GPOS, which GDI+ ignores, so every Latin run measured ~2% wide and paragraphs wrapped in the wrong place. `scripts/generate-tray-kerning.py` extracts the pair adjustments into `tray/Kerning.cs`, and `Theme` applies them to each run's advance |
| `text-wrap` | a run is drawn in one `DrawString` call; kerning goes into the cursor advance, not into per-glyph drawing (GDI+ grid-fits each origin separately, which measures worse) |
| the `--font-sans` token | `globals.css` maps it to `--font-geist-sans`. It previously read `--font-sans: var(--font-sans)`, a self-reference that resolved to nothing and dropped the whole app to Times New Roman |
| `leading-snug` vs bare `text-base` | a snug title has 1px less half-leading, so it draws 1px higher than the `InkShift` figure alone would put it |
| measured geometry | card heights, column widths, cell padding, the header control cluster and the grid's `p-px` offsets all taken from the live DOM |
| table auto layout (the web `table` is `width:100%` with no `table-fixed`) | `Cards.AutoLayout` sizes each column to its widest cell (ps-6 / px-2 / pe-6) and shares the slack in proportion, so a wider card or different model names both come out right |
| header cluster (`items-center gap-2`) | source switch, range group, "updated" label and Refresh on one 28px row at y=99 |

The window is a **1688x935 CSS-pixel surface — the viewport the reference
screenshots were taken at** (2523x1402 physical at 1.5x DPR). At that width the
web's `max-w-(--app-wrapper-max-width)` cap (80rem = 1280) is already active, so
the grid is 1232px wide at x=356 in both.

**The live app is the specification, and `reference/*.png` is the fallback.**
`scripts/capture-web-reference.js` screenshots all five pages at 1688x935 and the
tray is diffed against them; where a page has no captured reference the four
screenshots in `reference/` are used instead. Card heights, column widths, cell
padding, the header control cluster and the grid's `p-px` offsets in
`tray/Cards.cs`, `tray/Widgets.cs` and the page files all come from measured DOM
geometry, not from eyeballing. The sidebar collapses to an icon rail from the
header's panel button, like the web `collapsible="icon"` sidebar. The flyout
carries **every page** the app has:

- **Overview** — MetricStatGrid, `Requests per day`, `Tokens and success`,
  `Recent requests`, `Command Code limits` (three paced windows with
  tone-coloured bars), `Model distribution` (donut + legend), `Router health`,
  `Top models`, `Activity` and `Usage insights` including the hourly histogram
  and the daily-activity heat strip.
- **Requests** — the stale-log banner (an amber note when the newest entry is an
  hour old or more, which shifts both cards down), `Filter requests` with the
  API/model selects, the 400-row log with sortable headers, pagination and
  **Export CSV**.
- **Models** — `Switch model` plus the full `Model usage` table.
- **DeepSeek** — the request-scope banner, account health, `Balance and spend`
  in CNY, `Requests and tokens per day` and `Models`.
- **Command Code** — the account's all-time usage tiles, its three paced credit
  windows with tone-coloured progress bars, remaining credits, the account
  identity, the billing subscription and the health of the four
  commandcode.ai endpoints.

The header keeps the **DeepSeek API / Codex Router API** switcher and the
**All / 30d / 7d / 24h** range switcher, the sun/moon button flips the whole
panel between the dark and the light theme, and the search chip opens the
Cmd-K command menu. Mouse wheel scrolls; hovering the bar chart shows the same
tooltip the web chart does.

The Cmd-K dialog is interactive, not a picture of one: its search field is a
real `TextBox` hosted over the painted panel, so typing filters the list, the
caret and selection work, and IME composition behaves normally. `Up`/`Down`
move the highlight, `Enter` runs the selected command, and `Esc` closes the
dialog before it closes the flyout.

```powershell
powershell -ExecutionPolicy Bypass -File scripts\build-tray.ps1            # compile only
powershell -ExecutionPolicy Bypass -File scripts\install-tray.ps1 -Start   # build, install, launch
```

`install-tray.ps1` writes the desktop shortcut, drops an autostart shortcut in
the user's Startup folder (an ONLOGON scheduled task would require elevation)
and starts the app. It also removes the web host's logon task if one exists.

Tray behaviour:

- Left-click the icon, or pick **打开面板**, to open the flyout; it hides again when it loses focus, `Esc` closes it, and **固定面板** pins it open.
- Double-click, or pick **打开网页版**, to open the full dashboard in the browser.
- **数据源** switches between the active CC Switch profile, the DeepSeek API, the Codex Router API and DeepSeek Harness.
- **开机自动启动** toggles the Startup-folder shortcut.
- When `http://127.0.0.1:3000` is not answering, the tray starts the hidden host itself by running `scripts\start-dashboard.ps1`.

### Auto-start

**Only the tray auto-starts.** The web host deliberately has no logon task:
booting it at logon costs a Next.js server's worth of memory and CPU whether or
not anyone looks at the dashboard. The tray starts it on demand, and
`scripts\open-dashboard.ps1` does the same for the browser path.

The flyout is **anchored to the tray icon and cannot be dragged**. The window
carries no `WS_CAPTION`, `WS_THICKFRAME` or `WS_SYSMENU`, every `WM_NCHITTEST`
reports `HTCLIENT` so there is no title bar or resize edge to grab, the
`SC_MOVE` / `SC_SIZE` system commands are swallowed, and any relocation that
still reaches the window is pulled back to the anchor. `RouterMonitorTray.exe
--check-window` proves all four properties and reports `RESULT: anchored`.

Diagnostics render the panel to a PNG without showing a window:

```powershell
# one page at 125% display scaling, scrolled into the middle of the content
dist\tray\RouterMonitorTray.exe --render preview\requests.png --scale 1.25 --page requests --scroll 900

# the light theme, a filter applied, and an open dropdown
dist\tray\RouterMonitorTray.exe --render preview\light.png   --page overview --theme light
dist\tray\RouterMonitorTray.exe --render preview\filter.png  --page requests --provider commandcode
dist\tray\RouterMonitorTray.exe --render preview\select.png  --page models   --popup model

# the Cmd-K dialog with a query typed into its real input
dist\tray\RouterMonitorTray.exe --render preview\command.png --page overview --popup command --query "mo" --form host

# a contact sheet with Overview, Requests, Models and DeepSeek side by side
powershell -ExecutionPolicy Bypass -File scripts\preview-tray.ps1 -Scale 1.0
```

Exit code `0` means live data was rendered; `1` means the host was unreachable
and the panel drew its offline state. `--page overview|requests|models|deepseek`
picks the view, `--range all|30|7|1` the window, `--source deepseek|router` the
data source, `--theme light` the theme, `--provider`/`--model` the log filters,
`--popup provider|model|user|command` an open overlay, `--query` the Cmd-K
filter, `--hover` a forced hover key and `--url` another host.

`--form host` realises the flyout in a real (offscreen) window before capturing,
which is the only way to include hosted child controls. The headless renderer
draws the search text itself, so both modes show the same picture.
`--dump-layout` prints the measured card rectangles in screen coordinates so
they can be diffed against a DOM probe directly.

```powershell
# capture the browser pages (light theme, 1688x935) the tray is compared against
node scripts\capture-web-reference.js

# render every page at 1:1 and stack it under the Playwright screenshot
powershell -ExecutionPolicy Bypass -File scripts\compare-tray-web.ps1

# diff against the frozen reference screenshots (reference\*.png)
powershell -ExecutionPolicy Bypass -File scripts\compare-tray-to-reference.ps1
```

`reference/` holds the browser screenshots the panel is built from. They are the
spec: the app keeps changing during development, so these are what the tray is
measured against. They were captured at 1.5x DPR, so the comparison scales each
to CSS pixels and skips the flyout's own 46px control strip.

`compare-tray-to-reference.ps1` renders its own 1:1 images into
`dist/tray/measure/` rather than reusing `dist/tray/preview/`: `preview-tray.ps1`
renders the same page names at a smaller `--scale` into that directory, so
sharing one location silently scores a scaled bitmap against a 1:1 one — and
`GetPixel` past its width throws rather than reporting a difference.

The scoring itself is `tools/ImageDiff.cs`, built by
`scripts/build-imagediff.ps1` into `dist/tray/ImageDiff.exe`. It exists because
two things about the captures have to be handled before a number means anything:

- **Width.** The four were taken at different browser widths (1671 to 1691 CSS
  px), so a page can be globally offset against the tray by up to ~8px through no
  fault of the layout. The tool searches a ±12/±6px translation window first and
  scores at the best alignment, so the result measures layout rather than capture
  width. Across all four captures the invariant is that the card grid starts
  102–103 CSS px right of the sidebar divider; the tray draws it at 101.
- **A stray window.** The `requests` capture still has Windows' Snipping Tool
  toast over its bottom-right corner. That rectangle is excluded from the score
  and painted purple in the heat map, so a screenshot artifact is not read as a
  UI mismatch.

It works on locked 32bpp buffers rather than `Bitmap.GetPixel`: a ~1.6M-pixel
scan across 25 alignments takes 15s that way against roughly ten minutes through
`GetPixel`.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
