# Agent 02 — Editor

**Parallel phase, branch `feat/editor`. Effort: xhigh.**

You own `packages/editor`, `apps/web/src/features/editor`, and your HANDOFF, screenshot and e2e folders.

## Why this matters

The editor is the product. People judge Tessera in the first 30 seconds of typing. It has to feel as good as Notion: instant, predictable, keyboard-first and beautiful. Every millisecond of lag and every odd cursor jump costs stars.

## Read first

`CLAUDE.md`, `SPEC.md`, `HANDOFF/architect.md`, and in `packages/core`: the document schema, the `DocJSON` utilities, `AppContext` (especially `acquirePageDoc`), `BlockRendererRegistry`, `CommandRegistry`, `MarkdownCodec`, `AssetStore` and `FeatureModule`.

## M1 — Core editing on Yjs

- A TipTap editor implementing **exactly** the canonical schema from `packages/core`: every node and mark, with the same names, attributes and content rules.
- **Schema conformance test:** compare TipTap's generated schema with core's machine-readable schema description and fail on any difference. This test keeps the editor, importers and indexers compatible.
- Bind to the page doc's `content` fragment through `acquirePageDoc`. Never create your own persistence or provider. Undo and redo go through the Yjs undo manager, so undo only affects your own changes.
- Register the editor as the `page` entry in `pageBodies` in your `FeatureModule`.
- Placeholder "Type '/' for commands" on the focused empty block, and a quieter placeholder on empty pages.
- Enter in the page title moves focus to the first block; ArrowUp at the start of the first block returns to the title. If the shell doesn't expose a focus hook for this, file a contract change request and list it as a merge follow-up.

## M2 — Notion-style blocks

- **Slash menu** (`/`): a fuzzy-filtered list of every block type with icon, name, description and shortcut hint; full keyboard navigation; recently used first. It also lists block types other features register through `BlockRendererRegistry` (databases, plugin blocks).
- **Markdown shortcuts:** `#`, `##`, `###`, `-` and `*`, `1.`, `[]` and `[x]`, `>`, ```` ``` ````, `---`, `**bold**`, `*italic*`, `` `code` ``, `~~strike~~`, `==highlight==`.
- **Block handle** on hover: drag to reorder (including into and out of lists and toggles, with a clear drop indicator); click to open a block menu with turn into, duplicate, delete, copy as markdown and color.
- **Turn into** between compatible block types, keeping the content.
- **Callout** with an emoji picker and tone; **toggle** that remembers its open state; **code block** with syntax highlighting (lowlight), a language picker and a copy button; **image** blocks you can paste, drop or upload, stored through `AssetStore`, resizable, with alt text and a caption.
- **Tables:** insert with a size picker, add and remove rows and columns, toggle the header row, Tab navigation, column resizing.
- **Embeds:** the `embed` node renders whatever component `BlockRendererRegistry` provides for its kind. Unknown kinds render a clean "This block needs a plugin" placeholder and never crash. Implement the `web` kind yourself: YouTube, Vimeo, Loom, Figma, CodePen and a generic link card, in sandboxed iframes with a domain allowlist.

## M3 — Linking

- `[[` (and `@`) opens page autocomplete: fuzzy over page titles, recent pages first, arrow keys and Enter, plus "Create page 'X'", which creates the page through core helpers and links to it.
- `pageLink` renders the target's current title and updates live when the target is renamed. Trashed or missing targets get a clear broken-link style. Clicking navigates; hovering shows a preview card with the first lines of the target page.
- The `#tag` input rule creates `tag` nodes. Clicking a tag runs a search for it through the command system.
- Pasting a URL over selected text makes a link. Pasting a bare URL offers three choices: keep as link, embed, or bookmark card.

## M4 — Clipboard and markdown

- Copy puts both HTML and markdown (through `MarkdownCodec`) on the clipboard. Paste accepts markdown, HTML (sanitized) and plain text through `MarkdownCodec.parse` and `parseHTML`.
- The stub codec only knows paragraphs and headings; Agent 08's real codec replaces it at merge. Code against the interface and keep a test that uses a richer fake codec.
- Pasting from Notion, Google Docs and web pages should produce sensible blocks, never raw HTML.

## M5 — Collaboration and polish

- Remote cursors and selections, with name and color from `awareness`, whenever a sync provider is active. Local-only mode shows nothing.
- A floating toolbar on text selection: bold, italic, underline, strike, code, link, highlight, turn into.
- Keyboard: `Mod+Shift+↑/↓` moves blocks, `Mod+D` duplicates, `Esc` selects the current block, arrow keys move between selected blocks, `Delete` removes them.
- Commands registered in `CommandRegistry`: word and character count, copy page as markdown, toggle full width, toggle small text.
- Performance: no layout shift while typing, 60 fps block dragging, and typing latency < 16 ms p95 on a 2,000-block page. Write a performance test that measures it. Prefer plain DOM node views over React node views for simple nodes.
- Accessibility: menus have correct ARIA roles and full keyboard support, focus is always visible, and basic writing works with a screen reader.
- Touch: usable at phone width (the block handle becomes a tap target and the toolbar fits).

## Acceptance criteria

- The schema conformance test passes.
- Unit tests cover every input rule, every command, slash-menu filtering and ranking, and link autocomplete.
- Playwright e2e in `e2e/editor/`: write a document using only markdown shortcuts; insert every block type from the slash menu; drag a block to a new position and into a toggle; create a page through `[[` and navigate to it; rename the target and see the link text update; paste markdown and HTML fixtures and get the expected blocks; undo and redo across all of the above.
- The performance test passes on a 2,000-block page.
- Screenshots (light and dark): `slash-menu`, `rich-page` (headings, callout, code, table, toggle, tasks, image), `link-preview`, `selection-toolbar`.

## Pitfalls

- Never keep document content outside Yjs.
- Import only from `packages/core` and `packages/ui`, never from another agent's package.
- TipTap extension names and attributes drift easily from the core schema. Let the conformance test catch it, and don't argue with it.
- Test drag and drop with real pointer events in Playwright, not synthetic shortcuts.
