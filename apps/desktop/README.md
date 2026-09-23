# @tessera/desktop

The Tessera desktop app (Tauri 2). **Owner: Agent 07 (Desktop & self-host).** This folder is a stub
from the Architect; Agent 07 builds the real app here.

## What it will be

- A Tauri 2 shell around `apps/web` (the Vite dev server in development, the static build in
  production), with native menus, window-state persistence, single instance, a tray icon, deep
  links (`tessera://open/<pageId>`), quick capture and an auto-updater.
- Workspaces as folders: `tessera.db` (SQLite), `assets/`, and an optional `markdown/` mirror kept up
  to date through the `Exporter` interface.

## How it plugs into the web app

This package's TypeScript entry (`src/index.ts`, imported as `@tessera/desktop`) exports the desktop
services. `apps/web/src/features/desktop/index.ts` registers them with priority `100`
(`SERVICE_PRIORITY.desktop`) and an `isAvailable()` that checks `isTauri()`, so in a normal browser
nothing changes. Keep `@tauri-apps/*` imports behind dynamic `import()` so the browser build never
loads them.

## What exists now

- `src/index.ts`: `isTauri()` and the package marker. `@tauri-apps/api` and `@tauri-apps/cli` are
  pre-installed.

## Scripts

```bash
pnpm --filter @tessera/desktop test
pnpm --filter @tessera/desktop build   # bundles the TypeScript side; Agent 07 adds `tauri build`
```
