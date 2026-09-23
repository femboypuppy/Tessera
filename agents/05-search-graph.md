# Agent 05 — Search, command palette, backlinks & graph

**Parallel phase, branch `feat/search`. Effort: xhigh.**

You own `packages/search`, `apps/web/src/features/search`, `apps/web/src/features/graph`, `apps/web/src/features/backlinks`, and your HANDOFF, screenshot and e2e folders.

## Why this matters

Finding things instantly is what makes a knowledge base trustworthy, and the graph view is the most screenshotted feature of apps like Obsidian. The graph will probably be in the launch GIF. Make it gorgeous.

## Read first

`CLAUDE.md`, `SPEC.md`, `HANDOFF/architect.md`, and in `packages/core`: `SearchIndex`, `LinkIndex`, the `extract*` schema utilities, `EventBus`, `CommandRegistry`, `AppContext` and service resolution.

## M1 — Indexing

- `MiniSearchIndex` implementing `SearchIndex`:
  - indexes titles (strongly boosted), headings (boosted), body text, tags and database row values
  - fuzzy and prefix matching, and snippets with highlight ranges
  - filters: `tag:`, `in:` (a page subtree), `type:page|database`, `is:task`
  - ranking that also considers recency and how often a page is linked
- Incremental updates driven by `EventBus` (debounced `doc.changed`, renames, moves, trash, restore, delete), using the core `extract*` utilities.
- Indexing runs in a Web Worker so typing never stutters. Persist the index so startup doesn't re-index everything, and rebuild safely when the schema version changes.
- `GraphLinkIndex` implementing `LinkIndex`: outgoing links, backlinks with the text of the block containing each link, unlinked mentions (a page's title appearing as plain text elsewhere; word boundaries, case-insensitive, respecting aliases from page props), orphans, and tag co-occurrence.
- Register both as services (priority 50).

## M2 — Command palette (`Mod+K`)

- One palette for everything: recent pages when the query is empty, then pages, full-text hits with snippets, commands from `CommandRegistry` (showing their shortcuts), tags, and "Create page 'X'".
- Fully keyboard-driven, with grouped results, a preview pane for the highlighted page on wide screens, and < 50 ms p95 per keystroke on 5,000 pages.
- A full search page (`/search?q=`) with filters, result counts and pagination.

## M3 — Backlinks and mentions

- A side panel (`pageSidePanels`) with "Linked references" grouped by source page, with context, and "Unlinked mentions" with a one-click **Link** button that turns the mention into a `pageLink` through core helpers.
- An optional compact backlinks footer at the end of each page (a setting).

## M4 — Graph view

- A global graph at `/graph`, built with sigma.js (WebGL) and graphology, with the ForceAtlas2 layout running in a worker.
  - Nodes are sized by degree and colored by tag or top-level parent.
  - Hovering highlights neighbors and dims everything else; clicking opens the page.
  - A search box focuses and zooms to a node.
  - Filters for tags, orphans, database rows and depth.
  - Smooth zoom and pan, a layout that settles instead of jittering forever, and fluid performance with 10,000 nodes.
- A local-graph side panel: the current page's neighborhood with a depth slider (1–3).
- Colors come from the theme tokens, so the graph looks right in both themes.

## Acceptance criteria

- Unit tests: index updates for add, edit, rename, move, trash, restore and delete; fuzzy matching and snippet correctness; filters; link-extraction edge cases (links inside tables, toggles and lists, self-links, links to trashed pages); unlinked-mention word boundaries and aliases.
- A benchmark on 5,000 generated pages (write a small seeded generator in your package, since `packages/testkit` may not be merged yet): initial index time, persisted startup time, and query p95 < 50 ms. Results in HANDOFF.
- e2e in `e2e/search/`: open the palette, search, navigate and run a command; create a link and see the backlink; convert an unlinked mention; the graph renders and clicking a node navigates.
- Screenshots (light and dark): `palette`, `backlinks`, `graph` (a generated ~300-page workspace with tags; make it beautiful), `local-graph`.

## Pitfalls

- Never block the main thread with indexing or layout. Profile with a 5,000-page workspace.
- Search results must disappear the moment a page is trashed.
- sigma.js needs explicit cleanup on unmount, or you'll leak WebGL contexts.
