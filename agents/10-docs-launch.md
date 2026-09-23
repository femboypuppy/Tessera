# Agent 10 — README, docs site, brand & launch

**Parallel phase, branch `feat/docs`. Effort: high.**

You own `README.md`, `docs/` except `docs/plugins`, `assets/` except `assets/screenshots`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `LICENSE`, `.github/ISSUE_TEMPLATE`, `.github/PULL_REQUEST_TEMPLATE.md`, `examples/demo-workspace`, `LAUNCH.md`, `BUILT_WITH_AGENTS.md`, and your HANDOFF folder.

## Why this matters

Most people decide within ten seconds whether to star a repo, based on the top of the README. Make those ten seconds count, then make the docs good enough that people stay and contribute.

## Read first

`CLAUDE.md`, `SPEC.md`, `HANDOFF/architect.md`, and every file in `agents/`, so you know exactly what's being built and which screenshots will exist.

## M1 — Brand

- Keep the name Tessera. Write the tagline (for example, "Your notes, your server. Notion's power, Obsidian's freedom.") and five alternatives in HANDOFF for the owner.
- Logo: a simple geometric SVG (a mosaic-tile motif) that reads at 16 px and on light and dark backgrounds, plus a wordmark and a favicon set.
- A social preview image at exactly 1280×640, rendered from an HTML or SVG template with Playwright so it's reproducible.
- Colors taken from the `packages/ui` tokens.

## M2 — README (the most important file in the repo)

- **Top:** centered logo, name and tagline; badges (CI, latest release, license, Docker pulls); a links row (Docs · Download · Self-host · Plugins · Roadmap).
- **Hero:** the demo GIF right below, as a clearly marked placeholder at `assets/demo.gif` (the polish phase records it), then three short "why" lines.
- **Features:** short sections with screenshots from `assets/screenshots/<area>/<name>-light.png`. Use the exact names listed in each agent file and list every path you reference in HANDOFF, so the merge phase can verify each image exists.
- **Quickstart:** desktop download, a Docker one-liner, docker compose, and from source, with four commands at most for each.
- **Comparison table** against Notion, Obsidian, AnyType, AFFiNE and Logseq (open source, local-first, self-hostable, real-time collaboration, databases, plugins, graph, price). Be accurate and fair: verify each cell against the product's current docs if you have web access, mark anything uncertain for the owner, and add a "last checked" date. Honest comparisons convince more than inflated ones.
- Roadmap (link to issues), contributing, community, license, acknowledgements (Yjs, TipTap, Hocuspocus, Tauri, MiniSearch, sigma.js and the rest), and a star-history chart.
- Keep it scannable: short sentences, no walls of text, emoji only sparingly.

## M3 — Docs site (VitePress in `docs/`)

- A home page with a hero and features.
- Guides: installation (desktop, web, Docker), a first-steps tutorial, the editor and every keyboard shortcut, databases, linking and the graph, search, import and export, sync and collaboration, self-hosting (a configuration reference covering every environment variable from `apps/server`, with placeholders where it doesn't exist yet), backups, FAQ, troubleshooting.
- Architecture for contributors, based on `SPEC.md`.
- Sidebar entries linking to `docs/plugins/` (owned by Agent 06).
- Dark mode, local search, "edit this page on GitHub" links, and the base-path configuration for GitHub Pages documented (Agent 09 writes the deploy workflow).

## M4 — Community files

- `CONTRIBUTING.md`: dev setup, a repo tour, how to pick a first issue, the commit convention, a PR checklist, and how to write a plugin.
- `CODE_OF_CONDUCT.md` (Contributor Covenant 2.1) and `LICENSE` (MIT, `Copyright (c) 2026 <OWNER>`).
- Issue forms (a bug report with environment fields, a feature request, and a question form pointing to Discussions) and a PR template.
- In HANDOFF: 15 ready-to-file "good first issue" drafts, real and small, based on `SPEC.md` and the agent files.

## M5 — Demo workspace and launch kit

- `examples/demo-workspace`: a markdown folder (~40 pages) with CSV files for databases that showcases everything: a welcome page with an interactive checklist tutorial, keyboard shortcuts, a project-board database, a reading-list database, meeting-notes pages, a page using every block type, and a small, richly interlinked "knowledge garden" on an interesting topic (for example, the history of space exploration) so the graph looks beautiful. Real, engaging content, no lorem ipsum.
- `LAUNCH.md`:
  - a Show HN title and post (humble and technical, something people can try right away, with a first comment explaining why and how it's built)
  - an r/selfhosted post (lead with docker compose and screenshots) and an r/opensource post
  - a Product Hunt listing and an X/Bluesky/Mastodon thread
  - a short technical blog post ("Building a local-first Notion alternative with Yjs")
  - a launch-day checklist (reply to every comment, have good first issues ready, pin a welcome discussion), respecting each community's self-promotion rules
- `BUILT_WITH_AGENTS.md`: an optional, honest write-up of how the project was built with ten parallel Claude Code agents (the prompts are in `agents/`). The owner decides whether to link it from the README.

## Acceptance criteria

- The README renders correctly on GitHub: every relative link and image path is valid or a clearly listed placeholder.
- The docs build with no dead links (VitePress dead-link check).
- The logo is valid SVG and legible at 16, 32 and 64 px (render PNGs with Playwright and look at them).
- The social preview PNG exists at exactly 1280×640.
- LICENSE, CODE_OF_CONDUCT and CONTRIBUTING exist, and the issue forms are valid YAML.
- The demo workspace is valid markdown and CSV (it gets imported for real after the merge).

## Pitfalls

- Don't overclaim. If a feature isn't built, it goes in the roadmap, not the feature list.
- Write for skimmers first and readers second.
