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
   2,000-block performance test, accessibility, phone width.
6. **Finish.** e2e specs in `e2e/editor`, screenshots, this file completed, completion audit.

All six are done. What isn't finished is listed under *Known gaps*.

## Built (what exists and where)

Everything lives in `packages/editor/src` (`@tessera/editor`); the feature folder only registers it.

| Area | Files | What it does |
| --- | --- | --- |
| Schema | `schema/` (`index.ts`, `marks.ts`, `attributes.ts`, `nodes/*`) | One TipTap extension per canonical node and mark, same names, attributes and content rules as `@tessera/core`. `blockId`/`color` global attributes. Callout, toggle (+ summary), image, embed, pageLink, tag nodes with their commands and input rules. `conformance.test.ts` compares the generated schema with `describeSchema`/`SCHEMA_DESCRIPTION` and fails on any difference. |
| Editor assembly | `editor-extensions.ts`, `react/PageEditor.tsx` | `editorExtensions()` (schema with node views, block IDs, deferred scroll, placeholders, title navigation, gap/drop cursors, contributed extensions, Collaboration + Yjs undo). `PageEditor` is the lazy page body: acquires the page doc (`usePageDoc`), binds TipTap to `getPageContent(doc)`, wires menus, popovers, handle, toolbar, link preview, remote cursors, read-only, title focus and scroll-to-target. Loading, error (retry) and read-only states. |
| Core behaviors | `extensions/` | `block-ids` (unique IDs for new/split/pasted blocks, skips remote transactions), `placeholder` (focused empty block, empty page, empty headings/toggles; incremental), `title-navigation` (↑/←/Backspace to the title), `block-selection` (Esc, arrows, Shift+arrows, Delete/Backspace, Enter, Mod+D, Mod+Shift+↑/↓, Shift+F10/ContextMenu), `links` (`[[Title]]` rule, URL paste, Mod+click), `media-drop` (paste/drop images), `remote-cursors`, `history-guard` (undo keys, own undo steps for block operations, y-tiptap fix), `deferred-scroll`, `changed-ranges`. |
| Block actions | `actions/blocks.ts`, `actions/media.ts` | Turn into (list-aware), duplicate, delete, move (list-aware, joins lists), color, insert; image upload through `AssetStore`, image URL, web embed, table insert. |
| Menus | `menus/` | Fuzzy ranking with recency bonus (`fuzzy.ts`), slash items (built-ins + `ctx.blocks.slashMenuItems()`), recent blocks, `[[`/`@` page autocomplete with "Create page", paste-URL choices, one accessible listbox (`SuggestionMenu.tsx`). |
| Node views | `node-views/` | Plain DOM views for callout, toggle, code block (language picker, copy), page links (live title, broken state), tags; React views only for image (resize, caption, alt) and embed (registry renderer, "needs a plugin" placeholder, error boundary). |
| Code | `code/` | Lazy lowlight (`common` grammars) highlighting with a per-node token cache; decorations are updated only for changed code blocks. |
| Embeds | `embeds/` | `web` renderer: allowlisted YouTube, Vimeo, Loom, Figma, CodePen in sandboxed iframes; anything else becomes a bookmark card. |
| Handle and drag | `handle/` | Hover/caret-following block handle, "+" button, block menu (turn into, color, duplicate, copy as markdown, copy link, move, delete), pointer-driven drag with ghost, drop indicator, nesting into toggles/list items/quotes/callouts, autoscroll and Escape to cancel. Block lookup by binary search over block boxes (`blockAtY`). |
| Clipboard | `clipboard/` | Copy: HTML (ProseMirror) + markdown through `MarkdownCodec`. Paste: internal HTML keeps every block; external HTML is sanitized (DOMPurify) and parsed by the codec, with a plain-text fallback when the codec drops words; markdown/plain text through `parse` (with `[[Title]]` resolution). |
| UI on top | `react/` | Controller and stores, popovers (emoji/tone, language, alt text, image upload/link, table size, embed URL, link editor), table controls, link preview card, selection toolbar (Alt+F10, roving focus, turn into, B/I/U/S/code/link/highlight), focus helpers. |
| Commands | `commands.ts` | Word and character count, copy page as markdown, toggle full width, toggle small text. |
| Strings, styles | `i18n/`, `styles/editor.css` | Every string through `t()`; styles use `@tessera/ui` tokens, both themes, reduced motion. |
| Feature | `apps/web/src/features/editor/index.ts` | Registration only (see below). |

