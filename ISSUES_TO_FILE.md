# Issues to file

Ready-to-file GitHub issues for Tessera 0.1.0, checked against the code on 2026-09-25. Each `###`
heading is an issue title, and its `Labels:` line lists the labels to set. Delete each entry once
it's filed, and delete this file when it's empty.

Set up the labels first: `bug`, `enhancement`, `question`, `triage`, `roadmap` and
`good first issue`. The area labels are the ones the pull request labeler
(`.github/labeler.yml`) creates: `area: core`, `area: shell`, `area: editor`, `area: sync` (the
server too), `area: databases`, `area: search`, `area: plugins`, `area: desktop`,
`area: self-hosting`, `area: import-export`, `area: ci`, `documentation`, `tests` and
`dependencies`. The topic labels `performance`, `accessibility`, `mobile`, `security`, `windows`,
`release`, `upstream` and `contributing` are extra: create them, or leave them out.

## Bugs

### Firefox typing latency grows with page size (y-tiptap selection mapping)
Labels: `bug`, `performance`, `area: editor`, `upstream`

In Firefox, the editor's processing per keystroke on a 2,000-block page is 12–21 ms p95, against
7–11 ms in Chromium (`e2e/editor/performance.spec.ts` prints both). A profile puts the time in
dependencies: `@tiptap/y-tiptap` 3.0.9 converts the selection to Yjs relative positions three times
per keystroke (undo plugin state, `beforeAllTransactions`, `_prosemirrorChanged`), each walking the
fragment up to the caret, and diffs every top-level child (`updateYFragment`); ProseMirror's view
update walks every top-level child too. Tessera's own editor plugins take under 0.3 ms.

**Expected:** under 16 ms p95 in every browser. **Now:** the spec enforces 16 ms in Chromium and
24 ms in Firefox (SPEC.md §10).

**Next:** report upstream with the profile; cache relative positions per transaction.

### Undo or redo can desync ProseMirror and Yjs (`@tiptap/y-tiptap` 3.0.9)
Labels: `bug`, `area: editor`, `upstream`

After an undo or redo step, y-tiptap keeps that step's saved selection, with absolute positions
from an older document, for the next Yjs transaction. Using them can throw a `RangeError`, which
drops the update and leaves ProseMirror out of sync with Yjs (a redo that never shows up). Tessera
works around it in `packages/editor/src/extensions/history-guard.ts`, covered by
`packages/editor/src/yjs-binding.test.ts` › "redoes a step that removed a block (y-tiptap stale
selection regression)".

**Next:** report upstream with that test as the repro; remove the workaround once it's fixed.

### Report the y-tiptap caret recovery bug upstream, then remove RemoteEditCaret
Labels: `area: editor`, `upstream`

In `@tiptap/y-tiptap` 3.0.9, `restoreRelativeSelection` calls `recoverSelectionEndpoint` after every
remote change, and `isMisresolvedAfterStructuralChange` returns true whenever the text of the
caret's block changed, which puts the caret back at its old offset in the block. With two people
typing in the same paragraph, their words got scrambled. Tessera works around it in
`packages/editor/src/extensions/remote-edit-caret.ts`: for remote changes that keep the block
structure, it drops the absolute positions so the Yjs position wins. Covered by
`packages/editor/src/yjs-binding.test.ts` › "two people typing at the same spot keep their words
whole" and "a caret follows text someone else types before it in the same block".

**Next:** file upstream with that repro; remove the extension once it's fixed.

### Two people typing the same character at the same spot at the same instant can swap those characters
Labels: `bug`, `area: editor`, `upstream`

y-prosemirror, and `@tiptap/y-tiptap` which Tessera uses, syncs ProseMirror to Yjs by diffing text.
When two people type an identical character (a space, say) at the same position before either sees
the other's, the diff can't tell the two apart and keeps the other person's, so that one character
can end up after the other person's run. Nothing is lost and both sides converge. Found by
`e2e/polish/robustness.spec.ts` and `packages/editor/src/yjs-binding.test.ts`; both start the two
runs with different characters for that reason.

