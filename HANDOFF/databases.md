# Databases handoff

## Plan

Milestones from `agents/04-databases.md`, each ending tested and committed on `feat/databases`:

1. **M1: query engine** (`packages/db-views/src/query`, pure TypeScript, no React, no Yjs):
   fast cell reading equivalent to core's `getCellValue`, a compiled filter tree (every operator of
   every property type, nested AND/OR, dates by calendar day in the viewer's time zone, relative
   dates), stable multi-level sorting with `Intl.Collator`, grouping (options, checkbox, date
   buckets, empty group, explicit order, hidden and collapsed), every summary kind, full-text search
   inside a database, value formatting, type conversion and CSV parsing and inference. At least 95%
   coverage, and a performance test (10,000 rows filtered in under 50 ms).
2. **M2: databases and the table view.** A framework-free `DatabaseStore` (incremental snapshot of a
   database doc joined with page metadata, read through `useSyncExternalStore`, never mirrored into
   React state); `pageBodies.database`; the `database` embed renderer with "Database – inline" and
   "Linked view of database" slash items; row properties in `pageTopSections`; every property type
   with its cell renderer and editor; a virtualized ARIA grid with spreadsheet keyboard navigation,
   range selection, copy and paste; the column header menu (rename, type change with conversion,
   hide, sort, filter, resize, drag reorder, delete); row actions (open, side peek, duplicate,
   delete); summary footer; two-way relations kept consistent on trash and permanent deletion.
3. **M3: more views.** View tabs (create, rename, duplicate, reorder, delete, change layout); board
   (drag cards within and across groups, add, collapse and hide groups); calendar (month and week,
   drag to reschedule, drag an edge to resize, click a day to create, "No date" tray); gallery
   (small, medium, large cards with covers); list; the keyboard-first filter and sort builder with
   chips.
4. **M4: power features.** CSV import with type inference and export of the current view; row
   templates; search inside a database; grouping in the table; frozen first column; undo toasts
   for deleting rows, properties and views. Stretch, only after everything else passes: formulas.

After each milestone: `pnpm typecheck && pnpm lint && pnpm test`, the e2e specs in `e2e/databases`,
screenshots, a critical look, a commit.

## Built (what exists and where)

(In progress.)

## How it plugs in (FeatureModule entries, services, extension points used)

(In progress.)

## Decisions (and why)

(In progress.)

## Contract change requests (exact proposed diff to packages/core, and why)

(In progress.)

## Known gaps and bugs

(In progress.)

## Follow-ups for the merge (cross-agent wiring you couldn't finish alone)

(In progress.)

## Screenshots (list of files)

(In progress.)