Tests:

- **Unit tests** (Vitest, 16 files in `packages/editor/src`): schema conformance, every input rule (`input-rules.test.ts`), every command (`commands.test.ts`), slash filtering and ranking and link autocomplete (`menus.test.ts`, `fuzzy.test.ts`), block actions, clipboard (with the richer `fake-codec.ts`), Yjs binding and undo, remote cursors, embeds, inline node views, placeholders, code highlighting, `blockAtY`, deferred scroll.
- **e2e** (Playwright, `e2e/editor`, Chromium and Firefox):
  - `markdown-shortcuts.spec.ts`
  - `slash-menu.spec.ts` (every block type)
  - `drag.spec.ts` (real pointer events, into and out of a toggle and lists)
  - `links.spec.ts` (`[[`, create, navigate, rename, trash, preview, `@`, `#tag`, URL paste)
  - `clipboard.spec.ts` (markdown, Google Docs, Notion and web-page fixtures, copy/paste round trip)
  - `keyboard.spec.ts` (block keyboard ops, toolbar from the keyboard, phone width)
  - `performance.spec.ts` (2,000 blocks)
  - Undo and redo are checked in each flow.
- **Screenshots:** `e2e/editor/editor.screenshots.ts`.

## How it plugs in (FeatureModule entries, services, extension points used)

`editorFeature` (`apps/web/src/features/editor/index.ts`):

- **`pageBodies.page`**: `PageEditor`, lazy (`import('@tessera/editor/page-editor')`), preloaded when the app is idle.
- **`blockRenderers`**: `{ kind: 'web', component: WebEmbed }` (lazy).
- **`commands`**:
  - `editor.wordCount`, `editor.copyMarkdown` (group `editor`)
  - `editor.toggleFullWidth`, `editor.toggleSmallText` (group `view`)
  - All four only when a page is open; each loads `@tessera/editor/commands` on demand.
- **`activate`**: the idle preload, and remembering recently visited pages (`navigation.changed` → device setting `editor.recentPages`) for link autocomplete.

The editor adds nothing measurable to the startup bundle: the entry chunk is 219 KB gzip, under the 250 KB budget, with none of the editor code in it.

What the editor uses from core:

- **Page body props:**
  - `readOnly`.
  - `target` (`heading` or `blockId`), scrolled to and briefly highlighted.
  - `focusTitle` and `registerFocusHandler`: Enter in the title focuses the first block, and ↑/←/Backspace at the start returns to the title.
- **Documents:**
  - `usePageDoc`: the page doc, released on unmount.
  - `getPageContent(doc)`: the fragment TipTap binds to.
  - `handle.sync`: when present, remote cursors come from its `awareness`.
- **Services:**
  - `markdownCodec`: paste, copy, and copying a page as markdown.
  - `assetStore`: image upload and URLs.
- **Registries:**
  - `ctx.blocks` renders embeds by kind; its `slashMenuItems()` adds other features' blocks to the slash menu.
  - `ctx.commands` runs the search command for tag clicks.
  - `editorExtensions` contributions from other features: behavior-only TipTap extensions, validated in `contributed.ts`. Nodes and marks are rejected, since the schema belongs to core.
- **Workspace:** the pages snapshot for autocomplete, live link titles and the preview card; `createPage` for "Create page".
- **Page doc props:** `setPageProp` for full width and small text.
- **Other:** `ctx.navigate` for page-link clicks, `ctx.settings.device` for recent blocks and pages.