**Next:** report upstream (y-prosemirror / `@tiptap/y-tiptap`) with a two-editor repro.

### Vitest's server worker sometimes aborts (0xC0000409) in a full Windows run
Labels: `bug`, `tests`, `windows`

In a full `pnpm test` on Windows 11 (Node 24), the forked worker running
`apps/server/src/sync/sync.test.ts` or `crash.test.ts` sometimes exits with code 3221226505
(0xC0000409, how Windows reports Node's `abort()`), and Vitest reports "Worker exited
unexpectedly". The server project passes alone (`pnpm --filter @tessera/server test`), memory was
not exhausted, and the project already runs last (`sequence.groupOrder: 2` in
`apps/server/vitest.config.ts`). Linux CI has not shown it.

**Next:** add Node's `--report-on-fatalerror` to the fork's `execArgv` to get the fatal report; the
native addons (`better-sqlite3`, `argon2`) are the suspects.

### A loop in a plugin's panel or block freezes the app in Firefox and headless Chromium
Labels: `bug`, `area: plugins`

Plugin logic runs in a worker, and a worker stuck in a loop is detected and stopped in every
browser (`e2e/plugins/sandbox.spec.ts`). Panels and blocks need the DOM, so they run in sandboxed
frames, and Firefox and headless Chromium run those frames on the app's main thread: a panel or
block stuck in `while (true) {}` freezes the tab. Desktop Chromium runs them in their own process,
and the host closes a frame that stops answering. Documented in `docs/plugins/permissions.md` ›
Limits and in the 0.1.0 release notes. The desktop app's WebKit webviews (macOS, Linux) have not
been checked.

**Next:** a watchdog in the app can't help while the loop holds the thread, so find a way to keep
plugin frames off it in Firefox, or render panels and blocks from the worker.

### Relation cleanup can leave dangling IDs if the tab closes right after a permanent delete
Labels: `bug`, `area: databases`

After a permanent deletion, the deleting client removes the deleted pages from every relation:
`apps/web/src/features/databases/index.ts` listens for local `page.deleted` events, and
`removeDeletedFromRelations` (`packages/db-views/src/model/relations.ts`) then opens every database
in the workspace one by one. If the tab closes before that finishes, the dangling IDs stay in the
data and no other client cleans them up. Cells and "Linked from" ignore pages that don't exist, so
nothing shows.

**Next:** make the cleanup resumable (keep the pending IDs until every database is clean, and
finish on the next start), or drop IDs of missing pages whenever a relation value is written.

### Escape during a popover's exit animation needs a second press
Labels: `bug`, `area: databases`, `accessibility`

Pressing Escape while a popover plays its exit animation (about 150 ms) reaches the closing
popover, because Radix keeps it mounted while it animates, so a second press is needed to close the
next one. Seen with the nested popovers of database views; the cause is in every Radix popover
that animates out.

**Next:** let Escape skip a popover whose `data-state` is already `closed`.

### Search: linked titles in page text catch up only on the next edit
Labels: `bug`, `area: search`

Renaming a page updates its title live in panels and results, but pages that link to it keep the
old title in their searchable text until they are next edited: link labels are resolved when a
page is indexed (`packages/search/src/engine/extract.ts`). So the new name doesn't find the linking
pages' text, and the old one still does. Relation cells in database rows are indexed the same way.

**Next:** when a title changes, re-index the pages that link to it (the link index knows them).

### Orphaned local docs after a permanent delete on another device
Labels: `bug`, `area: sync`

A page deleted permanently on another device leaves its docs in this device's storage. The
background replicator (`packages/sync/src/provider/replicator.ts`) drops a local copy only when it
tries to upload a changed doc and the server says it was deleted; docs with nothing to upload stay
on disk. They are invisible and small, but they never go away.

**Next:** when a replication pass finds stored docs whose pages are gone from the workspace, delete
them.

### Windows: long fixture paths need `core.longpaths` to clone into deep folders
Labels: `bug`, `windows`, `contributing`

`packages/importers/fixtures/notion-export` keeps Notion's real folder names (a title plus a
32-character ID per level); its longest path is 184 characters inside the repository. Cloned into
a folder deeper than about 75 characters on Windows, some paths pass 260 characters and
`git clone` fails with "Filename too long" unless `git config --global core.longpaths true`.
CONTRIBUTING.md doesn't mention it.

