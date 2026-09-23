# Agent 11 — Integration & merge

**Runs after all nine parallel agents finish, in the main repo folder on `main`. Effort: max.**

You are the Architect again. Nine feature branches are done. Your job: land them on `main` one at a time, keep `main` green after every single merge, and turn nine features into one product.

## Before merging

1. Read every `HANDOFF/*.md`. Write the plan in `HANDOFF/integration.md`: the merge order, every contract change request (approved or rejected, with reasons), and every cross-agent follow-up.
2. Apply the approved contract changes to `packages/core` first, in one commit, and update `SPEC.md`.

## Merge order

Adjust it if the HANDOFF files suggest a better one.

1. `feat/ci` (so everything after it runs through CI)
2. `feat/sync`
3. `feat/editor`
4. `feat/importers` (the real markdown codec)
5. `feat/search`
6. `feat/databases`
7. `feat/plugins`
8. `feat/desktop`
9. `feat/docs`

For each branch:

- `git merge --no-ff feat/<area>`. Resolve conflicts preserving both sides' intent. For the lockfile, take `main`'s version and run `pnpm install`.
- Adapt the branch to the approved contract changes.
- Run `pnpm install && pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e`, and fix root causes before moving on. Never skip or weaken a test to get green; if a test is genuinely wrong, fix it and say why in the commit message.
- Run the app, use the feature, take screenshots and look at them.
- Commit with a message summarizing what was merged and what was adapted.

## Integration work after all merges

- Confirm every stub is replaced by its real service at boot (IndexedDB or Tauri stores, Hocuspocus sync, MiniSearch, the link index, the markdown codec) and that service priorities behave correctly in the browser and in the desktop app.
- Wire the cross-feature flows no single agent could finish:
  - collaboration cursors in the editor
  - editor copy and paste through the real codec
  - search indexing of database rows
  - inline databases inside pages
  - plugin blocks in the slash menu
  - importers writing to the asset store
  - the desktop markdown mirror using the exporter
  - "Open demo workspace" loading `examples/demo-workspace`
  - the history panel's preview using the editor
  - the plugin docs in the docs sidebar
- Complete every "Follow-ups for the merge" item from the HANDOFF files.
- Remove the skip guards from `e2e/journeys` and make every journey pass. Add a two-browser collaboration test with the real editor and server.
- Run `scripts/bench`, compare the results with the budgets in `SPEC.md`, and fix regressions.
- Security review: auth flows, plugin sandbox escape tests, XSS through import, paste and embeds, path traversal in importers and asset serving, upload limits, and `pnpm audit`.
- Make sure every screenshot path the README references exists.
- Update `SPEC.md` and `CLAUDE.md` to match reality, remove dead code, and make sure `pnpm build` produces the web app, the server and the desktop app.

## Acceptance criteria

- `main` is green: all tests and journeys pass, and the CI workflows are valid.
- On a fresh clone, `pnpm install && pnpm dev` runs the whole product.
- `docker compose up` gives a server where two users can collaborate on the same page.
- `HANDOFF/integration.md` lists everything done, everything deferred, and every known bug, each written as a ready-to-file GitHub issue.
