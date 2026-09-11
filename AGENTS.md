<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
---

# Router Monitor — working rules

## The invariant that matters

`tray/` renders `http://127.0.0.1:3000` in WebView2. **No drawing code, no second UI, no
design tokens in `tray/`.** It was once a 9,824-line GDI+ reimplementation of the whole
frontend; it is not going back.

## Adding to the tray

One row in `RegisterControlHandlers()` (`tray/Program.cs`) plus one method. It is then
reachable as `--ctl <cmd>` and, if the page needs it, through the bridge
(`src/lib/tray/bridge.ts`).

Do not add a `--mode`, a top-level constant, or a new diagnostic shell.

## Build

- `csc.exe` (.NET Framework), `/langversion:5`. No string interpolation, no `?.`/`??`,
  no `async Main`, no `out var _`.
- Keep `.ps1` ASCII. Windows PowerShell reads a BOM-less `.ps1` as ANSI, so a Chinese
  selector arrives mangled and silently matches nothing.
- Under `$ErrorActionPreference = "Stop"`, a native command writing to **stderr** is a
  terminating error. Wrap `git` / `node` calls and restore the preference.
- `Start-Process -ArgumentList` joins with spaces and does not quote. Quote any argument
  that contains one.
- Building stops the running tray first: the executable is locked while it runs.

## Verify

```powershell
powershell -ExecutionPolicy Bypass -File scripts\verify-tray.ps1   # exits non-zero on failure
npm run test:e2e                                                    # page only
```

`verify-tray.ps1` drives the running tray over the control channel and asserts every
threshold. It is a gate: if it fails, that is the answer. Do not widen a threshold to make
it pass, and do not describe something as measured when it was not.

## Traps that have already cost time

- `next start` reads its build manifest at startup. After `npm run build`, restart the
  server or it keeps serving the previous build's chunks.
- `JavaScriptSerializer` returns nested arrays as `ArrayList`, not `object[]`.
- `Convert.ToString(true)` is `"True"`, not `"true"`.
- Quit through the channel (`--ctl quit`) so the WebView is disposed. Killing the process
  leaves `msedgewebview2` children holding the profile lock.
- The flyout must stay on dashboard pages. Same origin is not enough: `/api/` lives there
  too, and a bare JSON response has no way back.
- The codex-router keeps the built-in `openai` provider id and points `openai_base_url`
  at its own loopback. A session can therefore say `model_provider = "openai"` and still
  have gone through the router — so "did this go through the router" is answered by where
  the provider *points*, not by its name. Getting this wrong counted ~1,660 rows twice.

## Style

Follow what is already there: tabs, double quotes, named exports, `cn()` for class names.
Comments explain **why**, not what. `README.md` is the spec of record — when behaviour
changes, change it in the same commit.

