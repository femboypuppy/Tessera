# Desktop & self-host handoff

## Plan

Milestones from `agents/07-desktop-selfhost.md`, each ending tested and committed on `feat/desktop`.

1. **M1: desktop shell (Tauri 2).** `apps/desktop/src-tauri`: Tauri 2.11 app around `apps/web`
   (Vite dev server in dev, `apps/web/dist` in production); native menus built from JS (translated
   with `t()`), window-state, single instance, tray, `tessera://open/<pageId>` deep links. Storage
   through **own Rust commands on `rusqlite`** (not the SQL plugin: it sends blobs as JSON number
   arrays and can't do compare-and-replace compaction). TypeScript side in `@tessera/desktop`:
   `TauriDocStore`, `TauriAssetStore`, `TauriWorkspaceRegistry` (priority 100, only inside Tauri)
   behind one typed IPC layer, with a fake Tauri runtime (`src/testing/fake-tauri.ts`) that unit
   tests and e2e specs share.
2. **M2: workspaces as folders.** `tessera.db` + `assets/` + optional `markdown/` mirror (through
   `ctx.exporters`, core's `markdown-basic` until Agent 08 lands). Workspace picker overlay (create,
   open, switch, recent list, reveal in Finder/Explorer), native folder dialogs, cloud-sync folder
   detection (Dropbox, iCloud, OneDrive, Google Drive, Syncthing, Nextcloud…), conflicted-copy
   detection **and lossless merge** (the database is a Yjs update log, so a conflicted copy can be
   merged back as a CRDT union).
3. **M3: niceties.** Quick capture (global `Ctrl/Cmd+Shift+Space`, always-on-top window, bare
   `/capture` route appending to an Inbox page), updater on GitHub Releases (signing-key
   placeholders, no private keys), OS-keychain token storage for server connections, icons
   generated from a placeholder logo.
4. **M4: self-hosting.** Multi-stage `Dockerfile` (non-root, `HEALTHCHECK`, `/data`, amd64/arm64),
   `docker-compose.yml` with a Caddy profile, `.env.example`, `deploy/` guides (VPS + Caddy, Fly.io,
   Railway, Render, backups with cron, upgrades), a container smoke test, stretch app-store
   templates (Unraid, CasaOS, Umbrel).
5. e2e (`e2e/desktop/`, Tauri mocked), screenshots, Linux `tauri build` in Docker, this file.

## Built (what exists and where)

(in progress)

## How it plugs in (FeatureModule entries, services, extension points used)

(in progress)

## Decisions (and why)

(in progress)

## Contract change requests (exact proposed diff to packages/core, and why)

(in progress)

## Known gaps and bugs

(in progress)

## Follow-ups for the merge (cross-agent wiring you couldn't finish alone)

(in progress)

## Screenshots (list of files)

(in progress)
