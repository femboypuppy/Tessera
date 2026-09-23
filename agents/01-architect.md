# Agent 01 — Architect / tech lead

**Runs first, alone, on `main`. Effort: max.**

You are the tech lead of Tessera (see `CLAUDE.md`). The moment you finish, nine agents start in parallel, each on its own branch, unable to talk to each other or to you. Everything they need to build their part independently, and to merge cleanly afterwards, must exist when you're done.

Your two outputs:

1. **A running skeleton app** that every agent can build on.
2. **Contracts so precise that integration is boring:** data model, document schema, interfaces, extension points, stubs, and a SPEC that answers questions before anyone asks them.

Spend your thinking on the contracts. A vague interface now costs nine agents hours later.

## Stack defaults

Use these unless you find a concrete problem. If you change one, document why in `SPEC.md`.

- pnpm workspaces, current Node LTS, TypeScript `strict`, ESM everywhere
- Vite + React 19, React Router, Zustand for UI state
- Tailwind CSS v4 + Radix UI primitives + CSS-variable design tokens, lucide-react icons
- Yjs for all document state; TipTap (ProseMirror) editor; Hocuspocus sync server
- Vitest + Testing Library; Playwright
- zod for validation, nanoid for IDs, fractional-indexing for ordering
- ESLint (flat config) + Prettier

Use the latest stable versions and pin them exactly.

## Deliverable 1 — Monorepo skeleton

- Layout:
  - `apps/web`, `apps/server` (stub with README), `apps/desktop` (stub with README)
  - `packages/core`, `packages/ui`, `packages/editor`, `packages/sync`, `packages/db-views`, `packages/search`, `packages/plugins`, `packages/plugin-api`, `packages/markdown`, `packages/importers`, `packages/testkit`
  - `docs/`, `examples/`, `e2e/`, `assets/screenshots/`, `HANDOFF/`
- Every package gets a `package.json` named `@tessera/<name>`, a `tsconfig.json` extending `tsconfig.base.json`, `src/index.ts`, one passing test, and `build`, `test`, `typecheck` and `lint` scripts.
- **Globs, not lists:** `pnpm-workspace.yaml` uses `apps/*` and `packages/*`; root scripts use `pnpm -r`; Vitest discovers tests everywhere; Playwright runs `e2e/**/*.spec.ts`. Adding a package or an e2e folder must never require a root edit.
- `apps/web` depends on every internal package (`workspace:*`), so features can import their own package without touching `apps/web/package.json`.
- **Pre-install the obvious dependencies** in each package so agents rarely touch lockfiles: TipTap, y-prosemirror and lowlight in `editor`; the Hocuspocus provider and y-indexeddb in `sync`; the Hocuspocus server, better-sqlite3, a web framework (Fastify or Hono), argon2 and pino in `apps/server`; MiniSearch, graphology, sigma and graphology-layout-forceatlas2 in `search`; @tanstack/react-table, @tanstack/react-virtual and @dnd-kit in `db-views`; unified, remark-parse, remark-gfm, remark-frontmatter, remark-stringify and DOMPurify in `markdown`; a zip library (fflate or JSZip) in `importers`.
- Configure Tailwind so classes used in any `packages/*/src` get generated (Tailwind v4 `@source`). Otherwise styles written in packages silently disappear.
- `.claude/settings.json` that allowlists safe, frequent commands (pnpm scripts, `git status`, `git diff`, `git log`, `git add`, `git commit`, Playwright, `cargo`, `docker build`) so agents aren't blocked on permission prompts. Use the current Claude Code permission rule syntax. Never allow destructive commands (`git push --force`, `git reset --hard`, `rm -rf` on broad paths).
- `.nvmrc`, `.editorconfig`, `.gitignore`, `.gitattributes`.

## Deliverable 2 — Data model (`packages/core`)

Start from this design. Refine it if you see problems, and document the final version in `SPEC.md`.

- **Workspace Y.Doc** (name `ws:<workspaceId>`)
  - `pages`: `Y.Map<pageId, PageMeta>` where `PageMeta = { id, kind: 'page' | 'database', title, icon?, cover?, parentId: string | null, order: string /* fractional index */, createdAt, updatedAt, createdBy?, trashedAt?: number, favorite?: boolean }`
  - `settings`: `Y.Map`
