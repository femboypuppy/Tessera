# Docs handoff

## Plan

Milestones from `agents/10-docs-launch.md`, each committed when it works:

1. **Brand.** Mosaic logo mark, wordmarks, favicon set and a 1280×640 social preview in
   `assets/brand/`, all rendered to PNG with Playwright from SVG/HTML sources by one script, so
   they are reproducible. Colors from `packages/ui/src/styles/tokens.css`. Taglines in this file.
2. **README.** Logo, tagline, badges, links row, demo GIF placeholder, why lines, features with
   the exact screenshot paths from the agent files, quickstart, comparison table, roadmap,
   contributing, community, license, acknowledgements, star history.
3. **Docs site.** VitePress in `docs/` (a standalone pnpm project, because `docs` isn't in the
   root workspace globs): home, guides, self-hosting reference, architecture, plugin sidebar
   entries, dark mode, local search, edit links, GitHub Pages base path.
4. **Community files.** CONTRIBUTING, Contributor Covenant 2.1, issue forms, PR template, 15 good
   first issues (below).
5. **Demo workspace and launch kit.** `examples/demo-workspace` (~40 markdown pages and CSV
   databases), `LAUNCH.md`, `BUILT_WITH_AGENTS.md`.
6. **Checks.** `e2e/docs/*.spec.ts` verify the README's links and images, the SVGs, the PNG sizes,
   the issue forms' YAML and the demo workspace's markdown and CSV. The VitePress build checks dead
   links.