**Next:** shorten the fixture's folder names (the test already builds its deepest chain inside a
zip), or note the setting in CONTRIBUTING.md.

## Performance

### Measure first-open indexing of a large workspace in the real app
Labels: `performance`, `area: search`

Opening a workspace makes the search and link indexes read every page in the background, once per
workspace (`packages/search/src/services/index-host.ts`). With 5,000 pages in the seeded benchmark
harness, this kept the main thread busy for about 20 s, partly because the harness generates pages
on demand. That is also what slowed the graph benchmark: with indexing finished, the graph's p95
frame time is 16.8 ms headless and 22.2 ms with the GPU (budget 33.4 ms), and `scripts/bench` now
waits for it. Nobody has measured first-open indexing on a real IndexedDB workspace.

**Next:** seed a real workspace (import 5,000 notes), reload, and record long tasks during the
first minute.

### The Mermaid plugin loads 5.2 MB per block frame
Labels: `performance`, `area: plugins`

Each Mermaid block runs in its own sandboxed frame, and each frame loads the plugin's whole bundle
(`examples/plugins/mermaid/dist/main.js`, 5.2 MB, from a blob, so no network). A page with dozens
of diagrams uses a lot of memory and parses the bundle dozens of times.

**Next:** share one renderer frame per page, or render the SVG in the plugin's worker.

### Cross-tab sync waits for the durable IndexedDB commit
Labels: `performance`, `area: sync`

A tab broadcasts an update to the other tabs only after its `durability: 'strict'` IndexedDB
commit (`packages/sync/src/stores/doc-store.ts`). That is usually well under a second, but it once
took over 2 s in Firefox on a saturated machine, so another open tab showed the edit late.

**Next:** measure the commit latency across browsers; if it matters, broadcast before the commit
(other tabs apply broadcast updates without storing them, and a failed write is kept and retried).

### Desktop: the markdown copy re-exports the whole workspace after edits
Labels: `performance`, `area: desktop`

With "Keep a markdown copy" on, `apps/desktop/src/mirror/mirror.ts` re-exports the whole workspace
4 s after edits settle (at most 30 s apart while edits continue), writing only the files that
changed. The export itself still reads every page, which gets expensive for very large workspaces.

**Next:** export only the pages whose docs changed since the last run, plus renames and deletions.

## Enhancements and deferred work

### Imports could link to pages already in the workspace
Labels: `enhancement`, `area: import-export`

Importing a note that links to `[[Apollo 11]]` into a workspace that already has "Apollo 11"
reports "Links to pages that were not in the import" and leaves the link as literal
`[[Apollo 11]]` text. Links are resolved only within the import: the planner
(`packages/importers/src/plan/planner.ts`, `resolver.ts`) runs in a worker and knows only the
imported files.

**Next:** after resolving within the import, resolve the remaining links by exact title (and
aliases) against existing pages that aren't in the trash, and say so in the import report.

### Graph labels overlap in dense areas
Labels: `enhancement`, `area: search`

At the demo workspace's default zoom, some labels in the graph view overlap, for example "Hohmann
transfer orbit" and "Apollo 11". Sigma's label grid (`labelGridCellSize: 180` and
`labelDensity: 0.4` in `packages/search/src/graph/graph-canvas.tsx`) limits how many labels each
cell shows, but it doesn't check collisions.

**Next:** tune the label grid settings, or skip labels whose boxes collide with ones already drawn.

### Plugin API: database queries with date ranges and relative dates
Labels: `enhancement`, `area: plugins`, `area: databases`

`api.databases.query` uses the SDK's own engine (`packages/plugin-api/src/query.ts`), so plugins
tested in the SDK harness get the same results as in the app. Its date filters lack the views'
date ranges and relative dates ("this week", "past 7 days").

