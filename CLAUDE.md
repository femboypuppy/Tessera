# Tessera — shared rules for every agent

Claude Code loads this file automatically in every session in this repo. Your own assignment is in `agents/NN-<area>.md`.

Read, in order: this file, `SPEC.md`, `HANDOFF/architect.md`, the code in `packages/core`, then your assignment. (The Architect creates `SPEC.md` and `HANDOFF/architect.md`. If you are the Architect, go straight to `agents/01-architect.md`.)

## What we're building

**Tessera** is an open-source (MIT), local-first, self-hostable knowledge app: Notion-style blocks and databases, Obsidian-style `[[wikilinks]]`, backlinks and graph view, real-time collaboration, a sandboxed plugin system, desktop apps, and one-command self-hosting. It works fully offline, imports from Notion and Obsidian in one click, and exports to plain markdown at any time. No lock-in.

The bar: someone who tries it for five minutes should want to star it. It has to be fast, calm and polished, and it must never lose data.

## The team

Agent 01 (Architect) works first, alone, on `main`. Then agents 02–10 work **in parallel, each in its own git worktree and branch, with no way to talk to each other**. The contracts in `packages/core` and the `HANDOFF/` files are how you coordinate. Afterwards the Architect merges everything (`agents/11-merge.md`) and a final pass polishes it (`agents/12-polish.md`).

| # | Agent | Branch | Owns (may create and edit) |
|---|---|---|---|
| 01 | Architect | `main` | root config files, `.claude/`, `packages/core`, `packages/ui`, `apps/web` except the contents of `src/features/*` (the Architect creates those as stubs, then each belongs to its agent), `SPEC.md`, `CLAUDE.md`, `HANDOFF/README.md` |
| 02 | Editor | `feat/editor` | `packages/editor`, `apps/web/src/features/editor` |
| 03 | Storage & sync | `feat/sync` | `packages/sync`, `apps/server`, `apps/web/src/features/sync` |
| 04 | Databases | `feat/databases` | `packages/db-views`, `apps/web/src/features/databases` |
| 05 | Search & graph | `feat/search` | `packages/search`, `apps/web/src/features/search`, `apps/web/src/features/graph`, `apps/web/src/features/backlinks` |
| 06 | Plugins | `feat/plugins` | `packages/plugins`, `packages/plugin-api`, `packages/create-tessera-plugin`, `apps/web/src/features/plugins`, `examples/plugins`, `examples/plugin-template`, `docs/plugins` |
| 07 | Desktop & self-host | `feat/desktop` | `apps/desktop`, `apps/web/src/features/desktop`, `Dockerfile`, `docker-compose.yml`, `.dockerignore`, `deploy/` |
| 08 | Markdown, import & export | `feat/importers` | `packages/markdown`, `packages/importers`, `apps/web/src/features/import-export` |
| 09 | CI & quality | `feat/ci` | `.github/workflows`, `.github/dependabot.yml`, `.github/CODEOWNERS`, `.github/labeler.yml`, `packages/testkit`, `scripts/`, `e2e/journeys`, `e2e/support`, `SECURITY.md` |
| 10 | Docs & launch | `feat/docs` | `README.md`, `docs/` except `docs/plugins`, `assets/` except `assets/screenshots`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `LICENSE`, `.github/ISSUE_TEMPLATE`, `.github/PULL_REQUEST_TEMPLATE.md`, `examples/demo-workspace`, `LAUNCH.md`, `BUILT_WITH_AGENTS.md` |

Every agent also owns `HANDOFF/<area>.md`, `assets/screenshots/<area>/` and `e2e/<area>/`, where `<area>` is one of: `architect`, `editor`, `sync`, `databases`, `search`, `plugins`, `desktop`, `importers`, `ci`, `docs`.

## Hard rules