- **Page Y.Doc** (`page:<pageId>`): `content` (a `Y.XmlFragment` holding the ProseMirror document) and `props` (a `Y.Map` for page-level properties such as tags and aliases).
- **Database Y.Doc** (`db:<databaseId>`): `schema` (property definitions), `views` (view configs) and `rows` (`Y.Map<rowId, { pageId, order, values: Y.Map<propertyId, value> }>`). Each row's body is an ordinary page doc. Row values live in the database doc so views can filter and sort without loading every row page.
- Titles live in `PageMeta` (fast sidebar, search and link autocomplete). The page header edits `PageMeta.title`.
- IDs: nanoid(21). Timestamps: epoch milliseconds. Ordering: fractional indexes.
- **Typed helpers only.** Other agents must never poke raw Y.Maps. Provide `createPage`, `renamePage`, `movePage`, `setIcon`, `trashPage`, `restorePage`, `deletePagePermanently`, `observePages`, `getChildren` and `getAncestors`, plus database helpers (`createDatabase`, `addProperty`, `updateProperty`, `deleteProperty`, `addRow`, `setRowValue`, `deleteRow`, `addView`, `updateView`, `deleteView`, and so on). All transactional, all tested.
- **Database types:** property types `title`, `text`, `number` (with format), `select`, `multiSelect`, `date` (optional end and time), `checkbox`, `url`, `email`, `relation` (target database or any page), `createdTime`, `updatedTime`; select options with colors; zod schemas for every value type. View config types: `table | board | calendar | gallery | list`, a filter tree (nested AND/OR groups with operators per property type), sorts, grouping, visible properties, column widths and card options. Types only: the query engine belongs to Agent 04.
- **Plugin types:** `PluginManifest` (zod schema: id, name, version, apiVersion, author, description, entry, permissions) and the list of permission names (`pages:read`, `pages:write`, `databases:read`, `databases:write`, `ui:commands`, `ui:panels`, `ui:blocks`, `storage`, `network:<domain>`). Agent 06 builds the host and SDK on top of these.

## Deliverable 3 — Canonical document schema (the most important contract)

In `packages/core/src/schema/`, define a ProseMirror `Schema` (with `prosemirror-model`, no DOM required) with exact node and mark names, attributes and content rules. The editor must implement exactly this schema, the markdown codec must produce exactly this schema, and the indexers must parse exactly this schema.

- **Nodes:** `doc`, `paragraph`, `heading` (level 1–3), `bulletList`, `orderedList` (start), `listItem`, `taskList`, `taskItem` (checked), `blockquote`, `callout` (emoji, tone), `codeBlock` (language), `horizontalRule`, `image` (assetId or src, alt, title, width), `table`, `tableRow`, `tableHeader`, `tableCell`, `toggle` (open) containing a `toggleSummary` plus block content, `embed` (kind, ref, data), `pageLink` (inline atom: pageId, label, heading), `tag` (inline atom: name), `hardBreak`.
- **Marks:** `bold`, `italic`, `underline`, `strike`, `code`, `link` (href), `highlight` (color).
- `embed` is the generic extension block: `kind: 'database'` (ref = databaseId, data = viewId), `kind: 'web'` (ref = URL), and `kind: 'plugin:<pluginId>/<blockType>'` (data = plugin JSON). Anything that isn't core text formatting goes through `embed`.
- `pageLink` stores only the target ID. Renderers show the target's *current* title, so renames propagate automatically.
- Export `DocJSON` (ProseMirror JSON for this schema) and headless utilities built on y-prosemirror's JSON conversion helpers: `readDocJSON(ydoc)`, `writeDocJSON(ydoc, json)`, `extractPlainText`, `extractHeadings`, `extractLinks` (target pageId, label and the surrounding block's text), `extractTags`, `extractTasks`, `extractEmbeds`, `extractAssetIds`.
- Export a machine-readable description of the schema (node and mark names, attributes, content expressions). The editor's conformance test compares against it.
- Test every node, mark and utility: nested lists, tables, toggles, links inside all of them, unicode, empty documents.

