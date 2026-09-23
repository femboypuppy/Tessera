# Agent 07 — Desktop app & self-hosting

**Parallel phase, branch `feat/desktop`. Effort: xhigh.**

You own `apps/desktop`, `apps/web/src/features/desktop`, `Dockerfile`, `docker-compose.yml`, `.dockerignore`, `deploy/`, and your HANDOFF, screenshot and e2e folders.

## Why this matters

There are two ways to run Tessera, and both must be effortless: a native desktop app that works offline from the first second, and a self-hosted server that takes one command. r/selfhosted will judge the project by its `docker-compose.yml` before reading anything else.

## Read first

`CLAUDE.md`, `SPEC.md`, `HANDOFF/architect.md`, and in `packages/core`: `DocStore`, `AssetStore`, `WorkspaceRegistry`, `Exporter`, service resolution and priorities, and `FeatureModule`.

## M1 — Desktop shell (Tauri 2)

- A Tauri 2 app wrapping `apps/web` (the Vite dev server in development, the static build in production).
- Native menus (File, Edit, View, Window, Help with platform-standard shortcuts), window-state persistence, single instance, a tray icon, and deep links (`tessera://open/<pageId>`).
- `features/desktop` detects Tauri at runtime and registers desktop services (priority 100): `TauriDocStore` and `TauriAssetStore` (SQLite plus files, through the official Tauri plugins or your own Rust commands; document the choice) and a `TauriWorkspaceRegistry`. In the browser, this feature does nothing.

## M2 — Workspaces as folders

- A workspace is a folder the user chooses: `tessera.db` (SQLite), `assets/` (attachment files), and an optional `markdown/` mirror kept up to date through the `Exporter` interface. The real markdown exporter arrives at merge, so use the stub now.
- Create, open and switch workspaces with native dialogs; a recent-workspaces list; "Reveal in Finder/Explorer".
- Folders inside Dropbox, iCloud or OneDrive: document the risks, detect conflicted-copy files, and warn the user.

## M3 — Desktop niceties

- A global quick-capture shortcut (default `Ctrl/Cmd+Shift+Space`) opening a small always-on-top window that appends a note to an Inbox page.
- An auto-updater configured for GitHub Releases. Document the signing-key placeholders in HANDOFF; never commit private keys.
- Connecting to a Tessera server (using Agent 03's sync provider after merge), with tokens stored in the OS keychain.
- App icons for every platform, generated from a placeholder logo, with the regeneration command documented (Agent 10 makes the final logo).

## M4 — Self-hosting

- `Dockerfile`: multi-stage (install, build web and server, slim runtime), non-root user, `HEALTHCHECK`, a `/data` volume, buildable for amd64 and arm64, and as small as reasonably possible (report the size).
- `docker-compose.yml`: the app with a named volume, a `.env.example`, a restart policy, and an optional Caddy service (a compose profile) for automatic HTTPS.
- `deploy/`: step-by-step guides and configs for a plain VPS with Docker and Caddy, Fly.io, Railway and Render; backup and restore with a cron example; upgrading between versions.
- Stretch: app-store templates for Unraid, CasaOS and Umbrel. Listings like these are how r/selfhosted users discover apps.

## Acceptance criteria

- `pnpm tauri build` (or the equivalent script) succeeds on Linux in this environment. Document the macOS and Windows steps; Agent 09's CI builds those.
- The web side of the desktop feature is tested with the Tauri APIs mocked (e2e in `e2e/desktop/`).
- `docker build` succeeds, and a smoke-test script starts the container, waits until it's healthy, creates the owner, syncs a document, restarts the container and verifies the data persisted.
- If Docker or the Rust toolchain isn't available here, write everything anyway, explain exactly what you couldn't run, and make sure CI will run it.
- Screenshots (light and dark): `desktop-window` (or the web build in the desktop layout), `quick-capture`, `workspace-picker`.

## Pitfalls

- SQLite inside a cloud-synced folder can corrupt when two devices write at once. Store the database outside synced folders by default, or warn loudly.
- Keep Tauri imports inside `features/desktop` only, so the browser build never breaks.