1. **Stay in your lane.** Create or edit files only where you own them (table above). Reading anything is fine.
2. **`packages/core` is the contract.** Its types, interfaces, document schema and extension points belong to the Architect. Never edit them. If you need a change, keep going with a local workaround and write a *Contract change request* (with the exact proposed diff) in your HANDOFF file. It gets applied at merge time.
3. **Plug in, don't patch.** The app shell loads each feature through the `FeatureModule` exported from `apps/web/src/features/<area>/index.ts`. Register routes, commands, panels, page bodies, block renderers, services and settings there. Never edit the shell or another agent's feature to hook yourself in.
4. **Keep feature folders thin.** `apps/web/src/features/<area>/` holds only the registration. Components and logic live in your package, so your dependencies live in your own `package.json`.
5. **Never block on another agent.** If you need something another agent is building, code against its interface in `packages/core` and use the in-memory or stub implementation the Architect provided. The real one replaces it at merge time.
6. **Don't ask the human questions.** Make the best reasonable decision, record it under *Decisions* in your HANDOFF file, and keep going.
7. **Root files belong to the Architect** (`package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, ESLint, Prettier, Vitest and Playwright configs). The build uses globs, so a new package or e2e folder never needs a root edit. Need a root-level script? Add it to your own package and mention it in HANDOFF.
8. **Dependencies:** prefer what's already installed. If you add one, add it only to a `package.json` you own, pin the exact version, prefer small, maintained, MIT/Apache-2.0/BSD/ISC-licensed libraries, and justify it in HANDOFF. Lockfile conflicts get resolved at merge by regenerating the lockfile, so don't worry about them.
9. **Git:** work only on your branch. Commit small and often with Conventional Commits (`feat(editor): add slash menu`). Never force-push, rewrite history, or touch `main`.
10. **Memory:** don't save role- or task-specific notes to Claude Code's auto memory. All worktrees of this repo share it, so another agent would read your notes as its own. Your HANDOFF file is your notebook.

## Engineering standards

- TypeScript `strict`. No `any` (use `unknown` and narrow). No `@ts-ignore` or `eslint-disable` without a comment explaining why.
- Tests test real behavior: Vitest for units, Playwright for user flows. Never skip, weaken or delete a test to make it pass.
- Nothing you mark as done contains placeholder code. Unfinished work is listed in HANDOFF, not hidden behind a `TODO`.
- UI uses components and design tokens from `packages/ui`, works in light and dark themes, is fully keyboard-accessible (visible focus, correct ARIA via Radix primitives), respects `prefers-reduced-motion`, and works at phone width.
- All user-facing strings go through `t()` from `packages/ui`.
- Every async UI has loading, empty and error states. Destructive actions are undoable or confirmed.
- Security: sanitize any external HTML with DOMPurify, never render unsanitized HTML, never use `eval` or `new Function`, and validate data at trust boundaries with zod.
- Performance: lazy-load heavy features with dynamic `import()` and respect the budgets in `SPEC.md`.
- Document state lives in Yjs. Never mirror document content into React state.

## Commands

`pnpm dev` · `pnpm build` · `pnpm test` · `pnpm test:e2e` · `pnpm typecheck` · `pnpm lint` · `pnpm format`

- `pnpm build` builds every package, the web app, the server and, when Rust is installed, the desktop app (`tauri build --no-bundle`; `TESSERA_SKIP_DESKTOP=1` skips it; installers: `pnpm --filter @tessera/desktop build:app`).
- `pnpm dev` runs the web app (http://localhost:5173) and the server (port 8787, data in `apps/server/data`) together; the app reaches the server through Vite's `/api` and `/sync` proxy, so "Connect to a server" finds it on the app's own origin. `pnpm --filter @tessera/web dev` runs the app alone.
- Run one package: `pnpm --filter @tessera/<name> <script>` (`test`, `typecheck`, `lint`, `build`). The plugin scaffolder's name is `create-tessera-plugin`.
- Run only your e2e specs: `pnpm test:e2e e2e/<area>`. First time on a machine: `pnpm test:e2e:install`. `E2E_DEV=1` tests against the dev server instead of a production build.
- Specs that time frames or keystrokes are tagged `@perf` (`{ tag: '@perf' }`) and run alone: `pnpm test:e2e --grep @perf --workers=1` (CI runs them after the rest, one at a time).
- Screenshots: `pnpm screenshots e2e/<area>` runs your `e2e/<area>/*.screenshots.ts` files (SPEC.md, section 9.2).
- `pnpm lint:fix` applies ESLint and Prettier fixes.

(Architect: keep this section accurate.)

## How to work

1. Read everything listed at the top. Then write your plan at the top of `HANDOFF/<area>.md` and keep that file updated as you go.
2. Build in the milestone order of your agent file. Each milestone ends in a working, tested, committed state, so whatever exists always works.
3. After each milestone: run `pnpm typecheck && pnpm lint && pnpm test` and your e2e specs, run the app, take Playwright screenshots, **look at them critically**, fix what looks wrong, and commit.
4. Keep going until everything is done. Don't stop to report progress. If something is truly impossible in this environment (missing toolchain, no network), write the code and config anyway, document exactly what you couldn't verify, and move on.

## Definition of done

- [ ] `pnpm typecheck`, `pnpm lint` and `pnpm test` pass, and your e2e specs pass.
- [ ] Every acceptance criterion in your agent file is met, or listed as not done in HANDOFF with the reason.
- [ ] Your features are reachable in the running app, not just library code.
- [ ] Screenshots are saved as `assets/screenshots/<area>/<name>-light.png` and `<name>-dark.png`, using the names listed in your agent file, at 1440×900 with realistic content (never lorem ipsum). The docs agent references these exact paths.
- [ ] `HANDOFF/<area>.md` is complete (template below).
- [ ] Everything is committed on your branch.

When you believe you're done, post a final message titled **Completion audit**: every acceptance criterion from your agent file with ✅ or ❌ plus evidence (test names, file paths), followed by the summary lines of `pnpm typecheck`, `pnpm lint` and `pnpm test`. If anything is ❌ and still achievable, keep working instead of posting it.

## HANDOFF template

```markdown
# <Area> handoff
## Plan
## Built (what exists and where)
## How it plugs in (FeatureModule entries, services, extension points used)
## Decisions (and why)
## Contract change requests (exact proposed diff to packages/core, and why)
## Known gaps and bugs
## Follow-ups for the merge (cross-agent wiring you couldn't finish alone)
## Screenshots (list of files)
```