**Next:** add them to the SDK engine, matching `packages/db-views/src/query/dates.ts`.

### Plugin storage is per device and shared across workspaces
Labels: `enhancement`, `area: plugins`

A plugin's storage (`api.storage`) is keyed by the plugin only (`packages/plugins/src/host/api.ts`),
and the plugin API has no workspace ID, so a plugin that stores page IDs sees IDs from other
workspaces.

**Next:** add a workspace ID to the plugin API (compatible through `apiVersion`) and scope storage
by workspace.

### Version history for database structure
Labels: `enhancement`, `area: sync`, `area: databases`

Version history covers pages, not database docs: no core helper replaces a database doc's
structure as a new edit, so there is nothing to restore a version with. For a database, the
history panel says "Version history is available for pages."

**Next:** a core helper that writes a database snapshot back as a new edit, then database versions
in `packages/sync/src/history/`.

### Server: change and reset passwords, and manage accounts
Labels: `enhancement`, `area: sync`

There is no way to change or reset a password: `PATCH /api/auth/me` only renames
(`apps/server/src/http/routes/auth.ts`), and `tessera-server create-owner` refuses once any account
exists (`apps/server/src/cli/create-owner.ts`). There is no admin view to list or remove accounts
either. Someone who forgets their password can't get back in.

**Next:** a password change in Settings → Sync & account, a `tessera-server reset-password` command
for the operator, then an owner-only list of accounts.

### Server: remove asset files nothing uses
Labels: `enhancement`, `area: sync`

Attachment files are never garbage-collected on the server:
`apps/server/src/assets/asset-service.ts` removes files only when a whole workspace is deleted.
Images removed from pages, and pages deleted for good, leave their files in `DATA_DIR`.

**Next:** a maintenance pass (next to the doc compaction in `apps/server/src/server.ts`) that
removes files no stored doc references, after a grace period.

### Search: phrase queries
Labels: `enhancement`, `area: search`

Quotes group words for `in:"…"`, but in free text `"launch plan"` searches for the two words
anywhere (`parseQuery` in `packages/search/src/engine/query.ts`).

**Next:** treat quoted free text as a phrase: search as today, then keep the hits whose text
contains the exact phrase.

### Formulas: lists, regular expressions and date formats
Labels: `enhancement`, `area: databases`

Formulas (`packages/db-views/src/query/formula/functions.ts`) have no lists or list functions
(`map`, `filter`), no regular expressions (left out on purpose, for safety), and `formatDate` has
no format codes: it uses the viewer's locale.

**Next:** lists and list functions first, then format codes for `formatDate`; regular expressions
only with a matcher that can't backtrack.

### Importers for Logseq, Bear, Evernote and HTML
Labels: `enhancement`, `area: import-export`

Tessera imports Notion, Obsidian, markdown files and its own backups
(`packages/importers/src/importers.ts`). The stretch importers from the plan, Logseq, Bear,
Evernote (`.enex`) and HTML files, are not built. Pasted HTML is already converted
(`packages/markdown/src/html/`), which an HTML importer can reuse.

**Next:** split this into one issue per importer when someone picks one up.

### Exports: what markdown and CSV can't hold
Labels: `enhancement`, `area: import-export`

Exports drop database views and formulas, comments and version history, and formula columns are
left out of CSV. Databases print (and export to PDF) as plain tables, every column with rows in
stored order, not as their views. Pasted HTML tables with merged cells lose the merge. Backups are
built as one in-memory JSON string (2 GB limit), which a very large workspace could outgrow.

**Next:** a streaming backup format first, since it's the one that fails outright; split the rest
into issues as they're picked up.

### Drag blocks by touch
Labels: `enhancement`, `area: editor`, `mobile`

Blocks can't be dragged by touch. On touch screens the block handle
(`packages/editor/src/handle/BlockHandle.tsx`) is a larger tap target that opens the block menu,
which has Move up and Move down.

