# Search & graph handoff

## Plan

Agent 05 (`feat/search`): search index, command palette, backlinks, unlinked mentions and the
graph view. Everything lives in `packages/search`; the three feature folders
(`apps/web/src/features/{search,graph,backlinks}`) only register.

1. **M1: indexing.** One index worker per workspace session holds both a MiniSearch engine and
   the link graph. A main-thread host feeds it from `EventBus` events (debounced `doc.changed`,
   `database.changed`, `page.*`), sends Yjs state as bytes (parsing, `readDocJSON` and the
   `extract*` utilities run in the worker), keeps trashed pages out of results at once, and
   persists the index to IndexedDB with version stamps (`DOC_SCHEMA_VERSION`,
   `DATA_MODEL_VERSION`, our own format version) and per-page fingerprints (`updatedAt`) so a
   restart only re-reads what changed. `MiniSearchIndex` (SearchIndex) and `GraphLinkIndex`
   (LinkIndex) are thin services over that shared host, registered at priority 50. Tests for
   add, edit, rename, move, trash, restore, delete, fuzzy matching, snippets, filters, link
   extraction edge cases and unlinked mentions. A seeded generator and a 5,000-page benchmark.
2. **M2: command palette** (`Mod+K`, an `overlays` entry that lazy-loads its dialog): recent
   pages, pages, full-text hits with snippets, commands with shortcuts, tags, "Create page 'X'",
   grouped and keyboard-driven, with a preview pane on wide screens. `/search?q=` page with
   filters, counts and pagination. `COMMANDS.search` opens it.
3. **M3: backlinks.** Side panel with linked references (grouped by source, with context) and
   unlinked mentions with a one-click Link button; optional compact footer behind the workspace
   setting `backlinks.showFooter` (toggle in Settings → Backlinks and in the panel).
4. **M4: graph.** `/graph` with sigma.js + graphology, ForceAtlas2 in our own module worker
   (settles, then stops), size by degree, color by tag or top-level parent from CSS tokens,
   hover highlighting, click to open, search-to-focus, filters (tags, orphans, rows, depth).
   Local-graph side panel with a depth slider (1–3).
5. e2e specs in `e2e/search/`, screenshots in `assets/screenshots/search/`, this file.

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