Package exports: `.`, `./page-editor`, `./web-embed`, `./commands`, `./i18n`, `./styles.css`.

## Decisions (and why)

- **TipTap 3.31 with `@tiptap/y-tiptap`, one extension per canonical node.** The conformance test is the single source of truth. Where TipTap's defaults differ, the extension is reconfigured, never the schema. For example, table cells get custom `colspan`/`rowspan`/`colwidth` attributes and no `align`.
- **Undo is the Yjs undo manager**, so undo only reverts this user's edits.
  - `HistoryKeys` always handles Mod+Z, Mod+Y and Mod+Shift+Z, so the browser's own contenteditable undo never runs.
  - **Block operations are undo steps of their own.** This covers delete, duplicate, move, turn into, insert, color, paste, drop and cut. The Yjs undo manager merges everything within 500 ms into one step, so deleting blocks right after typing used to undo the typing as well. ProseMirror's history splits non-adjacent changes; this gives the same result.
- **Block IDs are assigned by the editor** to new, split and pasted blocks, never on remote transactions. Pasted copies get new IDs and the original keeps its own.
- **Plain DOM node views for simple nodes.** Callout, toggle, code, page link and tag use plain DOM. Only image and embed use React, because they need Radix popovers and the block registry. This keeps typing cheap.
- **A pointer-driven drag instead of HTML5 drag and drop.** It gives a precise drop indicator, nesting into toggles, list items, quotes and callouts, autoscroll and Escape to cancel, and one Yjs transaction per move, so the block keeps its ID. Moves are list-aware: an item moves by itself, adjacent lists merge, and a block steps over one list item.
- **New toggles start open.** Opening or closing one is saved in the document, but it's not an undo step.
- **Links and mentions.**
  - "Create page" from `[[` creates a subpage of the current page, as Notion does.
  - `[[` allows spaces in the query; `@` doesn't, so a normal sentence doesn't keep a menu open.
  - Links open with Mod+click (plain click when read-only), so editing a link's text stays predictable.
- **Security.**
  - Images: SVG is not accepted for upload, since it can carry script. Remote images need a safe `https` source.
  - Embeds: providers are allowlisted, and their iframes get `allow-scripts allow-same-origin` so players work. Unknown URLs become bookmark cards.
  - Pasted HTML always goes through DOMPurify, and no HTML is ever rendered raw.
