# Docs handoff

## Plan

Milestones from `agents/10-docs-launch.md`, each committed when it worked. All done.

1. **Brand.** Mosaic logo, wordmarks, favicon set and a 1280×640 social preview in `assets/brand/`,
   rendered with Playwright from SVG/HTML sources by one script, with colors from the design tokens.
2. **README.** Logo, tagline, badges, links row, demo GIF placeholder, why lines, features with the
   exact screenshot names from the agent files, quickstart, a dated comparison table, roadmap,
   contributing, community, license, acknowledgements, star history.
3. **Docs site.** VitePress in `docs/`: home, guides, the self-hosting reference, architecture,
   an auto-built plugins sidebar, dark mode, local search, edit links, the GitHub Pages base path.
4. **Community files.** CONTRIBUTING, Contributor Covenant 2.1, issue forms, PR template, and the 15
   good first issues below.
5. **Demo workspace and launch kit.** `examples/demo-workspace` (39 pages, 2 CSV databases, 1
   image), `LAUNCH.md`, `BUILT_WITH_AGENTS.md`.
6. **Checks.** `docs/scripts/checks.test.ts` (issue forms, demo workspace, brand) and
   `e2e/docs/*.spec.ts` (README links and images, brand SVGs and PNGs, docs screenshots).

## Built (what exists and where)

