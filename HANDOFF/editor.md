# Editor handoff

## Plan

Build the block editor in `packages/editor` (TipTap 3 on Yjs) and register it through
`apps/web/src/features/editor`. Milestones, each ending tested and committed:

1. **M1 — Core editing on Yjs.** One TipTap extension per canonical node and mark
   (`src/schema`), a conformance test against `SCHEMA_DESCRIPTION`, the page body
   (`PageEditor`) bound to `getPageContent(handle.doc)` with the Yjs undo manager, placeholders,
   title ↔ body focus, block IDs, read-only mode and scroll-to-target.
2. **M2 — Notion-style blocks.** Slash menu (fuzzy, ranked, recent first, registry items),
   markdown shortcuts, a pointer-driven block handle (drag with drop indicator, into and out of
   lists and toggles; block menu with turn into, duplicate, delete, copy as markdown, color),
   callout, toggle, code block (lowlight, language picker, copy), image (paste, drop, upload via
   `AssetStore`, resize, alt, caption), tables (size picker, row/column menu, header toggle,
   Tab, resizing), embeds through `BlockRendererRegistry` plus the `web` renderer.
3. **M3 — Linking.** `[[` and `@` page autocomplete with "Create page", live `pageLink` titles,
   broken-link style, hover preview, `#tag` input rule and tag click → search command, URL paste
   (link over selection; keep/embed/bookmark menu for bare URLs).
4. **M4 — Clipboard.** Copy HTML + markdown (codec), paste markdown/HTML/plain text through the
   codec, internal copy/paste lossless, tests with a richer fake codec.
5. **M5 — Collaboration and polish.** Remote cursors from awareness when a sync provider is
   active, selection toolbar, block keyboard ops, editor commands in `CommandRegistry`,
   2,000-block typing-latency test, accessibility, phone width.
6. **Finish.** e2e specs in `e2e/editor`, screenshots, this file completed, completion audit.

## Built (what exists and where)

_In progress._

## How it plugs in (FeatureModule entries, services, extension points used)

_In progress._

## Decisions (and why)

_In progress._

## Contract change requests (exact proposed diff to packages/core, and why)

_In progress._

## Known gaps and bugs

_In progress._

## Follow-ups for the merge (cross-agent wiring you couldn't finish alone)

_In progress._

## Screenshots (list of files)

_In progress._