## Deliverable 4 — Interfaces, extension points and stubs

In `packages/core`, define and document (TSDoc with a short example each) everything below, and provide a working **in-memory or stub implementation** of each. Stubs must be good enough that every agent can build and test their feature today.

- `DocStore`: `load(docName)`, `storeUpdate(docName, update)`, `compact(docName)`, `delete(docName)`, `list(prefix)`.
- `AssetStore`: `put(file) → { assetId, url }`, `get(assetId)`, `getUrl(assetId)`, `delete(assetId)`. The in-memory stub uses object URLs.
- `SyncProvider`: `connect(docName, ydoc) → SyncHandle { status, onStatus, awareness, destroy }`, with statuses `local | offline | connecting | synced | error`. The stub is local-only.
- `WorkspaceRegistry`: list, create, open, rename and remove local workspaces (each with an optional server URL).
- `SearchIndex`: `upsert(pageId)`, `remove(pageId)`, `query(q, options) → hits with highlight ranges`. The stub does naive substring search.
- `LinkIndex`: `backlinks(pageId)`, `outgoing(pageId)`, `unlinkedMentions(pageId)`, `edges()`. The stub is naive.
- `MarkdownCodec`: `parse(markdown) → { doc: DocJSON, frontmatter }`, `serialize(doc, options) → markdown`, `parseHTML(html) → DocJSON`. The stub handles paragraphs and headings only.
- `Importer` (`id`, `label`, `detect(files)`, `run(files, ctx, onProgress, signal) → ImportReport`) and `Exporter`.
- `CommandRegistry`: commands with `id`, `title`, `keywords`, `shortcut`, `when` and `run(ctx)`.
- `BlockRendererRegistry`: maps an `embed` kind (or a kind prefix such as `plugin:`) to a React component receiving `{ node data, updateData, selected, readOnly }`, plus slash-menu entries for inserting it.
- `EventBus`: typed events such as `page.created`, `page.renamed`, `page.moved`, `page.trashed`, `page.restored`, `page.deleted`, `doc.changed` (pageId, debounced), `workspace.opened` and `workspace.closed`.
- `AppContext`, what features receive: workspace helpers; `acquirePageDoc(pageId)` and `acquireDatabaseDoc(id)` returning **ref-counted handles** (loaded through `DocStore`, connected through `SyncProvider`, released when unused); services; `events`; `commands`; `currentUser` (`{ id, name, color }`); `navigate(pageId)`; `openSidePanel(id)`; `toast(...)`; `settings`.
- `FeatureModule`: `{ id, routes?, sidebarSections?, commands?, pageBodies?, pageTopSections?, pageHeaderActions?, pageSidePanels?, topBarItems?, blockRenderers?, editorExtensions?, settingsPanels?, onboardingActions?, importers?, exporters?, services?, activate?(ctx) → cleanup }`.
  - `pageBodies` maps a page kind to the component that renders its body: the editor feature provides `page`, the databases feature provides `database`.
  - `pageTopSections` render between the title and the body (for example, database row properties).
- **Service resolution:** each service registration is `{ provides, priority, isAvailable(), create(ctx) }`. At boot the shell picks, for each service, the highest-priority available registration and falls back to your in-memory stub. Document the priorities: in-memory 0, browser (IndexedDB) 50, desktop (Tauri) 100. This is how the sync, desktop, search and markdown agents replace your stubs without touching the shell.

## Deliverable 5 — App shell (`apps/web`)

