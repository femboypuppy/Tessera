# Integration handoff

Agent 11 (the Architect again), on `main`. This file is the merge plan, the verdict on every
contract change request, every cross-agent follow-up and what became of it, and at the end
everything deferred and every known bug, each written as a ready-to-file GitHub issue.

## Plan

### History: replaying the branches onto the rewritten `main`

`main` was rewritten (author emails) after the feature branches were cut, so the `feat/*` branches
share no commit with it, although their starting trees are identical. Nothing is merged with
`--allow-unrelated-histories`. Instead each branch's own commits are replayed onto `main` in a new
local branch `rebased/<area>` with `git cherry-pick`, and `main` merges that branch with
`git merge --no-ff`. The `feat/*` branches and their worktrees are left untouched (the project's
`.claude/settings.json` denies `git rebase`, and nothing here needs to rewrite them).

| Branch | Old base | Commits replayed | Notes |
|---|---|---|---|
| `feat/ci` | `a30f580` (old "license" commit = `main`'s `ffde8e0`, same tree) | 12 | Skipped `3a846f7`, an `ours` merge of the rewritten `main` with no file changes (it would have brought the old-email history back). |
| `feat/sync`, `editor`, `search`, `databases`, `plugins`, `desktop` | `312265a` (old "SPEC and handoffs" = `ff8a7bf`) | 17, 18, 16, 11, 11, 7 | `main` adds only `ffde8e0` (LICENSE, `HANDOFF/architect.md`), which none of them touch. |
| `feat/importers`, `feat/docs` | `a30f580` | 10, 8 | |

Every replayed tree equals its `feat/*` tree (`git diff feat/<area> rebased/<area>` is empty), and
every replayed commit has the author email `276110381+femboypuppy@users.noreply.github.com` (none
had the old `12345678+…` address; the only such commits are the old base's, which are not replayed).

### Merge order

The suggested order holds; the handoffs give no reason to change it:

1. `feat/ci`: the testkit, journeys and CI scripts, so every later merge runs through them.
2. `feat/sync`: persistence, which reloading journeys and every later e2e depend on.
3. `feat/editor`: page bodies, which search, databases, plugins and importers exercise.
4. `feat/importers`: the real markdown codec (editor paste and copy, plugin READMEs).
5. `feat/search`, 6. `feat/databases`, 7. `feat/plugins`, 8. `feat/desktop`, 9. `feat/docs`.

After each merge: `pnpm install`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:e2e`,
the app itself and the branch's screenshots, root causes fixed before the next merge.

## Contract change requests

Applied first, in one commit (`feat(core): apply the approved contract change requests`), with
`SPEC.md` updated (sections 4.3, 4.5, 6.2 to 6.5, 7, 8 and 13.3).

| # | From | Request | Verdict |
|---|---|---|---|
| 1 | sync | `SyncStatusInfo.readOnly`, and read-only pages for viewers in the shell | **Approved.** The shell's `useViewOnly()` makes the page, title, page menu, favorites, the page tree (drag, moves, row menus) and "New page" read-only, and hides `shell.newPage`; the server already refuses a viewer's updates. |
| 2 | sync | Optional `AssetStore.retainUrl` | **Approved** as proposed (optional, so no store breaks). |
| 3 | sync | `DocStore.storeUpdate(…, { remote })` so remote-only docs skip a background handshake | **Rejected.** `transaction.local` is false for more than server updates: importers and backup restore write with `Y.applyUpdate`, which is not local either, so their docs would never be marked dirty and would not reach the server when imported offline. The workaround is one extra, cheap state-vector handshake. |
| 4 | importers | `createPages(ws, inputs)`: many pages with one page index | **Approved, merged with databases' #6** into one helper: each input has its own `parentId` (an existing page or an earlier input, so no cycle can form), pages go after their parent's existing children, and every input is validated before the first write (the proposal validated inside the loop, which could leave half a batch behind). |
| 5 | importers | Quieter replacement of core's stub importer and exporter | **Approved** as `register(item, { replaceable: true })`: core registers `markdown-basic` that way, replacing it logs nothing, and unregistering the replacement brings the stub back. |
| 6 | databases | `createPages`, `addRows`, `checkRowValues`, `WorkspaceApi.addDatabaseRows` | **Approved** (with #4's `createPages`). `addRows` also refuses duplicate IDs within one call and an unknown `after` row, and falls back to appending when neighbours are tied. |
| 7 | search | `SearchHit.heading` and `SearchHit.blockId` | **Approved** as proposed (optional fields). |
| 8 | search | `Backlink.blockId` | **Approved** as proposed (required, `string \| null`; core's naive index fills it). |
| 9 | desktop | A `credentialStore` app service (keychain on the desktop) | **Approved** with `MemoryCredentialStore` as the stub and `credentialKey()` (origin normalization). Also exposed to storage services through `context.app.credentialStore`. |
| 10 | desktop | `workspaceMenuItems` contribution in the sidebar's workspace menu | **Approved** as proposed; errors from `run` become a toast. |
| 11 | desktop | `@source '../../desktop/src/**/*.{ts,tsx}'` in `apps/web/src/styles.css` | **Approved.** |

Architect-owned follow-ups done in the same pass, because they are shell changes other agents
asked for: `Suspense` around `pageTopSections` and `pageFooterSections` (search), and
`/p/<id>#block-<blockId>` or `#<heading-slug>` URLs as scroll targets (editor's "Copy link").

## Merge log

How each merge was checked on this machine (Windows 11, i5-10400F 6 cores/12 threads, shared
with a VMware VM and desktop apps that keep the CPU near 100% before any test starts). Unit tests:
`pnpm test`. End to end: Chromium with two workers and Firefox with one (the CI setting is two
workers per browser on dedicated runners; here, two parallel Firefox workers starve each other past
the 45 s test timeout). A failure is re-run alone before it counts as fixed or flaky.

| Merge | Adapted at the merge | Unit | e2e |
|---|---|---|---|
| `feat/ci` | Root `prepare` (git hooks), `.lighthouseci/` ignored, WCAG AA contrast tokens, Avatar text by contrast, focusable ScrollArea, empty accessibility baseline, SECURITY.md contact | 407 passed | 66 passed, 22 skipped (journeys waiting for features) |
| `feat/sync` | Credentials on core's `credentialStore` service (IndexedDB store at 50); the sync e2e server fixture gets its own 120 s budget | 531 passed | Chromium all passed; Firefox passes with one worker |
| `feat/editor` | Journey 08 runs for real: helpers follow the real Sync & account UI, Bob opens the invite link; the testkit server on `localhost` with the app's origin allowed (the Lax cookie is never sent to 127.0.0.1); seeded-harness fixture budget and warm-up; Firefox typing guard (24 ms); EmojiPicker query by label; test timeouts for busy machines | 682 passed | Chromium 60 + Firefox 60 passed after the fixes (9 skipped each, waiting for search, databases, importers) |
| `feat/importers` | `applyPlan` creates pages with `createPages` in batches of 200 and rows with `addRows` (the 2,000-note import's page phase: 11.8 s → 0.17 s); the shell prints bare routes on as many sheets as needed (the print view's override is gone); `serialize(…, { keepBlockId })`: the markdown export writes only block IDs a link points at, the editor's copy none (every editor block has an ID, so exports had ` ^id` on nearly every line); the clipboard spec starts each paste on a top-level line (with the real codec a pasted list kept the caret in it) and checks the plain flavor is markdown; journey 05 checks the report's real totals | 792 passed | Chromium 66 + Firefox 66 passed, 8 skipped each |
| `feat/search` | Search's rich hit and backlink types extend core's new fields instead of repeating them; the background replicator reports docs it pulled while closed (`onPulled`) and the sync feature re-indexes them with `searchIndex.upsert` (otherwise a collaborator's edit to a page this device never opened could stay stale in search and backlinks); journeys 03 and 06 run for real: 03 types its tag the way a person does (a space after it converts `#space`), 06 picks the export format and scope by their exact names (the backup format's description also says "workspace") | 866 passed | Chromium 83 passed + the two fixed journeys re-run; Firefox 85 passed; 1 skipped each (journey 04, waiting for databases) |

## Follow-ups from the handoffs

Status is filled in as the merges land (✅ done, ⏳ in progress, ➡️ deferred with an issue below).

### Architect / shell
- Read-only for viewers (sync CCR 1). ✅
- `Suspense` for lazy page sections (search). ✅
- Block and heading links from the URL hash (editor). ✅
- Test timeouts for the jsdom shell tests (ci, sync, editor, search, desktop). ✅ Measured alone on
  this machine: one `getAllByRole('button', { name })` over the picker's ~1,870 buttons takes
  9.9 s in jsdom (the picker renders in 1 s), and "onboards, then creates…" takes 10.5 s. Nothing
  hangs, so `testTimeout: 15_000` for the `ui`, `web` and `core` projects.
- Root `prepare` script for the git hooks, `.lighthouseci/` in `.gitignore`, contrast token fixes
  and an empty accessibility baseline (ci). ⏳ with the CI merge.
- Final logo and favicon from `assets/brand` (docs). ⏳ with the docs merge.
- A print rule for bare routes (importers), desktop wording for "Delete workspace" (desktop). ⏳
- Service worker for offline cold starts (sync). ⏳

### Cross-feature wiring (agents/11-merge.md)
Collaboration cursors, paste and copy through the real codec, search indexing of database rows,
inline databases, plugin blocks in the slash menu, importers writing to the asset store, the
desktop markdown mirror through the exporter, "Open demo workspace", history previews with the
editor, plugin docs in the docs sidebar. ⏳

### Owner notes for this merge
- The malicious test plugin for the sandbox escape tests, as a fixture inside the test suite. ⏳
- Tests that skipped without the editor (plugin blocks in the slash menu, inline database e2e) must
  run for real. ⏳
- After `feat/docs`: the README screenshot table from `HANDOFF/docs.md`, once every image exists;
  `femboypuppy@tutanota.de` as the contact in `SECURITY.md`. ⏳
- The Firefox typing-latency budget the editor measured but did not enforce. ⏳