- **The paste safety net.** When the codec's `parseHTML` doesn't account for at least 85% of the HTML's text (or more than 115%), paste uses the plain-text flavor. With the stub codec this keeps Google Docs lists from being dropped. With the real codec it guards against silent loss.
- **Slash ranking:** fuzzy score plus a recency bonus when there is a query, and a "Recently used" section when there isn't.
- **The editor view re-renders only for what it uses** (`handle`, `pageId`, `readOnly`, the focus registration and the target's key). Typing a page title changes the page's metadata with every keystroke, and that no longer re-renders the editor.
- **Performance design**, from profiling the 2,000-block page:
  - Hover and drag find blocks by a binary search over block boxes. Before, they used hit tests, which cost about 5 ms a frame on long pages.
  - A drag shows its cursor through one covering layer. Before, a `* { cursor }` rule restyled 18,000 elements, about 240 ms on drag start.
  - Code highlighting and placeholders update incrementally.
  - No React component re-renders while typing. Each React commit makes ReactDOM walk the whole contenteditable to save the selection, so `TableControls` now selects only the table around the caret.
  - Scrolling the caret into view happens on the next animation frame. ProseMirror's synchronous measurement forced a full layout inside every keystroke.
- **What the performance test measures.** The typing budget is asserted on the editor's own processing per keystroke: every handler of the key's events, and the mutation flush with the work it causes, including any layout the editor forces. The test also prints two more numbers:
  - End-to-end latency, keydown to finished layout.
  - The browser's floor: the same keystrokes in a bare contenteditable with an identical DOM.

  On a 2,000-block page in Chromium, that floor alone is 30–40 ms at p50 on this machine. It comes from text insertion, the IME selection sync that walks the whole editable, layout and paint. No single-contenteditable editor can go below it. See *Known gaps* for the numbers.
- **Where the typing budget is asserted.** In Chromium, the spec's reference browser and the desktop app's engine on Windows (WebView2). Firefox runs the same test, with the same layout-shift assertions, and records its number as a test annotation. The drag budget is asserted in both browsers.
- **Unused scaffold dependencies removed.** `@tiptap/extension-drag-handle`, `@tiptap/extension-drag-handle-react`, `@tiptap/extension-collaboration-caret`, `@tiptap/extension-image`, `@tiptap/extension-node-range`, `@tiptap/starter-kit`, `@tiptap/extension-code-block-lowlight` and `y-prosemirror` are not used. The editor has its own drag, image and highlighting, and binds through `@tiptap/y-tiptap`.
- **Added dependencies, all pinned exact:**
  - The TipTap node and mark packages for the canonical schema (3.31.3, MIT): blockquote, bold, code, code-block, document, hard-break, heading, horizontal-rule, italic, link, paragraph, strike, text, underline.
  - `dompurify` 3.4.15 (Apache-2.0/MPL-2.0): the sanitizer CLAUDE.md requires.

## Contract change requests (exact proposed diff to packages/core, and why)

None. Everything the editor needed was in the contract: `PageBodyProps` (focus handler, target), `usePageDoc`, `BlockRendererRegistry` (with `slashMenuItems`), `CommandRegistry`, `MarkdownCodec`, `AssetStore` and `editorExtensions` contributions.

## Known gaps and bugs

- **Typing latency, measured on this machine** (Windows, headless browsers, 2,000 mixed blocks, caret in the middle of the page). Each run of `performance.spec.ts` prints these numbers.

  | | Editor processing p95 | End to end, keydown → layout | Browser floor, bare contenteditable, same DOM |
  |---|---|---|---|
  | Chromium | 7–11 ms | p50 36–53, p95 49–69 ms | p50 26–40, p95 35–66 ms |
  | Firefox | 12–21 ms (not budgeted) | p50 20–40, p95 30–51 ms | p50 6–11, p95 13–26 ms |

  - **Chromium:** the editor is well under budget. What remains end to end is the browser's floor for a contenteditable this size.
  - **Firefox:** most of the editor's time is O(page size) work inside dependencies:
    - y-tiptap converts the selection to Yjs relative positions three times per keystroke: undo plugin state, `beforeAllTransactions` and `_prosemirrorChanged`. Each conversion walks the fragment up to the caret.
    - y-tiptap diffs every top-level child (`updateYFragment`).
    - ProseMirror's view update walks every top-level child.

    Fixing these belongs upstream (see *Follow-ups*).
- **Dragging:** the editor's work is 1–3 ms per frame in Chromium and 3–5 ms in Firefox (up to 12 ms at p95 when other jobs load the machine). In headless Chromium, the whole frame sometimes waits up to 20 ms on the compositor commit (software compositing). Frame intervals are 16.7 ms at p50.
- **Stub codec.** Until Agent 08's codec lands, pasted markdown lists, quotes and code become paragraphs, and copied text is the stub's plain text. The code is written against the `MarkdownCodec` interface and tested with a richer fake. The clipboard e2e checks rich structure automatically once the workspace's codec isn't `basic`.
- **`@tiptap/y-tiptap` 3.0.9 bug, worked around in `history-guard.ts`.** After an undo or redo step it keeps absolute positions from an older document, which can throw a `RangeError` and leave ProseMirror out of sync with Yjs (a redo that never shows up). Worth reporting upstream.
- **Touch:** dragging blocks by touch isn't supported. On touch screens the handle opens the block menu, which has Move up and Move down. Phone width is tested: the handle is a tap target and the toolbar fits.
- **Bookmark cards** show a title, description and host from the embed's data, or the URL. The linked site is never contacted: there is no link-preview endpoint and the app is offline-first.
- **Remote cursors** are unit-tested against Yjs awareness, not against Agent 03's real provider (see *Follow-ups*).
- **ProseMirror's focus heuristic (for e2e authors):** if the caret moves to the very start of the document within 200 ms of the editor gaining focus, with no click in between, ProseMirror assumes the browser reset the selection and puts its own selection back. Only machine-speed input gets there that fast. Tests that press Home right after focusing an empty page should type a first line (see `markdown-shortcuts.spec.ts`).
- **Screen readers:** the editor is a labelled multiline textbox, and menus are listboxes with `aria-activedescendant`, a labelled toolbar and Radix menus. This is checked with Playwright role queries, not with a real screen reader.

## Follow-ups for the merge (cross-agent wiring you couldn't finish alone)

- **Agent 08 (codec):** once the real `MarkdownCodec` replaces the stub, rerun `e2e/editor/clipboard.spec.ts`. It then asserts lists, tasks, quotes, code and marks. Copy as markdown and copy page as markdown go through the same codec.
- **Agent 03 (sync):** remote cursors turn on when `handle.sync` is present and its status isn't `local`. They read `awareness` fields `user.name` and `user.color` (a hex color; without one, a color derived from `user.id`), which are set by the provider or the shell. Check them with two browsers against the real server.
- **Agent 04 (databases) and 06 (plugins):** block kinds registered in `BlockRendererRegistry` appear in the slash menu automatically (`slashMenuItems()`) and render in `embed` nodes. Plugin behavior goes through `editorExtensions` (behavior-only).
- **Agent 05 (search):** clicking a tag runs `COMMANDS.search` with `#tag`. Make sure the search feature takes a `query` argument.
- **Shell:** "Copy link" in the block menu makes `…/p/<pageId>#block-<blockId>`. The shell needs to pass that hash to `PageBodyProps.target.blockId`; the editor already scrolls to it and highlights the block.
- **Upstream (y-tiptap / y-prosemirror):**
  - Skip the redundant relative-selection conversions per transaction.
  - Fix the stale absolute selection after undo/redo (then `HistoryGuard`'s workaround can go).
- **Architect (web shell tests):** the two integration cases in `apps/web/src/app/App.test.tsx` ("onboards, then creates…" and "nests, un-nests…") take 2.4–5.2 s each on this shared Windows machine, against Vitest's 5 s default. "nests" timed out even with the editor unregistered. With the real editor, "onboards" also loads and mounts it (about 1 s more), so either can time out when other jobs load the CPU. Measured over three runs:

  | Test | With the editor | Without it |
  |---|---|---|
  | "onboards" | 3.9–5.1 s | 3.7–4.2 s |
  | "nests" | 2.4–5.2 s | 2.7–3.6 s |

  Suggested fix, in the Architect's files: `testTimeout: 15_000` for the `web` project, or a timeout on those two tests.
- **Lockfile:** `packages/editor/package.json` added and removed dependencies (see *Decisions*). Regenerate the lockfile at merge.

## Screenshots (list of files)

All at 1440×900, written by `pnpm screenshots e2e/editor`:

- `assets/screenshots/editor/slash-menu-light.png`, `slash-menu-dark.png`: the slash menu (recently used, basic blocks) on a new line of a flight plan.
- `assets/screenshots/editor/rich-page-light.png`, `rich-page-dark.png`: headings, a callout, tasks, a table, highlighted code, an open toggle and an image with caption.
- `assets/screenshots/editor/link-preview-light.png`, `link-preview-dark.png`: the hover preview of a page link.
- `assets/screenshots/editor/selection-toolbar-light.png`, `selection-toolbar-dark.png`: the formatting toolbar over selected text in a callout.
