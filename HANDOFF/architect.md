# Architect handoff

Read `SPEC.md` first: it documents every contract. This file adds what the SPEC doesn't cover:
what exists and where, the decisions behind the contracts, what's missing, and notes for each agent.

## Plan

The six milestones of `agents/01-architect.md`, all done and committed on `main`:

1. Skeleton: pnpm workspace, root configs, `.claude/settings.json`, every package and app as a stub.
2. Data model and typed helpers (workspace, page and database docs), with tests.
3. The canonical document schema and DocJSON utilities, with tests covering every node and mark.
4. Service interfaces, in-memory stubs, service resolution and the runtime, with tests.
5. `packages/ui` and the app shell, with unit tests, e2e specs (Chromium and Firefox) and screenshots.
6. `SPEC.md`, `CLAUDE.md` updates, this folder, and every feature and package stub.

## Built (what exists and where)

**Root.** `package.json` (scripts: `dev`, `build`, `test`, `test:e2e`, `test:e2e:install`,
`screenshots`, `typecheck`, `lint`, `lint:fix`, `format`), `pnpm-workspace.yaml` (`apps/*`,
`packages/*`, `allowBuilds` for argon2, better-sqlite3 and esbuild), `tsconfig.base.json`,
`tsconfig.json` (e2e and root configs), `eslint.config.js`, `prettier.config.js`, `.prettierignore`,
`vitest.config.ts` (projects from `packages/*` and `apps/*`), `playwright.config.ts` (Chromium and
Firefox at 1440×900, traces and screenshots kept on failure, a production build served by
`vite preview`, a port per worktree), `playwright.screenshots.config.ts` (`*.screenshots.ts` files,
Chromium only), `.nvmrc`, `.editorconfig`, `.gitattributes`, `.gitignore`, `.claude/settings.json`
(allows pnpm, git read/add/commit, Playwright, cargo, docker build and read-only tools; denies
force pushes, `reset --hard`, `clean`, rebases, broad `rm -rf`, publishing and reading secrets).

**`packages/core`** (the contract; SPEC sections 4 to 6):

| Folder | Contents |
|---|---|
| `src/*.ts` | `ids`, `order` (fractional indexing), `json` and `json-schema`, `errors` |
| `src/model` | doc names, `PageMeta` (and its zod schemas in `page-meta-schema`), page helpers, the page index (tree, trash, rows, cycle breaking), `observePages`, page props, workspace doc settings |
| `src/database` | property and value types with zod schemas, view config types, every database doc helper, `observeDatabase` |
| `src/plugins` | `pluginManifestSchema`, permissions, `hasPluginPermission`, `PLUGIN_API_VERSION` |
| `src/schema` | `tesseraSchema`, node and mark types, `SCHEMA_DESCRIPTION` (+ `schema-description.json`), DocJSON validation and normalization, Yjs conversion, extractors, mentions, tags, embeds, builders, `kitchenSinkDoc` |
| `src/services` | `DocStore`, `AssetStore`, `SyncProvider`, `WorkspaceRegistry`, `SearchIndex`, `LinkIndex`, `MarkdownCodec`, `Importer`, `Exporter`, with in-memory or naive implementations; service registration and resolution |
| `src/runtime` | `createAppRuntime`, workspace sessions, `DocManager`, `EventBus`, `CommandRegistry`, `BlockRendererRegistry`, `ContributionRegistry`, `FeatureModule`, `AppContext`, settings stores, keyboard helpers, platform detection, the current user |
| `src/react` | `AppContextProvider` and hooks (`usePages`, `usePageDoc`, `useContributions`, `useSetting`, …) |
| `src/testing` | `createTestAppContext`, `createRecordingShell`, fixtures, the jsdom setup file |

**`packages/ui`**: tokens (`styles/tokens.css`), the Tailwind theme (`styles/theme.css`), base styles,
Radix-based components (`components/*`), the i18n runtime (`i18n/i18n.ts`), cover presets and the
emoji picker. Every component is on `/dev/ui`.

**`apps/web`**: `src/main.tsx` (boot), `src/app/*` (the shell: layout, sidebar and page tree, top bar,
page view, trash, settings, onboarding, shortcuts, theme, bridge, diagnostics, `/dev/ui`),
`src/i18n` (shell strings and the locale loader), `src/features/*` (nine stub feature modules, now
owned by their agents), `public/theme-init.js`, `public/favicon.svg`, `vite.config.ts`.