**Next:** a long-press drag on the handle, with auto-scroll near the edges.

### Link previews for bookmark cards
Labels: `enhancement`, `area: editor`, `area: sync`

Bookmark cards show a title, description and host from the embed's data, or just the URL. The app
is offline-first and never contacts the linked site, so there is no preview.

**Next:** an optional preview endpoint on the server (fetches the page's title, description and
image, with size and time limits), used only when the workspace is connected.

### Desktop: a transactional dirty flag in the SQLite doc store
Labels: `enhancement`, `area: desktop`, `area: sync`

In the browser, the IndexedDB doc store marks a doc dirty ("needs upload") in the same transaction
as its update. The desktop's SQLite store (`apps/desktop/src/stores/doc-store.ts`) relies on the
replicator's change handler instead, so a crash between the write and the handler loses the mark,
and the replicator doesn't know to upload that edit.

**Next:** mark docs dirty inside the store's SQLite transaction, as the IndexedDB store does.

### Desktop: export downloads and printing in the webview
Labels: `area: desktop`, `area: import-export`

The export dialog saves files through an `<a download>` link
(`packages/importers/src/ui/download.ts`), and the PDF export uses `window.print()`. Both depend on
the webview (WebView2 on Windows, WebKit on macOS and Linux), and neither has been checked in the
real desktop app.

**Next:** check both on each OS; where a webview ignores downloads, save through the native dialog
(`tauri-plugin-dialog` is already a dependency).

### Desktop: check global shortcuts on Wayland and the keychain on Linux
Labels: `area: desktop`

On Linux under Wayland, global shortcuts (quick capture) depend on the compositor; X11 works, and
Settings → Desktop shows the error when registering fails. The keychain
(`apps/desktop/src/stores/credential-store.ts`, `apps/desktop/src-tauri/src/secrets.rs`) was tried
by hand on Windows only; Linux CI runners have no Secret Service, so tests cover validation only.

**Next:** try both in a GNOME and a KDE Wayland session with a Secret Service (GNOME Keyring,
KWallet), and note the results in `docs/guide/desktop.md`.

### Self-hosting templates not verified on their platforms
Labels: `area: self-hosting`

The Fly.io, Railway and Render configs (`deploy/fly`, `deploy/railway`, `deploy/render`) and the
Unraid, CasaOS and Umbrel templates (`deploy/appstores`) follow each platform's documented format
but were never deployed (no accounts). The root-owned-volume path the app-store templates rely on
was tested locally.

**Next:** deploy each once, fix what differs, and note the date each was checked in
`deploy/README.md`.

### CI: nightly performance and load jobs
Labels: `area: ci`, `performance`

`bench.yml` runs `scripts/bench` on pushes to `main` and on pull requests, but these heavier checks
run nowhere in CI: the server load test (`pnpm --filter @tessera/server load-test`, which exits
non-zero on lost deliveries or divergence), the 2,000-note import benchmark
(`TESSERA_IMPORT_BENCH_NOTES`, `packages/importers/src/performance.test.ts`), the search benchmark
(`pnpm --filter @tessera/search bench`), the browser checks in `e2e/search/perf.config.ts`
(`PERF_SOFTWARE_GL=1` on Linux) and the memory soak (`scripts/memory/soak.ts --strict`).

**Next:** a scheduled workflow (nightly, and on demand) that runs them and keeps their reports as
artifacts.

### Docs: VitePress 1.x brings dev-server advisories
Labels: `documentation`, `security`, `dependencies`

