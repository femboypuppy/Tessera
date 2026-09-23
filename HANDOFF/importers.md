# Importers handoff

## Plan

Agent 08: markdown engine, import and export. Milestones, in order, each ending tested and committed:

1. **M1: markdown engine (`packages/markdown`).** unified + remark-parse + remark-gfm +
   remark-frontmatter, plus my own micromark syntax extensions for `[[wikilinks]]`, `![[embeds]]`,
   `#tags`, `==highlights==` and `^block-ids`. mdast ↔ DocJSON converters, Obsidian callouts
   (foldable variants too), toggles as `<details>`, task lists, tables, lossless fallbacks for
   embeds, `parseHTML` (DOMPurify + a DOM walker with Notion, Google Docs and Word heuristics).
   Registered as the `markdownCodec` service (priority 50), loaded in the async `create`.
   Property-based round-trip tests with fast-check.
2. **M2: importers (`packages/importers`).** A worker-safe *planner* turns files into an import plan
   (page tree, DocJSON with resolved links, databases from CSV with inferred types, attachment
   references), run in a Web Worker; the main thread stores assets and applies the plan in
   time-sliced batches (progress, cancel). Importers: Notion (zip, nested and multi-part zips),
   Obsidian (vault folder or zip), markdown folders (relative links, wikilinks, CSV databases).
   Zip-slip protection, realistic fixtures in `packages/importers/fixtures/`, an import report.
3. **M3: exporters.** Obsidian-compatible markdown zip (attachments, frontmatter, databases as CSV
   plus row pages), JSON backup and restore into a new workspace, single page to standalone HTML,
   PDF through a print view (`/print/:pageId`, a bare route). Registered in `ctx.exporters`.
4. **M4: UI.** Import dialog (drop zone, file and folder pickers, auto-detection with override,
   preview, progress, report), export dialog (format and scope), sidebar entry points, a page
   export button, a settings panel (backup and restore), onboarding actions (Notion, Obsidian,
   markdown, demo workspace), e2e specs and screenshots.

## Built (what exists and where)

(in progress)

## How it plugs in (FeatureModule entries, services, extension points used)

(in progress)

## Decisions (and why)

(in progress)

## Contract change requests (exact proposed diff to packages/core, and why)

None yet.

## Known gaps and bugs

(in progress)

## Follow-ups for the merge (cross-agent wiring you couldn't finish alone)

(in progress)

## Screenshots (list of files)

(in progress)