**Stubs owned by other agents** (each with `package.json`, `tsconfig.json`, `vitest.config.ts`,
`tsdown.config.ts`, `src/index.ts` and a passing test): `packages/editor`, `sync`, `db-views`,
`search`, `plugins`, `plugin-api`, `create-tessera-plugin`, `markdown`, `importers`, `testkit`;
`apps/server` (Hono app with `/api/health`, `src/main.ts`, `README.md`); `apps/desktop` (`isTauri()`,
`README.md`). Their dependencies are pre-installed (SPEC section 13.1).

**Tests.** 35 Vitest files (about 270 tests) across the repo. `e2e/architect`: `smoke.spec.ts`
(create, rename, trash, restore, undo), `page-tree.spec.ts` (nest and reorder by drag, keyboard and
menus), `shell.spec.ts` (themes, shortcuts, sidebar, icon and cover, favorites, diagnostics, feature
isolation, phone drawer), `shell.screenshots.ts`, `helpers.ts`.

## How it plugs in (FeatureModule entries, services, extension points used)

The shell is the host, not a feature. It registers its own commands (`COMMANDS.newPage`,
`toggleSidebar`, `toggleTheme`, `showShortcuts`, `openSettings`, `openTrash`, `focusTitle`) when a
workspace opens, renders every contribution kind (SPEC 6.3) inside `FeatureBoundary`, implements
the `ShellBridge` (navigation, side panels, toasts, confirmations, `switchWorkspace`), and publishes
`window.__tessera.diagnostics()`. The in-memory stubs are the fallbacks of every service.

## Decisions (and why)

- **Stack.** TypeScript 6.0.3 and ESLint 9 because typescript-eslint and jsx-a11y don't support
  TypeScript 7 or ESLint 10 yet; Hono for the server API; React Router 8 in declarative mode. See
  SPEC 13.
- **Per-page nested `Y.Map`s** in the workspace doc so concurrent edits of different fields merge.
- **Rows are pages** (`rowId === pageId`): titles, icons, timestamps and trash come for free, row
  pages open like any page, and links to rows are ordinary `pageLink`s. Values live in the database
  doc so views never load row pages.
- **Implicit trash** (only the trashed page is marked) so restoring brings back exactly what was
  trashed, and nested trashing doesn't lose information.
- **Deterministic tree repair**: orphans at the top level, cycles broken at the smallest ID. Sync
  can produce both; every client shows the same tree.
- **Page docs are created lazily**, so a new page costs one map entry.
- **Schema extras**: `blockId` (block links, backlinks context, scroll targets), `color` on text
  blocks (Notion colors), `paragraph+` table cells (markdown-compatible), `pageLink.blockRef`,
  `link.title`, the `file` embed kind, `SyncStatus` `syncing`.
- **Service phases** so each service's `create` gets exactly what exists at that point; stubs of the
  codec and the indexes load on demand.
- **Events are derived from the workspace doc**, so local, remote and other-tab changes all fire
  them the same way.
- **`activate` failures remove everything the feature registered**, including runtime registrations
  made through `ctx` before the error.
- **The current user's ID is a live device setting**, so the sync feature can switch it to the
  account ID after signing in.
- **Extension points added for needs in the agent files**: `overlays` (palette, import and export
  dialogs), `pageFooterSections` (backlinks footer), `layout: 'bare'` routes (quick capture),
  `ctx.switchWorkspace` (desktop folders, server workspaces), and `window.__tessera.diagnostics()`
  (journeys that skip until a feature is merged).