`pnpm --dir docs audit` reports Vite 5 advisories (a `server.fs.deny` bypass on Windows, path
traversal in optimized deps, esbuild's dev server) through VitePress 1.6.4 (`docs/package.json`).
They affect `vitepress dev` only, not the built site.

**Next:** move to VitePress 2 (Vite 6 or later) once it's stable.

### Drop Firefox's COOP preference when upgrading to Playwright 1.64
Labels: `tests`, `dependencies`

The Tessera server sends `Cross-Origin-Opener-Policy: same-origin`, which makes Firefox swap
browsing contexts, and Playwright 1.63's Firefox driver can lose a message then
(microsoft/playwright#42731): journeys 8 and 9 hung at `page.goto(invite)`. `playwright.config.ts`
sets `browser.tabs.remote.useCrossOriginOpenerPolicy: false` for the Firefox project; the app and
the server keep COOP. The fix is in Playwright 1.64.

**Done when:** Playwright is 1.64 or later, the preference is gone, and journeys 8 and 9 pass in
Firefox.

### Translations: ship a second language
Labels: `enhancement`, `area: shell`

Only English exists, so Settings → General shows the language as text ("Tessera speaks English for
now. Translations are welcome."). The loading is in place: `apps/web/src/i18n/index.ts` picks up
`src/i18n/<locale>.json` files next to each package's `en.ts`, with the same keys (see
`packages/ui/src/i18n/i18n.ts`), and the language select appears once there are two locales.

**Next:** a first complete locale, and a short "Translating Tessera" section in
`docs/contributing/`.

### Screen readers: check with real ones
Labels: `accessibility`

ARIA roles, names and keyboard paths are checked with Playwright role queries and axe
(`e2e/ci/accessibility.spec.ts`), not with a real screen reader. The editor is a labelled multiline
textbox whose menus use `aria-activedescendant`; nobody has heard it read.

**Next:** walk through first steps, the editor, a database view and the palette with NVDA,
VoiceOver and Orca, and file what's wrong.

## Good first issues

### Emoji picker: Enter before the emoji data loads does nothing
Labels: `good first issue`, `area: shell`

The emoji picker (`packages/ui/src/components/emoji-picker.tsx`) loads its data on first use, which
takes a few hundred milliseconds. Until then there are no results, so typing "rocket" and pressing
Enter at once does nothing; clicking a result later works. Remember an Enter pressed while the data
is loading, and pick the first result once it arrives.

**Done when:** typing "rocket" and pressing Enter right away on first use picks the rocket, and a
test in `packages/ui/src/components/components.test.tsx` covers it.

### Slash command: insert today's date
Labels: `good first issue`, `area: editor`

The slash menu (`packages/editor/src/menus/slash-items.ts`) has no date item. Add one ("Date",
keywords `date`, `today`, `now`) that inserts today's date as text, formatted with
`Intl.DateTimeFormat` in the person's locale (for example `dateStyle: 'medium'`). Its title and
description go through `t()` (`packages/editor/src/i18n/en.ts`).

**Done when:** a unit test (next to `packages/editor/src/menus/menus.test.ts`) checks the inserted
text, an e2e step in `e2e/editor/` types `/date` and Enter, and `docs/guide/editor.md` lists it.

### Settings: a "Copy diagnostics" button under About
Labels: `good first issue`, `area: shell`

Bug reports ask for `window.__tessera.diagnostics()` (`.github/ISSUE_TEMPLATE/bug_report.yml`,
`docs/guide/troubleshooting.md`), which means opening the developer console. Settings → General →
About already shows the version and the services (`apps/web/src/app/settings/SettingsView.tsx`).
Add a "Copy diagnostics" button there that copies the same JSON (`describeSession` in
`apps/web/src/app/diagnostics.ts`) and confirms with a toast.

**Done when:** a test covers it, its strings go through `t()`, and
`docs/guide/troubleshooting.md` mentions the button.

### Command palette: a hint row for filters
Labels: `good first issue`, `area: search`

With an empty query, the palette (`packages/search/src/palette/command-palette.tsx`) shows recent
pages, and its footer says "Type > for commands, # for tags". The filters `tag:`, `in:`, `type:`
and `is:task` are explained only on the search page (`SyntaxHelp` in
`packages/search/src/search-page/search-page.tsx`). Show one quiet row listing them when the query
is empty.

**Done when:** arrow keys skip the row (it isn't an option), its strings go through `t()`, and a
test in `packages/search/src/palette/command-palette.test.tsx` covers it.

### Graph: press `0` to fit the graph to the screen
Labels: `good first issue`, `area: search`

The graph view has a "Fit to screen" button (`packages/search/src/graph/graph-view.tsx`, which
calls `reset()` on the canvas in `graph-canvas.tsx`) but no key for it. Register a command with the
single-key shortcut `0` that applies only on the `/graph` route (its `when`), in
`apps/web/src/features/graph/index.ts`; it needs a way to reach the open view, for example a small
store the view registers with. Commands with shortcuts appear in the `?` overlay by themselves.

**Done when:** a step in `e2e/search/graph.spec.ts` zooms in, presses `0`, and the whole graph is
back in view.

### Import report: "Copy report as markdown"
Labels: `good first issue`, `area: import-export`

The import report (`ImportReportView` in `packages/importers/src/ui/ImportDialog.tsx`) lists
counts, warnings and errors, but there's no way to copy them into an issue or a note. Add a button
that copies them as a markdown list and confirms with a toast.

**Done when:** a unit test covers the markdown formatting, and the strings go through `t()`.

### Server: warn at startup when `PUBLIC_URL` is unset
Labels: `good first issue`, `area: sync`

Without `PUBLIC_URL` the server can't build invite links (`inviteUrl` in
`apps/server/src/http/routes/workspaces.ts` returns null), and it also uses the setting for secure
cookies and HSTS (`docs/self-hosting/configuration.md`), yet it starts without a word about it. At
boot (`apps/server/src/server.ts`, after the "listening" log), log one `warn` line explaining this
when `PUBLIC_URL` is unset and `HOST` isn't a loopback address (the default `0.0.0.0` included).

**Done when:** a test covers both cases, and `docs/self-hosting/configuration.md` › `PUBLIC_URL`
mentions the warning.

### Trash: sort by deletion date or title
Labels: `good first issue`, `area: shell`

The Trash view (`apps/web/src/app/pages/TrashView.tsx`) lists pages newest first, with a filter
box. Add a sort control: newest first, oldest first, and title.

**Done when:** it uses `Select` from `packages/ui`, is keyboard accessible, looks right in both
themes, its strings go through `t()`, and an e2e test covers it.

### Demo workspace: a weekly review template
Labels: `good first issue`, `documentation`

Add `examples/demo-workspace/Weekly review template.md` with a few prompts and a to-do list, and
link it from `Welcome to Tessera.md`. `Meeting notes/Meeting template.md` is a model to follow.

**Done when:** `pnpm --dir docs test` passes (it checks the demo's pages and links), and so does
`pnpm --filter @tessera/importers test` (`demo.test.ts` imports the demo, checks that every link
resolves and that `Welcome to Tessera` stays first).

### Docs: a "Coming from Obsidian" guide
Labels: `good first issue`, `documentation`

`docs/guide/import-export.md` explains how to import a vault, and the FAQ answers "Can I use my
Obsidian vault directly?", but nothing maps Obsidian's concepts to Tessera's. Add
`docs/guide/coming-from-obsidian.md` covering vaults and folders, frontmatter, wikilinks and
embeds, callouts, tags and plugins; add it to the sidebar in `docs/.vitepress/config.mts` and link
it from `docs/guide/faq.md`.

**Done when:** `pnpm --dir docs build` passes with no dead links.

### Docs: install from Unraid, CasaOS and Umbrel
Labels: `good first issue`, `documentation`, `area: self-hosting`

The app-store templates exist in `deploy/appstores/` (Unraid `tessera.xml`, CasaOS
`docker-compose.yml`, Umbrel `tessera/`, with notes in `deploy/appstores/README.md`), but the docs
site doesn't mention them: `docs/self-hosting/index.md` only links the `deploy/` folder. Add a page
under `docs/self-hosting/` with the install steps for each: the template URL or custom install,
the port, the data folder, and creating the owner account.

**Done when:** `pnpm --dir docs build` passes, and someone has followed the steps on one platform
(noted in the pull request).

### Page tree: "Collapse all" in the sidebar
Labels: `good first issue`, `area: shell`

The sidebar's Pages section has only a "New page" button (`apps/web/src/app/sidebar/Sidebar.tsx`).
Add a "Collapse all" action that collapses every expanded page. The expanded pages are kept by
`useExpanded` in `apps/web/src/app/sidebar/PageTree.tsx` (saved per workspace in the device setting
`shell.expanded.<workspaceId>`).

**Done when:** an e2e test expands three levels, collapses all, and the tree shows only top-level
pages; the strings go through `t()`.

## Checks that only run on GitHub

### CodeQL fails on every push: code scanning is not enabled
Labels: `area: ci`, `security`

All three CodeQL jobs in `.github/workflows/codeql.yml` (javascript-typescript, actions, rust) have
failed at "Analyze" on every push to `main` so far (the latest at `136c1a7`) with "Code scanning is
not enabled for this repository". The analysis runs; uploading its results is refused. The
repository is private, and code scanning on a private repository needs GitHub Code Security.

**Done when:** the repository is public (or code scanning is enabled), a re-run passes, and
results appear under Security → Code scanning.

### Docs deploy fails: GitHub Pages is not enabled
Labels: `area: ci`, `documentation`

The first `docs.yml` run (`b82827a`) failed at "Pages settings": `actions/configure-pages` got
"Not Found" because Pages isn't enabled for the repository. Nothing is published yet, and the
README and the 0.1.0 release notes link to `https://femboypuppy.github.io/Tessera/`. Pages for a
private repository needs a paid plan, so this may wait until the repository is public.

**Done when:** Settings → Pages → Source is "GitHub Actions", a manual `docs.yml` run deploys, and
the site loads at `/Tessera/`.

### Desktop builds: the first run of `desktop.yml`
Labels: `area: ci`, `area: desktop`, `release`

`desktop.yml` runs on pull requests that touch the desktop app, on demand, and from the release
workflow; it hasn't run yet. Windows (installers and the real-app smoke test) and Linux (`.deb`,
`.rpm`, AppImage, in Docker) were built locally. macOS was never built anywhere (no Mac).

**Done when:** a manual run builds all four targets, both macOS architectures included, and the
file names match the ones in `.github/releases/v0.1.0.md`.

### Docker image: the first run of `docker.yml` (arm64 never built)
Labels: `area: ci`, `area: self-hosting`

`docker.yml` runs on pull requests that touch the image, on demand, and from the release workflow;
it hasn't run yet. The amd64 image passed the container smoke test locally
(`deploy/smoke/smoke-test.mjs`), but the arm64 image, which the workflow builds only when it
pushes, was never built. The workflow doesn't run the smoke test itself.

**Done when:** the first release pushes both architectures to `ghcr.io/femboypuppy/tessera`,
`docker pull ghcr.io/femboypuppy/tessera:0.1.0` works signed out, and the image starts on an arm64
machine. Running the smoke test on amd64 in the workflow would be a good addition.

### Release workflow: the first tagged release
Labels: `area: ci`, `release`

`release.yml` runs on `v*` tags and hasn't run yet. It checks the tag against the app version,
drafts the release with the highlights from `.github/releases/<tag>.md` and a generated changelog,
calls `desktop.yml` and `docker.yml`, adds `SHA256SUMS.txt`, and publishes. If a step fails, the
draft stays. The updater's install path can only be tried with a signed release; see "Desktop
releases ship without the updater's public key".

**Done when:** tagging `v0.1.0` publishes a release with every file the release notes list, and
(with the updater keys set) an app from it finds and installs a later test release.

### Labeler and Dependabot: the first runs
Labels: `area: ci`, `dependencies`

The labeler (`.github/workflows/labeler.yml`, on `pull_request_target`) hasn't run, since there
have been no pull requests. Dependabot's first update jobs (npm, the docs site's npm, cargo, Docker
and GitHub Actions, `.github/dependabot.yml`) started on 2026-09-25 and were still queued when this
was written.

**Done when:** a pull request gets its `area: …` labels (the labels exist first), and Dependabot's
first pull requests open and pass CI.
