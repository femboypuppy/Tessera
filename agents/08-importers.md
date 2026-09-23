# Agent 08 — Markdown engine, import & export

**Parallel phase, branch `feat/importers`. Effort: xhigh.**

You own `packages/markdown`, `packages/importers`, `apps/web/src/features/import-export`, and your HANDOFF, screenshot and e2e folders.

## Why this matters

Switching to Tessera must take one click, and leaving must be just as easy. "Import your Notion workspace or Obsidian vault in 30 seconds" is a headline feature, and "export to plain markdown any time" is the trust promise behind local-first.

## Read first

`CLAUDE.md`, `SPEC.md`, `HANDOFF/architect.md`, and in `packages/core`: the document schema and `DocJSON`, `MarkdownCodec`, `Importer`, `Exporter`, `AssetStore`, the database types and helpers, and `FeatureModule` (`services`, `importers`, `exporters`, `onboardingActions`).

## M1 — Markdown engine (`packages/markdown`)

It implements `MarkdownCodec` (register it as a service, priority 50). The editor, importers, exporters and plugins all depend on it, so it has to be excellent.

- unified + remark (GFM, frontmatter) plus custom syntax plugins for: `[[wikilinks]]` with `|alias`, `#heading` and `^block` parts; `![[embeds]]`; `#tags`; Obsidian callouts (`> [!note] Title`, including foldable variants); task lists; tables; `==highlight==`; and toggles (round-tripped as `<details>`).
- `parse`: markdown → `DocJSON` for the canonical schema, plus frontmatter.
- `serialize`: `DocJSON` → clean, idiomatic, Obsidian-compatible markdown, with options for link style (`[[wikilinks]]` or relative markdown links) and attachment paths.
- `parseHTML`: HTML → `DocJSON` for paste, sanitized with DOMPurify, handling Notion, Google Docs, Word and ordinary web pages sensibly.
- Property-based round-trip tests (fast-check): `serialize(parse(md))` is stable after one normalization pass, and `parse(serialize(doc))` equals `doc` for every schema feature.

## M2 — Importers (each implements `Importer`, with auto-detection)

- **Notion** (the "Markdown & CSV" export zip, including nested zips and multi-part exports): strip Notion's 32-character IDs from names; rebuild the page tree; create databases from the CSVs with their row pages, inferring property types (number, date, checkbox, URL, email, select vs multi-select vs text); rewrite internal links into `pageLink`s; import images and files into `AssetStore`; keep emoji icons where present.
- **Obsidian** (a vault folder or zip): folders become pages; frontmatter becomes page properties (tags, aliases); wikilinks and embeds resolve with Obsidian's rules (shortest unique path, case-insensitive, aliases); attachments import; callouts convert; `.obsidian/` and `.trash/` are ignored.
- **Markdown folders or files:** plain markdown with relative links. **CSV files inside a markdown folder become databases.** The demo workspace relies on this.
- Stretch: Logseq, Bear, Evernote `.enex`, HTML files.
- Imports are streaming and incremental with progress (files done, current file), cancellable, run in a worker so the UI stays smooth, and land under a new top-level page so nothing existing is touched.
- Every import produces an **Import report**: counts, warnings (unresolved links, unsupported syntax, skipped files) and errors, with links to the affected pages.

## M3 — Export

- A whole workspace or page subtree → a zip of Obsidian-compatible markdown (attachments alongside, frontmatter for properties, databases as CSV plus row pages).
- A JSON backup (all Y.Doc states and assets, in a versioned format) and restore into a new workspace.
- A single page → markdown, standalone styled HTML, or PDF through a print stylesheet.
- Register the exporters so the desktop app's markdown mirror can use them.

## M4 — UI

- Import dialog: drop a zip or folder, or pick files; an auto-detected source you can override; a preview of what will be imported; progress; and the report at the end.
- Export dialog with format and scope options.
- `onboardingActions`: "Import from Notion", "Import from Obsidian", "Import markdown", and "Open demo workspace", which loads `examples/demo-workspace` (a markdown folder with CSV databases written by Agent 10). Until it exists on your branch, bundle a small fixture of your own.

## Acceptance criteria

- Realistic fixtures in `packages/importers/fixtures/`, built by you to mimic real Notion and Obsidian exports: nested pages, databases with every property type, unicode and emoji file names, spaces and `%20` in links, duplicate titles, broken links, images, deep nesting.
- Importer tests assert the page tree, resolved links, typed properties and the report's contents.
- Round trip: Obsidian vault → import → export → import produces an equivalent workspace.
- A 2,000-file vault imports without freezing the UI, with the timing recorded in HANDOFF.
- e2e in `e2e/importers/`: import the Obsidian fixture through the UI and follow the imported links; export a zip and check its contents.
- Screenshots (light and dark): `import-dialog`, `import-progress`, `import-report`, `export-dialog`.

## Pitfalls

- Never trust file names from archives. Normalize paths and reject `..` and absolute paths (zip slip).
- Sanitize every piece of HTML that comes from an import.
- Keep the codec deterministic. Flaky round trips will haunt every other feature.