- **Shell**: Mod+Alt+N besides Mod+N (Chromium reserves Mod+N); `theme-init.js` applies the theme
  before paint; changing the language reloads the app; router transitions are off, so navigations
  render with the change that caused them (otherwise the home view's redirect dropped the "focus
  the title" state); Trash and Settings are lazy with an idle-time preload; the phone sidebar is a
  modal sheet that returns focus to its opener.
- **Startup bundle 215 KB gzip** (budget 250): the zod schemas, ProseMirror, the DocJSON helpers,
  the database helpers and the stub services stay out of the entry chunk. `vite build` warns above
  750 KB minified per chunk.
- **e2e**: one port per worktree so parallel agents never test each other's servers; screenshot
  runs use their own config so `pnpm test:e2e` never rewrites tracked images.
- **`create-tessera-plugin`** is unscoped because `pnpm create tessera-plugin` resolves that name.

## Contract change requests (exact proposed diff to packages/core, and why)

None. The Architect owns the contract; every change is described above and in SPEC 13.3.

## Known gaps and bugs

- **The LICENSE file holds GPL-3.0**, from the repository's initial commit, while `CLAUDE.md`,
  `SPEC.md` and every `package.json` say MIT. `LICENSE` belongs to Agent 10, whose assignment is to
  write the MIT license. The owner should confirm the license.
- **Data lives in memory** until the sync feature merges: a reload starts at onboarding.
- **Only English** exists; the language select is disabled until a second locale ships.
- Pressing Enter in the emoji search before its data finishes loading (a few hundred ms, first use
  only) does nothing; clicking a result works.
- Radix Select, RadioGroup and ScrollArea are in the startup bundle (about 10 KB gzip) because
  `packages/ui/src/components/forms.tsx` also exports the inputs the shell uses at startup. Split
  the file if the budget gets tight.
- The logo and favicon are placeholders (`apps/web/src/app/LogoMark.tsx`, `apps/web/public/favicon.svg`).
- Firefox e2e runs are slow against the dev server with many workers (fine against the production
  build that `pnpm test:e2e` uses).

## Follow-ups for the merge (cross-agent wiring you couldn't finish alone)

- Apply approved contract change requests first, then check `window.__tessera.diagnostics().services`
  in the browser and the desktop app: IndexedDB or Tauri stores, Hocuspocus, MiniSearch, the graph
  link index and the remark codec should all win over the stubs.
- Replace the placeholder logo and favicon with Agent 10's final assets.
- Re-measure the startup bundle with every feature registered; move heavy imports out of feature
  registration modules if it exceeds 250 KB gzip.
- The cross-feature flows listed in SPEC 12, and every agent's follow-ups.

## Screenshots (list of files)

`assets/screenshots/architect/`, 1440×900 except the phone shots (390×844), each in `-light.png`
and `-dark.png`:

- `onboarding`: the first-run screen.
- `shell`: a workspace with nested pages, favorites, icons and a cover.
- `shortcuts`: the keyboard shortcuts overlay.
- `trash`: the Trash view with two pages.
- `settings`: Settings → General.
- `phone`, `phone-sidebar`: the page and the sidebar drawer at phone width.
- `dev-ui`: the component gallery.

Regenerate them with `pnpm screenshots e2e/architect`.

## Notes for each agent

**Agent 02 (Editor).** You implement the `page` body: register `pageBodies: { page: … }` in
`features/editor` with a lazily imported component, and build TipTap on the page doc from
`usePageDoc(pageId)` (or `ctx.acquirePageDoc`), binding Collaboration to `getPageContent(handle.doc)`
(`@tiptap/y-tiptap` is installed). Never create a provider or persistence, and track only your own
origin in the undo manager. Your schema must equal `SCHEMA_DESCRIPTION`: describe `editor.schema`
with `describeSchema` and assert that `diffSchemaDescriptions` finds nothing. Expect drift in TipTap's
`link` (only `href` and `title`), table cells (`paragraph+`, not `block+`), `image`
(`assetId`, `src`, `alt`, `title`, `width`, `blockId`), `highlight.color` and the `blockId`/`color`
attributes (SPEC 5.1); `callout`, `toggle`, `toggleSummary`, `embed`, `pageLink` and `tag` are yours
to write. `PageBodyProps` gives you `registerFocusHandler` (Enter in the title lands in the first
block), `focusTitle('end')` (ArrowUp at the start), `readOnly` (trashed pages) and `target` (scroll to
a heading slug from `headingSlug` or a block ID). Render embeds through `ctx.blocks.resolve(kind)`,
with a "This block needs a plugin" placeholder for unknown kinds; register the `web` renderer
yourself and list `ctx.blocks.slashMenuItems()` in the slash menu. Page links show live titles with
`usePage`, navigate with `ctx.navigate(pageId, { heading, blockId })`, and create pages with
`ctx.workspace.createPage`. Tag clicks run `ctx.commands.execute(COMMANDS.search, { args: { query: '#' + name } })`,
which resolves false until search merges. Clipboard goes through `ctx.services.markdownCodec`: the
stub knows only paragraphs and headings, so test with a richer fake codec. Images go through
`ctx.services.assetStore.put`, and you store the `assetId`. Cursors use `handle.sync.awareness`, whose
`user` field already holds `{ id, name, color }`. Full width and small text are page props
(`setPageProp(doc, 'fullWidth', true)`) that the shell already applies. Pitfalls: keep TipTap out of
the startup bundle (all features share about 35 KB of headroom), import ProseMirror through
`@tiptap/pm/*` or the pinned packages so Vite's dedupe keeps one copy, and never mirror content into
React state.

**Agent 03 (Storage & sync).** You replace four stubs at priority 50, all registered as `services` in
`features/sync` with dynamic imports: `MemoryWorkspaceRegistry` (app phase), `MemoryDocStore` and
`MemoryAssetStore` (storage phase) with IndexedDB versions, and `LocalSyncProvider` with Hocuspocus.
The core `DocManager` already runs the document lifecycle. It loads with `DocStore.load`, applies
other tabs' updates from `DocStore.watch` without writing them again, and calls `storeUpdate` for
every local and remote update, retrying failures, so resolve only when the write is durable. It
compacts busy docs with `compact` on close, and keeps the awareness `user` field current. Your store
therefore needs a BroadcastChannel-backed `watch`, compaction that can't race `storeUpdate`, and a
clear toast on quota errors. Make the Hocuspocus provider available in the browser and let a
workspace work locally until it has a `serverUrl`. The registry's `subscribe` tells you when that
changes; `ctx.switchWorkspace(currentId)` reopens the workspace with fresh services. To open a
server workspace locally, call `workspaceRegistry.create({ id, name, serverUrl })`, then
`ctx.switchWorkspace(id)`. After sign-in, set `SETTING_KEYS.userId` in `ctx.settings.device` to the
account ID; authorship and awareness follow. Your UI plugs in through `topBarItems` (status,
`useSyncStatus`), `pageHeaderActions` (presence), `pageSidePanels` with `PANELS.history`, and a
`settingsPanels` entry. Restore a version with `writeDocJSON` as a new edit. `page.deleted` events
tell you which pages to delete on the server; core already deletes the local docs. `apps/server` has
a Hono app with `/api/health`, a `main.ts` entry and a tsdown build that bundles `@tessera/*`, with
Hocuspocus, SQLite, argon2 and pino installed. Pitfalls: never persist awareness, and enforce every
permission on the server. Tests that reload the page need your stores, because the skeleton keeps
data in memory.

**Agent 04 (Databases).** You own the `database` page kind: register `pageBodies.database`,
`pageTopSections` for row properties (`when: (page, ctx) => ctx.workspace.pages.getSnapshot().isRow(page.id)`),
and the `database` embed kind in `blockRenderers`, whose slash items create a database with
`ctx.workspace.createDatabase` and return `{ kind: 'database', ref: page.id, data: { viewId } }`.
Everything in the database doc goes through the core helpers (`addProperty`, `updateProperty`,
`addSelectOption`, `setRowValue`, `moveRow`, `addView`, `updateView`, `duplicateView`,
`observeDatabase`, …) and rows through `ctx.workspace.addDatabaseRow`, because a row is a page: its
title, icon and trash state live in `PageMeta`, and `rowId === pageId`. `resolveRows(listRows(db), pages)`
joins rows with page metadata and flags `trashed` rows (hide them) and `missingPage` rows, and
`getCellValue` reads computed columns. The `ViewConfig`, filter, sort, group and summary types are
fixed in core, while the query engine in `packages/db-views/src/query` is yours; keep it pure,
because plugins and exports will call it after the merge. Load docs with `useDatabaseDoc(id)`, react
to `observeDatabase` or `database.changed`, map `TagColor` names to the `bg-tag-*`/`text-tag-*`
utilities, and use `setRowTemplate` for row templates. No stub is replaced; until the editor merges,
row pages show the shell's placeholder body. Pitfalls: never load row pages to render a view, rename
rows with `ctx.workspace.renamePage` (the title is not a stored value), treat values that fail
validation after a type change as empty without deleting them, keep two-way relations consistent on
`page.trashed` and `page.deleted`, and lazy-load the views, since react-table, react-virtual and
dnd-kit are heavy.

**Agent 05 (Search, palette, backlinks and graph).** You replace `NaiveSearchIndex` and
`NaiveLinkIndex` with `MiniSearchIndex` and `GraphLinkIndex` at priority 50. Both are `index`-phase
services, so `create` receives `pages`, `loadPageDoc`, `loadDatabaseDoc`, `events` and the storage
services; keep them current from `doc.changed`, `page.*` and `database.changed` (row values) with
`readDocJSON` and the `extract*` utilities, and drop trashed pages at once. Register the palette as
an `overlays` entry plus `COMMANDS.openPalette` on the reserved `Mod+K` (the sidebar's Search button
appears when that command exists), `COMMANDS.search` with `{ query }` args (the editor runs it for tag
clicks), the `/search` and `/graph` routes, the `PANELS.backlinks` and `PANELS.localGraph` side
panels, and the optional backlinks footer as `pageFooterSections` behind the workspace setting
`backlinks.showFooter`. The Link button for an unlinked mention is
`updateDocJSON(handle.doc, (doc) => replaceTextWithPageLink(doc, mention, { pageId }))`, and the
`aliases` page prop feeds mentions and link resolution. Pitfalls: keep indexing and graph layout off
the main thread, rebuild persisted indexes when `DOC_SCHEMA_VERSION` or `DATA_MODEL_VERSION`
changes, call sigma's `kill()` on unmount, take graph colors from the CSS tokens so both themes
work, and export each panel and route from its own subpath of your package, because your three
feature folders share it and the startup bundle must stay small.

**Agent 06 (Plugins).** You build on `pluginManifestSchema`, `PLUGIN_PERMISSIONS`,
`hasPluginPermission`, `PLUGIN_API_VERSION` and `pluginBlockKind(id, type)` from core; no stub is
replaced. The host registers a `settingsPanels` entry (Settings → Plugins) and a `plugin:` prefix
in `blockRenderers` statically, each plugin block rendering in its own sandboxed iframe, then for
each enabled plugin registers commands with `ctx.commands.register`, panels with
`ctx.contributions.register('pageSidePanels', { id: 'plugin:<id>/<panel>', … }, 'plugins')` and
slash-menu entries with `ctx.blocks.registerSlashMenuItems`, removing all of it on disable. The API
maps onto core: `api.pages.*` onto `ctx.workspace`, `readDocJSON`/`writeDocJSON` and the markdown
codec; `onChange` onto the `page.*` and `doc.changed` events; `api.databases.*` onto the database
helpers and `ctx.workspace.addDatabaseRow`; `api.ui.notify` onto `ctx.toast`; `api.theme` onto the
`--tess-*` CSS variables. `api.databases.query` can't import Agent 04's query engine (another
agent's package), so implement simple filtering now and list the engine as a merge follow-up.
Pitfalls: never combine `allow-scripts` with `allow-same-origin`, validate every manifest and RPC
message on the host with zod, check permissions on every call, and keep `packages/plugin-api` free
of host code so plugin bundles stay small.

**Agent 07 (Desktop & self-host).** You replace the registry, doc store and asset store with Tauri
versions at priority 100, each with `isAvailable: () => isTauri()` from `@tessera/desktop`, so they
never win in a browser. `WorkspaceInfo.path` holds the workspace folder: after a native dialog picks
one, call `ctx.services.workspaceRegistry.create({ name, path })`, then `ctx.switchWorkspace(id)`.
The markdown mirror runs an exporter from `ctx.exporters` into your folder `ExportSink`; core's
`markdown-basic` exporter serves until Agent 08's lands. Quick capture can be a `layout: 'bare'`
route (for example `/capture`) opened in a small always-on-top window, and deep links map to
`ctx.navigate(pageId)`. The server is Agent 03's: the Dockerfile builds `apps/web` and
`apps/server`, the server serves the web build, `pnpm install --frozen-lockfile` must pass in the
image, and native modules (better-sqlite3, argon2) are already in `allowBuilds`. Pitfalls: keep
Tauri imports behind `isTauri()` and dynamic imports so the browser build never breaks, warn about
SQLite in cloud-synced folders, and never commit signing keys.

**Agent 08 (Markdown, import & export).** You replace `BasicMarkdownCodec` (app phase, priority
50) with the remark codec, and core's `markdown-basic` importer and exporter with yours (your dialogs
decide what to list, and registering under an existing ID replaces the core entry). The codec is
synchronous by contract (`parse`, `serialize`, `parseHTML`), so load it in the service's async
`create` to keep unified out of the startup bundle, run `normalizeDocJSON` last so output is
canonical, and resolve links and files with `resolvePageLink`, `resolveAsset`, `resolvePage` and
`resolveAssetPath`. Importers get an `ImportContext` (`workspace`, `loadPageDoc`,
`loadDatabaseDoc`, `assets`, `codec`, `rootTitle`, `parentId`, `currentUser`): create everything
under one new root page, write content with `writeDocJSON`, databases with
`ctx.workspace.createDatabase` and rows with `addDatabaseRow`, and pass every path through
`normalizeImportPath`. The dialogs are `overlays` opened by `COMMANDS.openImport` and
`COMMANDS.openExport`, and the first-run buttons are `onboardingActions` (the shell creates and
opens the workspace, then calls `run(ctx)`). Pitfalls: reject zip-slip paths, sanitize all HTML
with DOMPurify, keep the codec deterministic, run imports in a worker, and remember that the
editor's paste depends on your `parseHTML`.

**Agent 09 (CI & quality).** The root scripts already run everything by glob (`pnpm typecheck`,
`lint`, `test`, `test:e2e`, `screenshots`), so workflows call them instead of per-package commands.
Install browsers with `pnpm test:e2e:install`. Playwright's `webServer` builds and previews the app:
port 4173 in the main folder, one port per worktree elsewhere, retries and the HTML report under
`CI`. `packages/testkit` is yours. Generate workspaces through the core helpers (`createPage`,
`writeDocJSON`, `initDatabaseDoc`, `addRow`, … on `Y.Doc`s), so data is valid by construction, and
build test helpers on `createTestAppContext`. Journeys in `e2e/journeys` detect missing features
with `window.__tessera.diagnostics()`; `readDiagnostics` in `e2e/architect/helpers.ts` shows how.
For example, `page` missing from `contributions.pageBodies` means no editor yet. They then skip with
a clear message. The bundle check should measure the entry chunk plus its static imports against
250 KB gzip (215 KB today). Pitfalls: the skeleton keeps data in memory, so journeys that reload
must wait for the sync feature; Chromium reserves Mod+N, so use Mod+Alt+N; and every CI check should
also run locally through the same scripts.

**Agent 10 (Docs & launch).** `SPEC.md` is the source for the architecture docs. Its Mermaid
diagram, data model, schema table, extension points and budgets are written for engineers; link it
from the contributor guide. The shell's screenshots are in `assets/screenshots/architect/`:
`onboarding`, `shell`, `shortcuts`, `trash`, `settings`, `phone`, `phone-sidebar` and `dev-ui`, each
as `-light.png` and `-dark.png`. The other agents' names are in their agent files. Brand colors come
from `packages/ui/src/styles/tokens.css`; the accent is `--tess-accent`, an indigo. The shell uses a
placeholder mosaic logo (`apps/web/src/app/LogoMark.tsx`, `apps/web/public/favicon.svg`). Put the
final SVGs in `assets/` and list the swap as a merge follow-up, since those files are the
Architect's. `LICENSE` is yours, and today it holds GPL-3.0 text from the repository's initial
commit: replace it with the MIT license your assignment asks for, and flag the change to the owner
in HANDOFF. The demo workspace is a markdown folder that Agent 08's importer loads, so stay within
what the markdown importer supports: wikilinks, frontmatter `tags` and `aliases`, callouts, tasks,
tables, and CSV files for databases. Pitfalls: document new pages as Mod+Alt+N for browsers, keep
stretch goals out of the feature list, and use the screenshot paths exactly as the agents name them.
