<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
---

# Router Monitor — working rules

## The invariant that matters

The user clarified on 2026-10-16 that the desktop app must retain the original
React UI and run independently on another Windows computer. `desktop/` is the
Electron host; it packages a lean Node data service and exported UI assets.
Keep the React UI and observatory core shared. Do not maintain another native
UI. The retired C# and WebView2 implementations have been removed.
The installed app must not depend on a source checkout, system Node/npm, a
separate browser, or external network resources to display its interface.
The EXE is the only end-user entrypoint. UI previews and automation run in Electron, not a standalone browser.
Page and asset requests require the current desktop session header. Retain the React
sources and bundled rendering engine; removing them breaks the desktop UI.

## Build and lifecycle

- `npm run desktop:prepare` exports the UI and bundles the built-in-Node-only
  data service. `desktop:dev` uses these same staged assets. Next must not be
  loaded at runtime. Normalize Windows segment payload names during staging.
- `npm run desktop:build` produces the NSIS installer and portable executable.
- Retry must stop the existing utility process before launching its replacement.
  Every collection timer and request belongs to that service lifecycle.
- Keep software drawing for this table/SVG UI; measure scrolling before changing
  graphics settings. Do not silently re-enable the hardware compositor.
- Window hiding stops UI polling; main-process collection continues every 15 seconds.
- Existing history can be shown during catch-up. Preserve explicit collection state.
- SQLite caches must notice other connections' commits through `data_version`.
- Published reader/archive events are immutable and shared. Create new records for
  revisions and reconciliation; never mutate cached evidence in place.
- Measure memory with all owned processes; do not force GC or trim working sets
  to present an artificial improvement. Keep collection intervals unchanged.
- Keep `.ps1` ASCII. Windows PowerShell reads a BOM-less `.ps1` as ANSI, so a Chinese
  selector arrives mangled and silently matches nothing.
- Under `$ErrorActionPreference = "Stop"`, a native command writing to **stderr** is a
  terminating error. Wrap `git` / `node` calls and restore the preference.
- `Start-Process -ArgumentList` joins with spaces and does not quote. Quote any argument
  that contains one.
- Quit the installed app with `ModelObservatory.exe --quit` before upgrading it.

## Verify

```powershell
npm run desktop:build
npm run test:desktop
npm run test:ui
```

Desktop checks must exercise the packaged executable, local-only requests,
window lifecycle and the bundled data service. Do not describe something as
measured when it was not, or widen a threshold to make a test pass.

## Traps that have already cost time

- After preparing a new build, restart the desktop preview to load its staged service.
- Quit through the app menu or `--quit` so its owned service is disposed.
- Desktop navigation stays on dashboard pages; API responses are not UI routes.
- The codex-router keeps the built-in `openai` provider id and points `openai_base_url`
  at its own loopback. A session can therefore say `model_provider = "openai"` and still
  have gone through the router — so "did this go through the router" is answered by where
  the provider *points*, not by its name. Getting this wrong counted ~1,660 rows twice.

## Style

Follow what is already there: tabs, double quotes, named exports, `cn()` for class names.
Comments explain **why**, not what. `README.md` is the spec of record — when behaviour
changes, change it in the same commit.