- **Layout:** a collapsible left sidebar (workspace switcher, search button, favorites, page tree with drag to reorder and nest, "New page", trash), a top bar (breadcrumbs, `topBarItems`, page actions), the main page area, and a right side-panel host for `pageSidePanels`.
- **Page view:** icon picker, editable title bound to `PageMeta.title`, optional cover, `pageTopSections`, then the body from `pageBodies` for the page's kind. Show a clean placeholder when no body is registered yet.
- **Feature loader:** `apps/web/src/features/index.ts` imports all nine feature modules: `editor`, `sync`, `databases`, `search`, `graph`, `backlinks`, `plugins`, `import-export` and `desktop`. Create each folder with a stub `index.ts` exporting an empty `FeatureModule`, so the registry never needs editing again.
- **Routes:** `/p/:pageId`, `/trash`, `/settings/*`, plus routes contributed by features.
- **Onboarding (first run):** "Create an empty workspace", plus the buttons features contribute through `onboardingActions` (import, open demo). Hide whatever isn't registered.
- **Keyboard:** a global shortcut system with a help overlay (`?`). Defaults: `Mod+N` new page, `Mod+\` toggle sidebar, `Mod+Shift+L` toggle theme, `Mod+K` reserved for the command palette.
- **Settings:** sections contributed by `settingsPanels`, plus a built-in General section (theme, language, your display name and color).
- **Theme:** light, dark, system.
- An **error boundary** around each feature, so one crashing feature never takes down the app.
- A hidden `/dev/ui` route showing every `packages/ui` component, for visual checks.

## Deliverable 6 — `packages/ui`

- Design tokens as CSS variables (color, spacing, radius, type scale, shadows, motion durations) with light and dark themes. Aim for calm, modern and dense-but-breathable, in the spirit of Linear and Notion, with one accent color.
- Components wrapping Radix: Button, IconButton, Input, Textarea, Select, Checkbox, Switch, Dialog, AlertDialog, DropdownMenu, ContextMenu, Popover, HoverCard, Tooltip, Tabs, Toast, ScrollArea, Kbd, Spinner, Skeleton, EmptyState, Badge, Avatar, sidebar and panel primitives, and an emoji picker.
- A `t()` i18n helper with an English strings file per package namespace, so community translations are easy later.

## Deliverable 7 — `SPEC.md`

A document that an engineer who never talked to you could build their part from:

- vision and one-line pitch; v1 scope and explicit non-goals
- architecture diagram (Mermaid: web and desktop clients, services, DocStore, SyncProvider, server)
- the data model and a schema table (every node and mark with its attributes)
- every interface with a usage example; the extension points and service priorities
- directory ownership (must match `CLAUDE.md`) and coding conventions
- **performance budgets** (suggested: shell JS ≤ 250 KB gzip before the editor chunk; typing latency < 16 ms p95 on a 2,000-block page; search p95 < 50 ms on 5,000 pages; cold start < 2 s with 5,000 pages)
- security principles and the merge plan

## Deliverable 8 — Quality baseline

Vitest across all packages; a Playwright config (Chromium and Firefox projects, screenshots and traces on failure) with one smoke test (open the app, create a page, rename it, see it in the sidebar, trash it, restore it); ESLint and Prettier; everything passing. CI workflows belong to Agent 09, so don't write them.

## Milestones (commit to `main` after each)

1. The skeleton builds, `pnpm dev` runs, and `.claude/settings.json` is in place.
2. Data model and helpers, with tests.
3. Document schema and utilities, with tests.
4. Interfaces, stubs and service resolution, with tests.
5. `packages/ui` and the app shell.
6. `SPEC.md`, `CLAUDE.md` updates, `HANDOFF/README.md`, `HANDOFF/architect.md`, and every feature and package stub.

## Acceptance criteria

- On a fresh clone, `pnpm install && pnpm dev` shows the shell, and you can create, rename, nest, reorder, trash and restore pages (in memory).
- `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm test:e2e` all pass.
- Every interface has an in-memory or stub implementation with tests. Service resolution has tests (priority, availability, fallback).
- The schema utilities have tests covering every node and mark.
- Every package and feature folder exists as a stub, so no agent needs to edit a shared file.
- `SPEC.md` is complete, and the ownership table and commands in `CLAUDE.md` match reality.

## Before you finish

Write `HANDOFF/architect.md` with a **Notes for each agent** section: one paragraph per agent covering which interfaces they implement, which extension points they plug into, which stubs they replace, and the pitfalls you foresee. Then post your Completion audit and stop. You'll be called back later with `agents/11-merge.md`.
