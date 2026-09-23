# Desktop & self-host handoff

## Plan

Milestones from `agents/07-desktop-selfhost.md`, each ended tested and committed on `feat/desktop`:

1. **M1 desktop shell (Tauri 2)**: done. Tauri 2.11 app around `apps/web`, native menus, window
   state, single instance, tray, `tessera://open/<pageId>` deep links, desktop services at
   priority 100 behind one typed IPC layer.
2. **M2 workspaces as folders**: done. `tessera.db` + `assets/` + optional `markdown/` mirror,
   picker (create, open, switch, recent list, reveal), cloud-sync detection, conflicted-copy
   detection and lossless merge.
3. **M3 niceties**: done. Quick capture, updater (signing placeholders), keychain token storage,
   icons from a placeholder logo.
4. **M4 self-hosting**: done. Dockerfile, Compose with a Caddy profile, `.env.example`, deploy
   guides (VPS, Fly.io, Railway, Render), backups, upgrades, smoke test, app-store templates.
5. e2e (Tauri mocked), screenshots, the Linux build in Docker, the real-app smoke test on Windows.

## Built (what exists and where)

**Rust, `apps/desktop/src-tauri/`** (Tauri 2.11.6, 45 `cargo test`s, clippy clean):

| File | What |
|---|---|
| `src/lib.rs` | Plugins (single-instance, deep-link, dialog, opener, updater, window-state, log, global-shortcut), the `tessera-asset` URI scheme, menu and window events, the exit flush (`ExitRequested` → every window flushes → databases checkpoint and close → exit), deep links queued for the main window. |
| `src/commands.rs` | Every IPC command (48): app info, quit, menus, zoom, full screen, preferences, quick capture, registry, folders (inspect, suggest, native picker, reveal), workspaces (attach/detach, status, rename, merge a conflicted copy), docs (load as one binary frame, store and compact with raw bodies), assets, markdown mirror, keychain, updater. Blocking work runs off the main thread. |
| `src/db.rs` | `tessera.db`: `meta` (workspace ID, name, format version), `updates` (append-only Yjs log per doc), `assets`. WAL (rollback journal in cloud-synced folders), `synchronous = FULL`, compaction that keeps rows stored after the read, `merge_from` for conflicted copies, refuses newer formats. |
| `src/workspace.rs` | Open workspaces shared by windows (reference counted); **the folder and database are created on the first write**; content-addressed assets with safe file names; the markdown mirror (only rewrites changed files, removes only files it wrote before, prunes empty folders); merging a conflicted copy then moving it to `.tessera/merged/`. |
| `src/config.rs` | `workspaces.json` (statuses `ready`, `new`, `missing`; adopts `~/Tessera/*` workspaces on first run), `preferences.json`, `servers.json`; atomic writes; unreadable files are moved aside. |
| `src/cloud.rs` | Detects Dropbox (incl. `info.json`), OneDrive (env vars), iCloud Drive, macOS File Provider folders (Google Drive, Box, pCloud…), Syncthing, Nextcloud, MEGA; recognizes every service's conflicted-copy naming. |
| `src/menu.rs`, `src/windows.rs`, `src/protocol.rs`, `src/secrets.rs`, `src/updater.rs`, `src/deeplink.rs`, `src/validate.rs`, `src/lifecycle.rs` | Menus from a validated description; main window, quick-capture window, tray, global shortcut; attachments served from open workspaces only (`nosniff`, sandbox CSP); keychain (`keyring` 3); updater (no-op with the placeholder key); link parsing; path/ID validation; exit flush. |
| `tauri.conf.json`, `capabilities/` | Strict CSP; bundles for every OS; deep-link scheme; updater endpoint; per-window capabilities (the quick-capture window can't touch menus, folders, the keychain or updates). |
| `icons/` | All desktop sizes, generated from `icons/source.svg` (placeholder). |

**TypeScript, `apps/desktop/src/`** (`@tessera/desktop`, 74 Vitest tests):

| Path | What |
|---|---|
| `index.ts` | The light entry the web app imports: `isTauri()` and `createDesktopFeature()` (three services, the onboarding action, `activate`; `{ id }` only in a browser). |
| `contributions.ts`, `activate.ts` | Registered when a workspace opens: the `/capture` bare route, the picker overlay, the Desktop settings panel, a sidebar section and 14 commands; then title, menus, deep links, mirror, folder checks, update check. |
| `styles.css` | Tailwind utilities for this package's classes (CCR 3 workaround), loaded with `activate`. |
| `backend/` | `DesktopBackend` (one method per command), `TauriBackend` (invoke/listen, raw binary bodies with percent-encoded headers, zod-validated replies, typed errors). |
| `stores/` | `TauriDocStore`, `TauriAssetStore`, `TauriWorkspaceRegistry` (plus `openFolder`, `locate`, `listAll`), `KeychainCredentialStore` (ready for CCR 1). |
| `picker/`, `settings/`, `sidebar/`, `capture/` | Workspace picker, Settings → Desktop (folder, cloud/conflicts with Merge, markdown copy, quick-capture shortcut recorder, tray, updates, signed-in servers), a quiet sidebar warning, quick capture (`[ ]` lines become tasks). |
| `menu/`, `mirror/`, `updates/`, `workspace/`, `commands.ts`, `activate.ts` | Translated native menus and their dispatch, the markdown mirror, the update flow, folder flows, deep links, per-session activation. |
| `testing/fake-tauri.ts` | A fake Tauri runtime answering every command like Rust (fake disk, events, two windows relaying updates, persistence across reloads). Used by unit tests and injected by the e2e specs. |
| `scripts/smoke-app.mjs` | Drives the **real** Windows app over WebView2's DevTools (see Decisions). |
| `docker/linux-build.Dockerfile`, `scripts/build-linux-in-docker.mjs` | Linux `.deb`/`.rpm`/AppImage from any machine with Docker. |

**Web feature**: `apps/web/src/features/desktop/index.ts` is one line,
`export const desktopFeature = createDesktopFeature();`. In a browser the feature is
`{ id: 'desktop' }` and nothing else of the package is downloaded (the startup bundle gains
`isTauri()`, a few strings' getters and one icon).

**Self-hosting** (root and `deploy/`):

| File | What |
|---|---|
| `Dockerfile` | `pnpm fetch` (cached by lockfile) → `pnpm install --frozen-lockfile --offline` → web and server builds → `pnpm deploy --prod --legacy` → native modules slimmed to the target platform (and checked to load) → runtime on plain Alpine with only the `node` binary, `tini`, `su-exec`, user `node` (uid 1000), `/data` volume, `HEALTHCHECK` on `/api/health`, a `tessera-server` CLI wrapper and an entrypoint that fixes root-owned platform volumes then drops to `node`. **61.4 MB compressed, 247 MB on disk** (amd64, with the stub server). |
| `docker-compose.yml`, `.env.example` | Named volume, `restart: unless-stopped`, read-only root, `cap_drop: ALL`, `no-new-privileges`, log rotation; `https` profile with Caddy 2.10.2. |
| `deploy/caddy/Caddyfile` | Automatic HTTPS, HTTP/3, compression, HSTS, health-aware proxy. |
| `deploy/README.md`, `vps/`, `fly/`, `railway/`, `render/` | Guides and configs (`fly.toml` + a root-start Dockerfile, `railway.json`, `render.yaml` + Dockerfile). |
| `deploy/backup/` | `backup.sh` (volume snapshot or `MODE=online`, retention, verification), `restore.sh` (moves current data aside first), cron example. |
| `deploy/UPGRADING.md` | Upgrades and rollback. |
| `deploy/appstores/` | Unraid template, CasaOS compose, Umbrel app (stretch). |
| `deploy/smoke/smoke-test.mjs` | Container smoke test (see Known gaps for the server steps). |

**Tests**: `e2e/desktop/desktop.spec.ts` (8 tests × Chromium and Firefox), `e2e/desktop/desktop.screenshots.ts`.

## How it plugs in (FeatureModule entries, services, extension points used)

Declared statically by `createDesktopFeature()` (only inside Tauri):

- **Services** (priority `SERVICE_PRIORITY.desktop` = 100, `isAvailable` = inside Tauri, and for
  storage the workspace has a `path`): `workspaceRegistry` → `tauri-folders`, `docStore` →
  `tauri-sqlite`, `assetStore` → `tauri-files`. The sync provider stays Agent 03's.
- **onboardingActions**: `desktop-open-folder` ("Open a workspace folder").
- **activate(ctx)** (below).

Registered by `activate` through `ctx.contributions` and `ctx.commands`, so their code and strings
stay out of the browser bundle (the session removes them when it closes):

- **routes**: `/capture` with `layout: 'bare'` (the quick-capture window).
- **overlays**: `desktop-workspaces` (the picker; loads its dialog only when opened).
- **settingsPanels**: `desktop` (Settings → Desktop).
- **sidebarSections**: `desktop-folder-status` (bottom; renders only for synced folders or conflicts).
- **commands** (`workspace`, `view`, `page`, `help` groups; hidden in the capture window):
  `desktop.openWorkspaces` (Mod+O), `newWorkspace`, `openFolder`, `revealWorkspace`,
  `quickCapture`, `copyDeepLink`, `zoomIn` (Mod+=), `zoomOut` (Mod+-), `resetZoom` (Mod+0),
  `toggleFullscreen` (F11), `checkForUpdates`, `openDocs`, `openReleases`, `reportIssue`.
- **activate(ctx)**: sets the window title, the native menus (from the commands that exist, so
  after the merge Search appears by itself), deep links, the markdown mirror, folder checks
  (toast on conflicted copies), the daily update check; warns loudly if storage fell back to a
  non-desktop store.
- **Settings keys**: device `desktop.markdownMirror` (workspace IDs mirrored on this computer);
  workspace `desktop.inboxPageId` (the Inbox page, synced).
- **Extension points used**: `ctx.switchWorkspace`, `ctx.exporters` (the mirror picks `markdown`,
  `markdown-folder`, `markdown-zip`, else core's `markdown-basic`), bare routes, overlays,
  `window.__tessera.diagnostics()` (e2e and the real-app smoke test check the service sources).

## Decisions (and why)

- **Own Rust commands over `rusqlite`, not `tauri-plugin-sql`.** Updates travel as raw bytes (the
  plugin serializes blobs as JSON number arrays), `load` returns every update in one binary frame,
  and compaction deletes rows `<= maxSeq` and inserts the merged update in one transaction, so a
  concurrent `storeUpdate` is never lost (the `DocStore` contract).
- **A workspace is a Yjs update log in SQLite**, not a snapshot. Merging two copies is a union of
  rows, which makes **conflicted copies from Dropbox & co. recoverable without loss** (Settings →
  Desktop → Merge; the copy is moved to `.tessera/merged/`, never deleted).
- **Folders are created on the first write.** A workspace nobody edits leaves nothing on disk, so
  the onboarding button "Open a workspace folder" can quietly replace the empty workspace the shell
  creates first (no contract change needed, no stray folders). The registry records when a folder
  existed, so a vanished folder (unplugged drive) shows as "Folder not found" instead of being
  recreated empty; `list()` hides those so the shell never opens one.
- **New workspaces default to `~/Tessera/<name>`**, outside the folders iCloud and OneDrive sync by
  default (Desktop, Documents). Choosing a synced folder asks first and explains the risk; SQLite
  uses a rollback journal there (a `-wal` file synced separately from `tessera.db` loses commits).
- **`synchronous = FULL`** everywhere, and an exit protocol: Quit/closing asks every window to
  flush (`flush_done`), checkpoints and closes the databases, then exits (3 s cap for a hung page).
  Updates download and verify before that, then install.
- **Menus are described by the web side** (`menu_set`) so labels use `t()`; accelerators come from
  command shortcuts. Menu accelerators and the page's own shortcuts would double-fire on some
  OSes, so the page records keydowns and skips a menu event whose shortcut it just handled.
  Undo/Redo are app items that send the shortcut to the focused editor (Yjs-aware undo) or use the
  field's native undo.
- **Two windows, one Rust process.** The quick-capture window is a second webview on `/capture`
  (created on first use, then hidden, so it opens instantly; hides on blur, keeps the draft). Rust
  relays each stored update to the other window (`desktop://doc-update`), so the main window sees
  captured notes live. The capture window always writes into the workspace open in the main window:
  it follows the most recently opened workspace whenever the registry changes, and stays on
  `/capture`. Its capability has no access to menus, folders, keychain or updates.
- **Attachments via a custom scheme** (`tessera-asset://`), served only for open workspaces and
  recorded asset IDs: no filesystem scope to widen, `nosniff` and a sandbox CSP.
- **The feature is defined synchronously; its UI registers at runtime.** A first version used a
  top-level `await` in the feature folder to import the feature only inside Tauri. It worked, but
  Firefox occasionally hung while opening a workspace (2 of 8 runs of a shell spec, against 0 of 6
  without it), so the feature is now a tiny synchronous module whose routes, panels and commands
  are registered by `activate` (`ctx.contributions`, `ctx.commands`), and whose onboarding
  strings are read lazily (registered when the desktop registry starts).
- **Package styles**: Tailwind only scans `packages/*/src` (CCR 3), so this package generates
  its own utilities, in the `components` layer so they can never override the shell.
- **Updater**: the committed public key is a placeholder; such builds report "not configured"
  (Settings → Desktop links to Releases). CI injects the key and `createUpdaterArtifacts`.
- **Docker runtime without npm**: plain Alpine plus the `node` binary saves 22 MB over
  `node:alpine`. Native prebuilds for other platforms and addon sources are removed, then
  `better-sqlite3` and `argon2` are loaded as a check in the build.
- **Non-root, and still fine on Fly.io/Railway/Render/Unraid/CasaOS** (they mount volumes as
  root): the image starts as `node`; started as root, its entrypoint `chown`s `/data` once and
  `su-exec`s to `node`. Compose keeps the non-root start with no capabilities at all.
- **Backups default to a volume snapshot with a short stop** (always consistent, independent of
  the server version); `MODE=online` uses the server's own backup command.
- **Smoke tests on both ends**: `deploy/smoke/smoke-test.mjs` (the image, like Compose runs it) and
  `apps/desktop/scripts/smoke-app.mjs` (the real Windows app through WebView2's DevTools port).
- **Dependencies added** (all MIT/Apache-2.0, pinned): npm: `@tessera/ui`, `lucide-react`, `yjs`,
  `zod`, and `tailwindcss` 4.3.3 as a dev dependency (for `src/styles.css`), all already in the
  repo and now declared by `@tessera/desktop`. Rust: `tauri` 2.11.6 (pinned to the
  JS API's minor) and its official plugins (`deep-link`, `dialog`, `global-shortcut`, `log`,
  `opener`, `single-instance`, `updater`, `window-state`), `rusqlite` 0.40 (bundled SQLite),
  `keyring` 3.6 (native backends, pure-Rust Secret Service on Linux), `sha2`, `base64`,
  `percent-encoding`, `url`, `serde`, `thiserror`, `log`; `tempfile` for tests. `Cargo.lock` is
  committed.

## Contract change requests (exact proposed diff to packages/core, and why)

### 1. A `credentialStore` service (server tokens in the OS keychain)

Why: SPEC 11 says desktop tokens go to the OS keychain, and Agent 03's sign-in and Hocuspocus
provider need to read and write them, but no package may import another's. A service keeps the
browser on cookies (memory stub) and gives the desktop the keychain (priority 100).

```diff
--- /dev/null
+++ packages/core/src/services/credential-store.ts
+/** Sign-in tokens for Tessera servers, keyed by server origin. Desktop: the OS keychain. */
+export interface CredentialStore {
+  get(server: string): Promise<string | null>;
+  set(server: string, token: string): Promise<void>;
+  delete(server: string): Promise<void>;
+  /** Servers with a token (no secrets). */
+  list(): Promise<Array<{ server: string; savedAt: number }>>;
+}
+
+/** In-memory stub (browsers use httpOnly cookies instead). */
+export class MemoryCredentialStore implements CredentialStore {
+  private readonly tokens = new Map<string, { token: string; savedAt: number }>();
+  async get(server: string) { return this.tokens.get(new URL(server).origin)?.token ?? null; }
+  async set(server: string, token: string) { this.tokens.set(new URL(server).origin, { token, savedAt: Date.now() }); }
+  async delete(server: string) { this.tokens.delete(new URL(server).origin); }
+  async list() { return [...this.tokens].map(([server, { savedAt }]) => ({ server, savedAt })); }
+}
--- packages/core/src/services/registry.ts
+import type { CredentialStore } from './credential-store';
 export interface ServiceMap {
   workspaceRegistry: WorkspaceRegistry;
   markdownCodec: MarkdownCodec;
+  credentialStore: CredentialStore;
   docStore: DocStore;
@@ SERVICE_PHASES
   markdownCodec: 'app',
+  credentialStore: 'app',
@@ export interface StorageServiceContext extends AppServiceContext {
-  app: Pick<ServiceMap, 'workspaceRegistry' | 'markdownCodec'>;
+  app: Pick<ServiceMap, 'workspaceRegistry' | 'markdownCodec' | 'credentialStore'>;
--- packages/core/src/runtime/runtime.ts
+  const credentials = await resolveService('credentialStore', registrations, appContext,
+    { id: 'memory', create: () => new MemoryCredentialStore() }, { onError: onServiceError });
@@ const runtime: AppRuntime = {
+    credentialStore: credentials.service,
-    appServiceSources: { workspaceRegistry: registry.source, markdownCodec: codec.source },
+    appServiceSources: { workspaceRegistry: registry.source, markdownCodec: codec.source, credentialStore: credentials.source },
@@ storageContext
-    app: { workspaceRegistry: runtime.workspaceRegistry, markdownCodec: runtime.markdownCodec },
+    app: { workspaceRegistry: runtime.workspaceRegistry, markdownCodec: runtime.markdownCodec, credentialStore: runtime.credentialStore },
@@ const services: ServiceMap = {
+    credentialStore: runtime.credentialStore,
@@ interface AppRuntime
+  readonly credentialStore: ServiceMap['credentialStore'];
--- packages/core/src/index.ts
+export * from './services/credential-store';
```

Workaround meanwhile: `apps/desktop/src/stores/credential-store.ts` (`KeychainCredentialStore`,
same shape, tested) and Settings → Desktop → Signed-in servers read the keychain directly. Once
the change lands, add to `createDesktopFeature()` in `apps/desktop/src/index.ts`:
`defineService({ provides: 'credentialStore', id: 'keychain', priority: SERVICE_PRIORITY.desktop, isAvailable: () => isTauri(), create: async () => new (await import('./stores/credential-store')).KeychainCredentialStore((await import('./runtime')).getBackend()) })`.

### 2. Items in the workspace switcher menu

Why: on the desktop, "Open folder…" belongs next to "New workspace" in the sidebar's workspace
menu; today it's reachable from the File menu, Mod+O (the picker) and onboarding only.

```diff
--- packages/core/src/runtime/feature.ts
+/** An item in the sidebar's workspace menu (under "New workspace"). */
+export interface WorkspaceMenuItemContribution {
+  id: string;
+  title: string;
+  icon?: IconComponent;
+  order?: number;
+  run(ctx: AppContext): void | Promise<void>;
+}
 export interface ContributionMap {
@@
   overlays: OverlayContribution;
+  workspaceMenuItems: WorkspaceMenuItemContribution;
 }
@@ export interface FeatureModule {
   overlays?: OverlayContribution[];
+  workspaceMenuItems?: WorkspaceMenuItemContribution[];
--- packages/core/src/runtime/runtime.ts (static registration)
       add('overlays', feature.overlays);
+      add('workspaceMenuItems', feature.workspaceMenuItems);
--- apps/web/src/app/sidebar/WorkspaceSwitcher.tsx (render after "New workspace")
+          {useContributions('workspaceMenuItems').map((item) => (
+            <DropdownMenuItem key={item.id} icon={item.icon ? <item.icon /> : undefined}
+              onSelect={() => void item.run(ctx)}>{item.title}</DropdownMenuItem>
+          ))}
```

The desktop feature would then contribute "Open folder…" and "Workspaces…". Workaround: the
command palette, the File menu and Mod+O.

### 3. Generate Tailwind utilities for `apps/desktop/src` too

Why: `apps/web/src/styles.css` only scans `packages/*/src`, and the desktop package lives in
`apps/desktop` (SPEC 9.1), so classes used only there are never generated (found while reviewing
the screenshots: missing gaps and paddings).

```diff
--- apps/web/src/styles.css
 @source '../../../packages/*/src/**/*.{ts,tsx}';
+@source '../../desktop/src/**/*.{ts,tsx}';
```

Workaround: `apps/desktop/src/styles.css`, imported by `activate.ts` (so only inside the desktop
app), generates this package's utilities into the `components` layer, below the app's
`utilities`, so it can never override the shell. Delete that file and its import once the line
above lands.

## Known gaps and bugs

- **The container smoke test's owner and sync steps can't run on this branch**: `apps/server` is
  still the stub (only `/api/health`). The script detects it; with `--allow-stub` it checks what
  the image is responsible for (healthy, non-root, read-only root, `/data` persists across a
  restart, graceful stop) and passes. Its Hocuspocus client was verified against a real
  in-process Hocuspocus 4.7 server (sync, persistence, bad token rejected). After the merge it must
  pass without `--allow-stub` (see follow-ups).
- **Not verified on the cloud platforms** (no accounts here): the Fly.io, Railway and Render configs
  and the Unraid/CasaOS/Umbrel templates follow each platform's documented formats; the
  root-owned-volume path they rely on was tested locally (`--user 0` on a root-owned volume).
- **macOS was not built** (no Mac here); the steps are documented and CI builds it. Verified here:
  **Linux** `tauri build` in Docker (Debian bookworm) produced `Tessera_0.1.0_amd64.deb` (6.9 MB),
  `Tessera-0.1.0-1.x86_64.rpm` (7.0 MB) and `Tessera_0.1.0_amd64.AppImage` (98 MB); the `.deb`
  installs on a clean `debian:bookworm-slim` (depends on `libwebkit2gtk-4.1-0`, `libgtk-3-0`,
  `libayatana-appindicator3-1`), registers `x-scheme-handler/tessera`, and the app runs under Xvfb.
  **Windows**: the debug app passes `scripts/smoke-app.mjs` end to end (see Decisions), and the
  release build (`pnpm --filter @tessera/desktop build:app`) produced
  `Tessera_0.1.0_x64_en-US.msi` (6.5 MB) and `Tessera_0.1.0_x64-setup.exe` (NSIS, 5.2 MB).
- **Firefox e2e flakiness is pre-existing**: under parallel load, the Architect's shell specs
  sometimes time out in Firefox on this machine with or without the desktop feature (the baseline
  stub failed 1 of 13 in one run). Every desktop spec passes in both browsers.
- **The Architect's timing-sensitive unit tests time out on a busy machine**: with the other
  agents' dev servers and browsers running here (CPU at 100%), `App.test.tsx` (the shell tests take
  0.9–5.2 s each here) and `components.test.tsx > EmojiPicker` sometimes exceed Vitest's default
  5 s, even alone; with `--testTimeout=60000` they pass. They don't load desktop code
  (`features: []`). Suggestion for the Architect: a per-file timeout for these tests.
- **A stale e2e server is reused locally**: `playwright.config.ts` has `reuseExistingServer` outside
  CI, so a `vite preview` left running from an earlier run serves an old build (it cost me a
  debugging session). Stop it before running e2e after changes.
- **arm64 image** not built locally (the Dockerfile has nothing architecture-specific; the
  prune step keeps `linux-<arch>` prebuilds by `process.arch`).
- **The updater's install path** needs a signed release to exercise; the check path and the
  "not configured" path are tested.
- **Keychain** calls are exercised only on Windows by hand; unit tests cover validation (CI Linux
  runners have no Secret Service).
- **Global shortcuts on Linux Wayland** depend on the compositor (X11 works); the settings panel
  shows the error when registration fails.
- The markdown mirror re-exports the whole workspace after edits settle (4 s, at most 30 s), only
  writing changed files; an incremental exporter would be cheaper for very large workspaces.
- The shell's Settings → "Delete workspace" wording promises deletion; on the desktop the registry
  only forgets the workspace (the folder stays, per the `WorkspaceRegistry` contract). See
  follow-ups.

## Follow-ups for the merge (cross-agent wiring you couldn't finish alone)

- **Git history**: `main` was rewritten after this branch was cut (same commits, new hashes), so
  `feat/desktop` shares no ancestor with it. The trees match: this branch's base `312265a` is
  identical to `main`'s `ff8a7bf`, and `main` only adds `ffde8e0` (LICENSE, `HANDOFF/architect.md`),
  which this branch doesn't touch. Cherry-pick `312265a..feat/desktop` onto `main`, or merge with
  `--allow-unrelated-histories` (no conflicts expected).

- **Agent 03, server image**: serve the web build from `WEB_DIST_DIR` (the Dockerfile sets
  `/app/apps/web/dist`; `../../web/dist` relative to `apps/server/dist/main.js` also works).
  Keep `GET /api/health` as the health check. The server bundle must bundle (or list as
  dependencies) every npm package the `@tessera/core` code it includes imports (prosemirror-*,
  y-prosemirror…): the image installs only `@tessera/server`'s production dependencies.
  Allow the desktop app's origins in CORS: `http://tauri.localhost` (Windows) and
  `tauri://localhost` (macOS, Linux).
- **Agent 03, smoke test**: run `node deploy/smoke/smoke-test.mjs --build` (no `--allow-stub`).
  If the real CLI or API differs from its assumptions (`tessera-server create-owner --email E
  --password P --name N` or `POST /api/setup`; `POST /api/auth/login {email,password,client}` →
  `{token}`; `POST /api/workspaces {name}` → `{id}`; Hocuspocus at `/sync` with the token; doc
  `ws:<id>`), adjust the `server` object at the top of the script. The guides use
  `tessera-server create-owner` (interactive) and `tessera-server backup|restore <file>` (used by
  `MODE=online` backups): align the wording with the real CLI.
- **Agent 03, desktop sign-in**: after CCR 1, store the desktop's bearer token with
  `ctx.services.credentialStore` and pass it to the Hocuspocus provider; register
  `KeychainCredentialStore` in `createDesktopFeature()` (snippet in CCR 1). Check: sign in from the desktop
  app, restart it, it reconnects without asking; the token is in the OS keychain, not in files.
- **Agent 08**: the markdown mirror picks the first exporter in
  `['markdown', 'markdown-folder', 'markdown-zip', 'markdown-basic']` that supports the `workspace`
  scope and writes one file per page into the sink. Register yours under one of these IDs (or add
  yours to `MIRROR_EXPORTERS` in `apps/desktop/src/mirror/mirror.ts`). Check: Settings → Desktop →
  Keep a markdown copy, then look at `<workspace>/markdown/`.
- **Agent 09, CI**: `desktop.yml` with `tauri-apps/tauri-action`, `projectPath: apps/desktop`,
  Linux packages `libwebkit2gtk-4.1-dev libxdo-dev libssl-dev libayatana-appindicator3-dev
  librsvg2-dev`, `includeUpdaterJson: true`, secrets `TAURI_SIGNING_PRIVATE_KEY(_PASSWORD)`, and
  `args: --config '{"bundle":{"createUpdaterArtifacts":true},"plugins":{"updater":{"pubkey":"${{ vars.TAURI_SIGNING_PUBLIC_KEY }}"}}}'`.
  Rust checks: `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test` in
  `apps/desktop/src-tauri` (Linux runner with the packages above). `docker.yml`: `docker buildx
  build --platform linux/amd64,linux/arm64` from the root `Dockerfile`, then
  `node deploy/smoke/smoke-test.mjs --image <tag>` on amd64. Optional on `windows-latest`:
  `tauri build --debug --no-bundle` then `node apps/desktop/scripts/smoke-app.mjs`.
- **Agent 10**: the final logo replaces `apps/desktop/src-tauri/icons/source.svg`; run
  `pnpm --filter @tessera/desktop icons`. Docs: link `deploy/README.md` and the guides; screenshot
  paths below. The templates in `deploy/appstores/` point at the app icon until the logo exists.
- **Architect**: apply the CCRs; reword Settings → "Delete workspace" on the desktop ("Remove from
  list", the folder stays), for example when `ctx.platform.isDesktopApp`.
- **Agent 02**: Edit → Undo/Redo in the desktop menu send `Mod+Z`/`Mod+Shift+Z` keydowns to the
  focused editor; check they reach the Yjs undo manager after the merge.
- **Agent 06**: the desktop CSP allows `frame-src 'self' blob: https:` and `worker-src 'self'
  blob:`; check plugin iframes and workers load in the desktop app (`tauri.conf.json`).

## Screenshots (list of files)

`assets/screenshots/desktop/`, 1440×900, each as `-light.png` and `-dark.png`:

- `desktop-window`: the desktop app with a workspace (nested pages, icons, a cover, favorites, an
  Inbox filled by quick capture).
- `workspace-picker`: the picker with four workspaces (the open one, one synced by Dropbox, one not
  created yet, one whose folder is missing).
- `quick-capture`: the quick-capture window over the app.
- `desktop-settings`: Settings → Desktop.

Regenerate them with `pnpm screenshots e2e/desktop`.
