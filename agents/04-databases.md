# Agent 04 — Databases & views

**Parallel phase, branch `feat/databases`. Effort: xhigh.**

You own `packages/db-views`, `apps/web/src/features/databases`, and your HANDOFF, screenshot and e2e folders.

## Why this matters

Databases are the reason people stay in Notion. Tessera's must feel just as good: fast with thousands of rows, fully keyboard-driven and pleasant to look at, while staying local-first.

## Read first

`CLAUDE.md`, `SPEC.md`, `HANDOFF/architect.md`, and in `packages/core`: the database Y.Doc structure and helpers, the property and view types, `BlockRendererRegistry`, `CommandRegistry`, `AppContext` and `FeatureModule` (especially `pageBodies` and `pageTopSections`).

## M1 — Query engine (pure, no React)

- `packages/db-views/src/query`: filter-tree evaluation (nested AND/OR, every operator for every property type), multi-level sorting, grouping, and summaries (count, empty, not empty, unique, sum, average, median, min, max, % checked, earliest, latest, date range).
- Correct edge cases: empty values, mixed types, dates with and without times and time zones, relative date filters ("next 7 days", "this month"), locale-aware string sorting with `Intl.Collator`, stable sorts.
- Aim for ≥ 95% coverage on this module. Plugins, search and exports will reuse it.

## M2 — Databases and the table view

- Full-page databases (`kind: 'database'`) render through `pageBodies.database`. Inline databases inside any page render through a `BlockRendererRegistry` entry for the `embed` kind `database`, with a slash-menu entry "Database – inline". Linked views: an inline block showing a view of an existing database.
- Row pages show their properties under the title through `pageTopSections`.
- Properties: title, text, number (plain, %, currency), select and multi-select (colored options, create by typing, rename, recolor, reorder, delete), date (single or range, optional time, relative display), checkbox, URL, email, relation (to rows of another database or any page, with search pickers and back-relations shown on the target), created time, updated time.
- Table view with virtualization (10,000 rows at 60 fps):
  - inline editing with the right editor for each property type
  - spreadsheet-style keyboard navigation (arrows, Enter to edit, Esc, Tab, Shift+Tab, copy and paste of cells and ranges)
  - add a row at the bottom or with `Mod+Enter`
  - a column header menu to rename, change type (with value conversion), hide, sort, filter, resize, reorder by drag, and delete
  - row actions: open as full page, open in side peek, duplicate, delete
  - a summary footer row

## M3 — More views

- Multiple views per database as tabs. Each view keeps its own filters, sorts, grouping and visible properties. Create, rename, duplicate, reorder and delete views.
- **Board:** grouped by a select, multi-select or checkbox property; drag cards within and between columns (which updates the value); add a card in a column; collapse and hide groups; cards show chosen properties.
- **Calendar:** month and week views by a date property; drag to reschedule; drag the edge of a range to resize it; click an empty day to create a row; a "No date" tray for undated rows.
- **Gallery:** cards with a cover (the first image of the row page, or none), the title and chosen properties, in small, medium and large sizes.
- **List:** compact rows with chosen properties.
- A filter and sort builder that's quick to use with the keyboard and shows active filters as chips.

## M4 — Power features

- Create a database from CSV (type inference for number, date, checkbox, select vs multi-select, URL and email), and export the current view to CSV.
- Row templates: a default template page for new rows.
- Search inside a database, grouping in the table view, and a frozen first column.
- Undo for destructive actions through a toast (deleting a row, property or view).
- Stretch, only after everything else passes: a formula property with a small, safe expression language (a real parser and evaluator, no `eval`) with functions for math, text, dates and conditionals.

## Acceptance criteria

- Query engine tests with ≥ 95% coverage, including all the edge cases above.
- Performance tests: the table view scrolls 10,000 rows at 60 fps, and filtering 10,000 rows takes < 50 ms.
- e2e in `e2e/databases/`: create a database; add one property of every type; add 20 rows; filter and sort; switch to the board and drag a card to another group (its value changes); reschedule on the calendar; embed an inline database in a page and edit it there; export CSV and compare it to the view; import CSV and check the inferred types.
- Screenshots (light and dark) with realistic data, such as a project tracker and a reading list: `table`, `board`, `calendar`, `gallery`, `filter-builder`.

## Pitfalls

- Row values live in the database doc; only a row's body lives in its page doc. Never load every row page to render a view.
- Keep the query engine pure and framework-free.
- Relation back-links must stay consistent when either side is deleted or trashed.