| Path | What |
|---|---|
| `README.md` | The front page. Every image path is listed under *README image paths* below. |
| `assets/brand/` | `logo-mark.svg`, `app-icon.svg`, `favicon.svg`, `favicon.ico` (16/32/48), `wordmark-light.svg`, `wordmark-dark.svg`, `social-preview.html` (template) → `social-preview.png` (1280×640), `png/` (mark at 16–512, app icon at 180/192/512/1024, wordmarks, `legibility.png` review sheet, `demo-placeholder.png`). |
| `assets/demo.gif` | A clearly labeled "Demo recording coming soon" placeholder. The polish phase replaces it; the brand script never overwrites an existing GIF. |
| `docs/` | A standalone pnpm project (`@tessera/docs`, own `pnpm-workspace.yaml` and lockfile, because the root workspace only globs `apps/*` and `packages/*`). |
| `docs/.vitepress/config.mts` | Nav, sidebars, local search, edit links, Mermaid, `base` from `DOCS_BASE` (default `/Tessera/`), a dev middleware and a `buildEnd` copy that serve `assets/screenshots` at `/screenshots/`, and the plugins sidebar built from `docs/plugins/`. |
| `docs/.vitepress/theme/` | Default theme + token colors (`style.css`) + `<Screenshot name alt>` (light/dark image, hides itself if the file doesn't exist yet). |
| `docs/index.md`, `docs/guide/*`, `docs/self-hosting/*`, `docs/contributing/*` | 22 pages with the home page: what is Tessera, installation, first steps, editor, keyboard shortcuts, databases, links and graph, search, import and export, sync and collaboration, desktop, FAQ, troubleshooting; self-hosting overview, configuration reference, HTTPS, backups, upgrading; contributing, architecture (from SPEC.md, with the Mermaid diagram), writing docs (incl. the GitHub Pages base path). |
| `docs/scripts/brand.ts`, `render-brand.ts` | Brand geometry and colors from `packages/ui/src/styles/tokens.css`; `pnpm --dir docs brand` regenerates everything in `assets/brand/`, `assets/demo.gif` (only if missing, needs ffmpeg) and `docs/public/`. |
| `docs/scripts/screenshot-docs.ts` | `pnpm --dir docs screenshots` builds the site and screenshots it at 1440×900 in both themes. |
| `docs/scripts/checks.test.ts`, `csv.ts` | 19 `node:test` checks; `pnpm --dir docs test`. `pnpm --dir docs build` runs them before building. |
| `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md` | Dev setup, repo tour, first issues, commit convention, PR checklist, writing a plugin; Contributor Covenant 2.1. |
| `LICENSE` | Unchanged: MIT, `Copyright (c) 2026 femboypuppy` (the owner confirmed it). |
| `.github/ISSUE_TEMPLATE/` | `bug_report.yml` (environment fields, data-loss question, diagnostics), `feature_request.yml`, `question.yml` (points to Discussions), `config.yml` (blank issues off; Discussions, private security reports, docs). |
| `.github/PULL_REQUEST_TEMPLATE.md` | What/why, how to test, screenshots, checklist. |
| `examples/demo-workspace/` | `Welcome to Tessera` (interactive checklist tutorial), `Keyboard shortcuts`, `Every block type`, `Inbox`, `Projects.csv` (20 rows: select, multi-select, date, number, currency-like, checkbox), `Reading list.csv` (16 rows), `Meeting notes/` (4 meetings + a template), `Knowledge garden/` (30 interlinked notes on the history of space exploration, with tags and aliases; about 250 wikilinks across the workspace), `attachments/hohmann-transfer.png`. |
| `LAUNCH.md` | Show HN title, post and first comment; r/selfhosted and r/opensource posts; Product Hunt listing; a 7-post thread; the blog post "Building a local-first Notion alternative with Yjs"; the launch-day checklist. |
| `BUILT_WITH_AGENTS.md` | An honest write-up of the multi-agent process. Not linked from the README: the owner decides. |
| `e2e/docs/` | `readme.spec.ts` (links, anchors, images, alt text, top-of-README contents, quickstart length, comparison table), `brand.spec.ts` (SVG validity, rendering at 16/32/64 px, PNG/ICO sizes, docs screenshots), `repo-files.ts` helpers. |
| `assets/screenshots/docs/` | `docs-home`, `docs-guide`, `docs-self-hosting`, each `-light.png`/`-dark.png`, 1440×900. |

### Taglines (for the owner)

Used: **"Your notes, your server. Notion's power, Obsidian's freedom."**

Alternatives:

1. "The local-first workspace you actually own."
2. "Blocks, databases and backlinks. On your device, on your server."
3. "Notion-style workspace, Obsidian-style freedom, zero lock-in."
4. "Open-source notes and databases that work offline and sync on your terms."
5. "Think in pages, link like a garden, keep every byte."

## How it plugs in (FeatureModule entries, services, extension points used)

No FeatureModule: the docs team has no app feature. The docs site plugs into the repository:

- The plugins sidebar and the **Plugins** nav link are generated from whatever pages exist in
  `docs/plugins/` (Agent 06), ordered `index`, `getting-started`, `api`, `permissions`,
  `security`, `publishing`, then alphabetically; subfolders become collapsible groups. With no
  plugin pages, the nav links to the folder on GitHub. Tested with a throwaway layout.
- Guides show product screenshots with `<Screenshot name="<area>/<name>">`, served from
  `assets/screenshots/`, so the docs and the README use the same images.

## Decisions (and why)

- **`docs/` is its own pnpm project** (nested `pnpm-workspace.yaml`): the root workspace can't be
  edited by this agent and only covers `apps/*` and `packages/*`. Build: `pnpm --dir docs install
  && pnpm --dir docs build`. The root `pnpm install`, `typecheck`, `lint` and `test` are
  unaffected (root ESLint and Prettier do check `docs/**/*.ts`).
- **VitePress 1.6.4** (the current stable; 2.0 is alpha), `vitepress-plugin-mermaid` 2.0.17 +
  `mermaid` 11.17.2 for the architecture diagram (the plugin doesn't support Mermaid 12 yet).
  The build takes about 3 minutes on this machine; the Mermaid bundle is large but lazy-loaded.
- **New dev dependencies (docs only, pinned):** `vitepress`, `vue` (peer), `vitepress-plugin-mermaid`,
  `mermaid` (MIT); `playwright` 1.63.0 (Apache-2.0, same version as the root, so browsers are
  shared) for rendering; `fontkit` 2.0.4 (MIT) to outline the wordmark; `@fontsource/inter` and
  `@fontsource-variable/inter` 5.3.0 (OFL-1.1, the app's own font); `yaml` 2.9.1 (ISC) for the
  checks; `typescript` 6.0.3 and `@types/*`.
- **Logo:** a 3×3 mosaic whose five solid tiles form a T, with four faint tints. It reads at 16 px
  (see `assets/brand/png/legibility.png`: light, dark and GitHub-dark backgrounds) and on both
  themes, because the tints are translucent. A first version with wider grout read as a generic
  "apps grid"; the tighter grid makes the T dominate. The app icon is the mark in white on an
  indigo gradient (`--tess-accent-hover` dark → `--tess-accent-text` light).
- **Colors come from `tokens.css` at render time**, not copies, and a test compares the committed
  logo with what the tokens produce.
- **Wordmark text is outlined** (Inter 600 through fontkit), so the SVG looks identical on GitHub
  without the font. fontkit can't instantiate variations of a WOFF2 font, hence the static weight.
- **Demo GIF:** a real GIF placeholder (ffmpeg) instead of a broken image, clearly labeled, with
  an HTML comment in the README marking it.
- **Docker badge** is a static GHCR badge: shields.io has no pull counter for GHCR. A real
  "Docker pulls" badge needs a Docker Hub mirror (owner decision).
- **Port 8787 and `ghcr.io/femboypuppy/tessera`** come from the server stub (`apps/server`) and
  the GHCR convention; see follow-ups.
- **Comparison table** verified 2026-09-23 against official docs, pricing pages and license files
  (a research pass with sources). Cells that could mislead as a plain ✅/❌ carry footnotes. Owner,
  please re-check before launch: Anytype prices (monthly vs yearly toggle), AFFiNE's license split
  and monthly prices, Logseq's self-hosted sync (the repo has a sync server; the roadmap still says
  "planned"), Anytype's collaboration (sync when online vs live co-editing), and Notion's USD
  prices (the page rendered in EUR; USD came from its embedded plan data).
- **Code of Conduct contact:** email to the owner at the address on their GitHub profile. No
  address was invented. The owner should add a dedicated conduct address (follow-up).
- **Checks live in two places:** YAML validation needs a parser the root workspace doesn't expose,
  so the issue-form, demo and brand checks are `node:test` files in the docs project (also run by
  `pnpm --dir docs build`, so the docs CI job enforces them). The README and brand-asset checks
  are Playwright specs in `e2e/docs`, run by the root `pnpm test:e2e`.
- **Demo workspace:** uses only what Agent 08's importer supports (wikilinks with aliases and
  headings, `![[embeds]]`, frontmatter `tags` and `aliases`, Obsidian callouts including a
  foldable one, tasks, tables, `<details>` toggles, CSV databases). The garden sits in a
  `Knowledge garden/` folder with a hub note named `Space exploration`, so no note has the same
  name as its folder. No README inside the folder, because the importer would turn it into a page.
  The persona (Orbit Lab building a museum exhibit) is fictional; the space facts were checked.
- **Docs describe the specified behavior** from the agent files and SPEC.md, since the features are
  on other branches. Uncertain specifics are softened or marked "to be confirmed" and listed below.

## Contract change requests (exact proposed diff to packages/core, and why)

None.

## Known gaps and bugs

- The docs describe features as specified, not as implemented. These details need checking against
  the merged code (see follow-ups): keyboard shortcuts and slash-menu keywords, settings labels
  ("Sync & account", backlinks footer), env var defaults (`SIGNUP_MODE`, `MAX_UPLOAD_MB`), the
  `tessera-server` CLI name and backup file format, the default port 8787, the image name, release
  asset file names, how the compose file enables Caddy, and `.env.example`'s location.
- `Screenshot.vue` isn't type-checked (no `vue-tsc`); `tsc` covers the config, theme entry and
  scripts.
- 30 README image paths (15 screenshots × 2 themes) and several docs screenshots belong to other
  agents and don't exist on this branch. The README shows broken images until the merge; the docs
  site hides missing ones.
- `LAUNCH.md`'s r/selfhosted post has a `[link to the README or an album]` slot for the owner.

## Follow-ups for the merge (cross-agent wiring you couldn't finish alone)

- **Swap the placeholder logo (Architect).** Copy `assets/brand/favicon.svg` over
  `apps/web/public/favicon.svg`, add `assets/brand/favicon.ico` and
  `assets/brand/png/app-icon-180.png` (as `apple-touch-icon.png`) to `apps/web/public/` with their
  `<link>` tags in `apps/web/index.html`, and update `apps/web/src/app/LogoMark.tsx` to the final
  geometry (keep `currentColor` and `aria-hidden`):
  ```tsx
  // viewBox 0 0 32 32; tiles 9.2 wide, 2.2 apart, rx 2.3; x/y ∈ {0, 11.4, 22.8}
  const TILES = [
    [0, 0, 1], [11.4, 0, 1], [22.8, 0, 1], [11.4, 11.4, 1], [11.4, 22.8, 1],
    [0, 11.4, 0.3], [22.8, 11.4, 0.3], [0, 22.8, 0.14], [22.8, 22.8, 0.14],
  ] as const;
  // <rect x y width="9.2" height="9.2" rx="2.3" fill="currentColor" fillOpacity={opacity} />
  ```
  Check: the favicon in a browser tab and the sidebar logo in both themes.
- **Desktop icons (Agent 07's area).** Regenerate from the final logo:
  `pnpm --filter @tessera/desktop exec tauri icon ../../assets/brand/png/app-icon-1024.png`.
- **Docs deploy (Agent 09's `docs.yml`).** Build with `pnpm --dir docs install --frozen-lockfile`
  then `pnpm --dir docs build` (runs the checks first), upload `docs/.vitepress/dist`, and set Pages
  to deploy from Actions. The base path is `/Tessera/` (override with `DOCS_BASE`). If you'd rather
  make `docs` a root workspace package, delete `docs/pnpm-workspace.yaml` and `docs/pnpm-lock.yaml`
  and add `docs` to the root `pnpm-workspace.yaml`.
- **Plugin docs (Agent 06).** Nothing to wire: pages in `docs/plugins/` appear in the sidebar. Add
  a `docs/plugins/index.md` so `/plugins/` (linked from the README and issue forms) exists, and
  check `pnpm --dir docs build` passes the dead-link check with them.
- **Screenshots.** After every branch is merged, run `STRICT_SCREENSHOTS=1 pnpm test:e2e e2e/docs`:
  it fails if any README screenshot is missing. Then `pnpm --dir docs screenshots` to refresh the
  docs-site shots.
- **Server configuration (Agent 03).** Copy the defaults from `apps/server/README.md` into
  `docs/self-hosting/configuration.md`, remove "to be confirmed" and the pre-release warning, and
  confirm the CLI (`tessera-server create-owner|backup|restore`) and port.
- **Self-hosting (Agent 07).** Confirm the image name `ghcr.io/femboypuppy/tessera`, the `/data`
  volume, that `.env.example` sits at the repo root, and how the compose file enables Caddy;
  adjust `README.md`, `docs/guide/installation.md` and `docs/self-hosting/*.md` to match. Check
  the release asset names in `docs/guide/installation.md` against the release workflow.
- **Editor, databases, search (Agents 02, 04, 05).** Compare `docs/guide/keyboard-shortcuts.md`,
  `editor.md`, `databases.md` and `search.md` with the shipped commands (`?` overlay), slash-menu
  items and filters.
- **"Open demo workspace" (Agent 08).** Load `examples/demo-workspace` and check: 39 pages, two
  databases with typed columns (select, multi-select, date, number, checkbox), the image on
  `Every block type` and `Hohmann transfer orbit`, the embed of the timeline, and that every link
  resolves (the checks require more than 200 wikilinks, all resolvable by name or alias; there are about 250).
- **CONTRIBUTING commands.** Confirm `pnpm --filter @tessera/desktop tauri dev` exists after
  Agent 07's merge (or update the line), and link `SECURITY.md` (Agent 09) once it's on `main`.
- **Owner tasks before launch:** upload `assets/brand/social-preview.png` in the repository
  settings; enable Discussions with a **Q&A** category (the question form links to
  `/discussions/categories/q-a`); create the labels `bug`, `enhancement`, `question`, `triage`,
  `roadmap`, `good first issue`; enable private vulnerability reporting; add a conduct contact
  email to `CODE_OF_CONDUCT.md`; pick a tagline; decide whether to link `BUILT_WITH_AGENTS.md`.
- **Git history note.** `main`'s commits have different SHAs from the base of the feature branches
  (same messages and the same tree as `feat/docs`'s base). Merging with `--no-ff` works, but the
  history will show both copies unless the owner intended the rewrite.

## README image paths

Exist on this branch: `assets/brand/wordmark-light.svg`, `assets/brand/wordmark-dark.svg`,
`assets/demo.gif` (placeholder).

Promised by other agents (each in `-light.png` and `-dark.png`), verified by `e2e/docs/readme.spec.ts`
against the names in the agent files:

- `assets/screenshots/editor/`: `rich-page`, `slash-menu`, `link-preview`
- `assets/screenshots/databases/`: `board`, `table`, `calendar`
- `assets/screenshots/search/`: `graph`, `backlinks`, `palette`
- `assets/screenshots/sync/`: `presence`, `history-panel`
- `assets/screenshots/plugins/`: `mermaid-block`, `permission-prompt`
- `assets/screenshots/importers/`: `import-report`
- `assets/screenshots/desktop/`: `desktop-window`

The docs guides additionally use `architect/shell`, `architect/onboarding`, `architect/shortcuts`
(exist), `databases/gallery`, `databases/filter-builder`, `search/local-graph`,
`importers/import-dialog`, `importers/export-dialog`, `sync/sync-status`, `sync/connect-server`,
`desktop/workspace-picker` and `desktop/quick-capture`.

## Good first issues (ready to file)

Each is small, real, and points at the code. Labels: `good first issue` plus the area.

1. **Emoji picker: Enter before the emoji data loads does nothing** (`ui`). Known gap from
   `HANDOFF/architect.md`. In `packages/ui` (the emoji picker), queue the Enter press and apply it
   once the lazy data resolves. Done when: typing "rocket" and pressing Enter immediately on first
   use picks 🚀; a unit test covers it.
2. **Split `packages/ui/src/components/forms.tsx`** (`ui`, `performance`). Radix Select, RadioGroup
   and ScrollArea land in the startup bundle (~10 KB gzip) because the shell imports inputs from
   the same file. Move them to their own modules and re-export. Done when: the entry chunk shrinks
   (Agent 09's bundle report) and nothing else changes.
3. **Slash command `/date` inserts today's date** (`editor`). Register a slash-menu item that
   inserts the date formatted with `Intl.DateTimeFormat` in the user's locale. Done when: a unit
   test and an e2e step cover it.
4. **Settings → General shows the app version and "Copy diagnostics"** (`web`). Show the version
   and a button that copies `window.__tessera.diagnostics()` as JSON, with a toast. Mention it in
   `docs/guide/troubleshooting.md`. Done when: covered by an e2e test; strings go through `t()`.
5. **Command palette: a hint row for filters** (`search`). When the query is empty, show one quiet
   row listing `tag:`, `in:`, `type:` and `is:task`. Done when: it's keyboard-skippable and tested.
6. **Graph: press `0` to reset zoom** (`search`). Register a command with a single-key shortcut
   scoped to the graph route, and list it in the `?` overlay. Done when: e2e presses `0` after
   zooming and the camera resets.
7. **Database column menu: "Duplicate property"** (`databases`). Uses `addProperty` with the
   source property's type and config, named "<name> copy". Done when: a unit test checks that
   select options are copied and values are not.
8. **Import report: "Copy report as markdown"** (`importers`). A button in the report view that
   copies counts, warnings and errors as a markdown list. Done when: a unit test covers the
   formatting.
9. **Server: warn when `PUBLIC_URL` is unset on a non-local address** (`server`). At boot, log one
   `warn` line explaining that invite links and secure cookies need it. Done when: tested with the
   config parser; documented in `docs/self-hosting/configuration.md`.
10. **Example plugin: reading time** (`plugins`). Copy `examples/plugin-template` to
    `examples/plugins/reading-time`: a panel showing "N min read" at 230 words per minute, with a
    README and tests. Done when: it installs from a folder and its tests pass.
11. **Trash: sort by deletion date or title** (`web`). Add a sort control to the Trash view.
    Done when: keyboard accessible, in both themes, covered by an e2e test.
12. **Demo workspace: a weekly review template** (`docs`). Add
    `examples/demo-workspace/Weekly review template.md` with prompts and a to-do list, linked from
    `Welcome to Tessera`. Done when: `pnpm --dir docs test` passes.
13. **Docs: "Coming from Obsidian" guide** (`docs`). A page mapping Obsidian concepts (vaults,
    folders, frontmatter, callouts, plugins) to Tessera, linked from the FAQ. Done when:
    `pnpm --dir docs build` passes with no dead links.
14. **Docs: app-store templates for Unraid and CasaOS** (`docs`, `self-hosting`). Document the
    template values (image, port, volume, env) in `docs/self-hosting/`. Done when: someone has
    tested the steps on one platform, noted in the PR.
15. **Page tree: "Collapse all" in the sidebar menu** (`web`). Collapse every expanded page in the
    tree. Done when: an e2e test expands three levels, collapses all, and the tree shows only top
    level pages.

## Screenshots (list of files)

- `assets/screenshots/docs/docs-home-light.png`, `docs-home-dark.png`: the docs home page.
- `assets/screenshots/docs/docs-guide-light.png`, `docs-guide-dark.png`: First steps, with the
  sidebar and an embedded screenshot.
- `assets/screenshots/docs/docs-self-hosting-light.png`, `docs-self-hosting-dark.png`: the
  configuration reference.

All 1440×900. Regenerate with `pnpm --dir docs screenshots`. Brand renders (not screenshots) are in
`assets/brand/` and `assets/brand/png/`; regenerate with `pnpm --dir docs brand`.
